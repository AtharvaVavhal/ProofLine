import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Inject, Injectable } from '@nestjs/common';
import type { EvidenceItem, Prisma } from '@prisma/client';
import { sweepOrphanEntities } from '../entities/entity-cleanup';
import { sweepOrphanRelationships } from '../graph/relationship-cleanup';
import { AuditService } from '../audit/audit.service';
import { EvidenceLifecycleService } from '../evidence/evidence-lifecycle.service';
import { LIMITS } from '../evidence/evidence-rules';
import { OBJECT_STORAGE, ObjectStorage } from '../storage/object-storage';
import { OCR_ENGINE, OcrEngine } from './ocr/ocr-engine';
import { ParsedEvidence, ProcessingFailure } from './parsed-evidence';
import { parseEml } from './parsers/eml.parser';
import { parseImage } from './parsers/image.parser';
import { parsePdf } from './parsers/pdf.parser';
import { parseText } from './parsers/text.parser';
import { DETECTOR_VERSION, redactLine } from './redaction';

/** Per-item PARSE timeout [IMPL] (07 §29). */
export const PARSE_TIMEOUT_MS = 60_000;

export type ParseOutcome =
  | {
      kind: 'parsed';
      summary: { pageCount: number; lineCount: number; detections: Record<string, number> };
    }
  | { kind: 'failed'; code: ProcessingFailure['code']; retryable: boolean };

async function readObject(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.length;
    if (total > LIMITS.maxBytes) {
      stream.destroy();
      throw new ProcessingFailure('EXTRACTION_FAILED', true);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * The PARSE stage (07 §9–§14, §18): stored original → parser/OCR → redaction → source lines.
 * Owns parse_results, source_pages, source_lines and sensitive_detections (04 §5.2).
 * The original object is only read, never rewritten. Unredacted text exists only in memory.
 */
@Injectable()
export class ProcessingService {
  constructor(
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(OCR_ENGINE) private readonly ocr: OcrEngine,
    private readonly lifecycle: EvidenceLifecycleService,
    private readonly audit: AuditService,
  ) {}

  /** Reads and parses one item outside any transaction. Throws ProcessingFailure. */
  async parse(item: EvidenceItem): Promise<ParsedEvidence> {
    let bytes: Buffer;
    try {
      bytes = await readObject(await this.storage.getObjectStream(item.storageKey));
    } catch (error) {
      if (error instanceof ProcessingFailure) throw error;
      throw new ProcessingFailure('STORAGE_UNAVAILABLE', true);
    }

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new ProcessingFailure(
              item.evidenceType === 'PNG' || item.evidenceType === 'JPEG'
                ? 'OCR_FAILED'
                : 'EXTRACTION_FAILED',
              true,
            ),
          ),
        PARSE_TIMEOUT_MS,
      );
    });
    try {
      return await Promise.race([this.dispatch(item, bytes), timeout]);
    } catch (error) {
      if (error instanceof ProcessingFailure && error.code === 'OCR_FAILED') await this.ocr.reset();
      if (error instanceof ProcessingFailure) throw error;
      throw new ProcessingFailure('EXTRACTION_FAILED', true);
    } finally {
      clearTimeout(timer);
    }
  }

  private dispatch(item: EvidenceItem, bytes: Buffer): Promise<ParsedEvidence> {
    switch (item.evidenceType) {
      case 'PNG':
      case 'JPEG':
        return parseImage(bytes, item.detectedContentType ?? '', this.ocr);
      case 'PDF':
        return parsePdf(bytes);
      case 'EML':
        return parseEml(bytes);
      case 'TXT':
      case 'TEXT':
      case 'URL':
        return Promise.resolve(parseText(bytes, item.evidenceType));
    }
  }

  /**
   * Persists a successful parse in one transaction (04 §24): a retry's previous parse is
   * replaced (its lines and extractions cascade), then parse_result + pages + redacted lines +
   * detections. The item stays PROCESSING; EXTRACT marks it PROCESSED (03 §23.2).
   */
  async saveParsed(
    tx: Prisma.TransactionClient,
    item: EvidenceItem,
    agentStepId: string,
    parsed: ParsedEvidence,
  ): Promise<ParseOutcome & { kind: 'parsed' }> {
    await tx.parseResult.deleteMany({ where: { evidenceId: item.id } });
    await sweepOrphanEntities(tx, item.caseId);
    await sweepOrphanRelationships(tx, item.caseId);
    const parse = await this.createParseResult(tx, item, agentStepId, parsed, 'SUCCEEDED');

    const counters = new Map<number, number>();
    const lines: Prisma.SourceLineCreateManyInput[] = [];
    const detections: Prisma.SensitiveDetectionCreateManyInput[] = [];
    for (const raw of parsed.lines) {
      const lineNumber = (counters.get(raw.pageNumber) ?? 0) + 1;
      counters.set(raw.pageNumber, lineNumber);
      const redacted = redactLine(raw.text);
      const id = randomUUID();
      lines.push({
        id,
        caseId: item.caseId,
        parseResultId: parse.id,
        evidenceId: item.id,
        pageNumber: raw.pageNumber,
        lineNumber,
        locationKind: raw.locationKind,
        headerName: raw.headerName ?? null,
        text: redacted.text,
        bbox: raw.bbox ?? undefined,
        ocrConfidence: raw.ocrConfidence ?? null,
      });
      for (const detection of redacted.detections) {
        detections.push({
          caseId: item.caseId,
          evidenceId: item.id,
          sourceLineId: id,
          kind: detection.kind,
          charStart: detection.charStart,
          charEnd: detection.charEnd,
          detectorVersion: DETECTOR_VERSION,
        });
      }
    }
    if (lines.length > 0) await tx.sourceLine.createMany({ data: lines });
    if (detections.length > 0) await tx.sensitiveDetection.createMany({ data: detections });
    await this.lifecycle.recordParsed(tx, item.id, parsed.sourceMetadata);

    const byKind: Record<string, number> = {};
    for (const d of detections) byKind[d.kind] = (byKind[d.kind] ?? 0) + 1;
    return {
      kind: 'parsed',
      summary: { pageCount: parsed.pages.length, lineCount: lines.length, detections: byKind },
    };
  }

  /**
   * Persists a failed parse: no lines or detections are kept (INV-E6). When the parser described
   * the document (e.g. PDF pages below the text-layer threshold) a FAILED parse_result and its
   * pages are stored for the source view. The item becomes FAILED with its code and is audited.
   */
  async saveFailed(
    tx: Prisma.TransactionClient,
    item: EvidenceItem,
    agentStepId: string,
    failure: ProcessingFailure,
  ): Promise<ParseOutcome & { kind: 'failed' }> {
    await tx.parseResult.deleteMany({ where: { evidenceId: item.id } });
    await sweepOrphanEntities(tx, item.caseId);
    await sweepOrphanRelationships(tx, item.caseId);
    if (failure.parse) {
      await this.createParseResult(
        tx,
        item,
        agentStepId,
        { ...failure.parse, lines: [] },
        'FAILED',
        failure.code,
      );
    }
    await this.lifecycle.markFailed(tx, item.id, {
      code: failure.code,
      retryable: failure.retryable,
      detail: failure.detail,
    });
    await this.audit.record(tx, {
      action: 'EVIDENCE_PROCESSING_FAILED',
      outcome: 'FAILED',
      caseId: item.caseId,
      targetType: 'evidence',
      targetId: item.id,
      metadata: { evidenceRef: item.evidenceRef, code: failure.code },
    });
    return {
      kind: 'failed',
      code: failure.code,
      retryable: failure.code === 'PDF_NO_TEXT_LAYER' ? false : failure.retryable,
    };
  }

  private async createParseResult(
    tx: Prisma.TransactionClient,
    item: EvidenceItem,
    agentStepId: string,
    parsed: ParsedEvidence,
    status: 'SUCCEEDED' | 'FAILED',
    failureCode?: ProcessingFailure['code'],
  ) {
    const parse = await tx.parseResult.create({
      data: {
        caseId: item.caseId,
        evidenceId: item.id,
        agentStepId,
        parserKind: parsed.parserKind,
        engine: parsed.engine,
        engineVersion: parsed.engineVersion,
        status,
        pageCount: Math.max(1, parsed.pages.length),
        failureCode: status === 'FAILED' ? (failureCode ?? null) : null,
      },
      select: { id: true },
    });
    await tx.sourcePage.createMany({
      data: (parsed.pages.length > 0 ? parsed.pages : [{ pageNumber: 1 }]).map((page) => ({
        parseResultId: parse.id,
        caseId: item.caseId,
        pageNumber: page.pageNumber,
        nonWhitespaceCharCount: page.nonWhitespaceCharCount ?? null,
        width: page.width ?? null,
        height: page.height ?? null,
      })),
    });
    return parse;
  }
}
