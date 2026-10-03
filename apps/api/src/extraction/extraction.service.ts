import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { EntityType, EvidenceItem, Prisma } from '@prisma/client';
import { AiCallFailure, AiCallMetrics, AiGateway } from '../ai/ai-gateway.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { EvidenceLifecycleService } from '../evidence/evidence-lifecycle.service';
import { ExtractionCandidate, REJECT_REASONS, RejectReason, SourceLineRecord } from './candidates';
import {
  EXTRACT_INSTRUCTIONS,
  EXTRACT_PROMPT_VERSION,
  buildEvidenceBlocks,
  extractEnvelopeSchema,
  extractItemSchema,
  extractOutputJsonSchema,
} from './extract-prompt';
import { ValidatedCandidate, ValidationContext, validateCandidate } from './literal-validator';
import { ruleCandidates } from './rules';

/** Output of the model-free part of EXTRACT, prepared outside the transaction (04 §24). */
export type PreparedExtraction = {
  parseResultId: string;
  candidates: ExtractionCandidate[];
  /** Model items rejected before validation (schema-invalid items, unknown line refs). */
  invalidItems: number;
  unknownLineRefs: number;
  llm: 'DISABLED' | 'USED';
  metrics: AiCallMetrics | null;
};

/** EXTRACT failed for this item; `stepCode` is the step's failure code (06 §22, 07 §22). */
export class ExtractionFailure extends Error {
  constructor(
    readonly stepCode: string,
    readonly metrics: AiCallMetrics | null = null,
  ) {
    super(stepCode);
  }
}

/** The item's parse changed between preparation and the write (a retry replaced it). */
export class ExtractionInputChanged extends Error {}

export type ExtractionSummary = {
  lineCount: number;
  accepted: Partial<Record<EntityType, number>>;
  rejected: Record<RejectReason, number>;
  duplicates: number;
  llm: { status: 'DISABLED' | 'USED'; invalidItems: number };
};

/**
 * The EXTRACT stage (07 §16–§17; 06 §5–§6): rule candidates plus optional model candidates over
 * one item's redacted lines → literal validation → `extractions` + `extraction_source_lines` in
 * one transaction. Owns those two tables (04 §5.2). Never reads evidence bytes or writes lines.
 */
@Injectable()
export class ExtractionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AiGateway,
    private readonly lifecycle: EvidenceLifecycleService,
    private readonly audit: AuditService,
  ) {}

  /** Reads the redacted lines and gathers candidates. The model call happens here, never in a tx. */
  async prepare(item: EvidenceItem): Promise<PreparedExtraction> {
    const parse = await this.prisma.parseResult.findFirst({
      where: { evidenceId: item.id, caseId: item.caseId, status: 'SUCCEEDED' },
      select: { id: true },
    });
    if (!parse) throw new ExtractionFailure('EXTRACTION_FAILED');
    const lines = await loadLines(this.prisma, item, parse.id);
    const candidates = ruleCandidates(lines);
    if (!this.gateway.enabled) {
      return {
        parseResultId: parse.id,
        candidates,
        invalidItems: 0,
        unknownLineRefs: 0,
        llm: 'DISABLED',
        metrics: null,
      };
    }

    const blocks = buildEvidenceBlocks(item.evidenceRef, lines);
    let result: Awaited<ReturnType<AiGateway['generate']>>;
    try {
      result = await this.gateway.generate({
        step: 'EXTRACT',
        promptVersion: EXTRACT_PROMPT_VERSION,
        instructions: EXTRACT_INSTRUCTIONS,
        evidenceBlocks: blocks.text,
        schema: extractOutputJsonSchema,
        envelope: extractEnvelopeSchema,
        evidenceSha256s: [item.sha256 ?? ''],
      });
    } catch (error) {
      if (error instanceof AiCallFailure) throw new ExtractionFailure(error.code, error.metrics);
      throw new ExtractionFailure('EXTRACTION_FAILED');
    }

    let invalidItems = 0;
    let unknownLineRefs = 0;
    for (const raw of (result.output as { candidates: unknown[] }).candidates) {
      const parsed = extractItemSchema.safeParse(raw);
      if (!parsed.success) {
        invalidItems += 1;
        continue;
      }
      const lineIds = parsed.data.lineIds.map((ref) => blocks.refs.get(ref));
      if (lineIds.some((id) => id === undefined)) {
        unknownLineRefs += 1; // an ID the prompt never supplied (06 §20)
        continue;
      }
      candidates.push({
        origin: 'LLM',
        evidenceId: item.id,
        fieldType: parsed.data.fieldType,
        value: parsed.data.value,
        lineIds: lineIds as string[],
        ...(parsed.data.fieldType === 'PERSON' && parsed.data.context
          ? { attributes: { context: parsed.data.context } }
          : {}),
        ...(parsed.data.judgementConfidence !== undefined
          ? { judgementConfidence: parsed.data.judgementConfidence }
          : {}),
      });
    }
    return {
      parseResultId: parse.id,
      candidates,
      invalidItems,
      unknownLineRefs,
      llm: 'USED',
      metrics: result.metrics,
    };
  }

  /**
   * Validates every candidate against the lines as stored now and persists the accepted ones
   * with their line references, replacing any earlier extractions of the item (07 §23), and
   * marks the item PROCESSED. Runs inside the caller's transaction, under the evidence lock.
   */
  async save(
    tx: Prisma.TransactionClient,
    item: EvidenceItem,
    agentStepId: string,
    prepared: PreparedExtraction,
  ): Promise<ExtractionSummary> {
    const lines = await loadLines(tx, item, prepared.parseResultId);
    const current = await tx.parseResult.findFirst({
      where: { evidenceId: item.id, caseId: item.caseId, status: 'SUCCEEDED' },
      select: { id: true },
    });
    if (current?.id !== prepared.parseResultId) throw new ExtractionInputChanged();

    const { kept, rejected, duplicates } = selectExtractions(prepared.candidates, {
      caseId: item.caseId,
      evidenceId: item.id,
      lines: new Map(lines.map((l) => [l.id, l])),
    });
    rejected.FOREIGN_LINE += prepared.unknownLineRefs;
    const rows = toRows(item, agentStepId, kept);

    await tx.extraction.deleteMany({ where: { evidenceId: item.id, caseId: item.caseId } });
    if (rows.extractions.length > 0) {
      await tx.extraction.createMany({ data: rows.extractions });
      await tx.extractionSourceLine.createMany({ data: rows.links });
    }
    await this.lifecycle.markProcessed(tx, item.id);

    const accepted: Partial<Record<EntityType, number>> = {};
    for (const v of kept) accepted[v.fieldType] = (accepted[v.fieldType] ?? 0) + 1;
    return {
      lineCount: lines.length,
      accepted,
      rejected,
      duplicates,
      llm: { status: prepared.llm, invalidItems: prepared.invalidItems },
    };
  }

  /** EXTRACT failed: nothing is persisted from it; the item is FAILED and retryable (07 §22). */
  async saveFailed(tx: Prisma.TransactionClient, item: EvidenceItem): Promise<void> {
    await tx.extraction.deleteMany({ where: { evidenceId: item.id, caseId: item.caseId } });
    await this.lifecycle.markFailed(tx, item.id, { code: 'EXTRACTION_FAILED', retryable: true });
    await this.audit.record(tx, {
      action: 'EVIDENCE_PROCESSING_FAILED',
      outcome: 'FAILED',
      caseId: item.caseId,
      targetType: 'evidence',
      targetId: item.id,
      metadata: { evidenceRef: item.evidenceRef, code: 'EXTRACTION_FAILED' },
    });
  }
}

/**
 * Validates every candidate (07 §17) and drops overlapping duplicates. Pure: the same
 * candidates and lines always give the same extractions (NFR-11). Rejections are counts only.
 */
export function selectExtractions(
  candidates: ExtractionCandidate[],
  context: ValidationContext,
): { kept: ValidatedCandidate[]; rejected: Record<RejectReason, number>; duplicates: number } {
  const rejected = Object.fromEntries(REJECT_REASONS.map((r) => [r, 0])) as Record<
    RejectReason,
    number
  >;
  const valid: ValidatedCandidate[] = [];
  for (const candidate of candidates) {
    const result = validateCandidate(candidate, context);
    if (result.ok) valid.push(result.value);
    else rejected[result.reason] += 1;
  }
  const kept = dedupe(valid);
  return { kept, rejected, duplicates: valid.length - kept.length };
}

/** `readSourceLines` (06 §16): one item's redacted lines, filtered by case and evidence. */
async function loadLines(
  db: Prisma.TransactionClient,
  item: EvidenceItem,
  parseResultId: string,
): Promise<SourceLineRecord[]> {
  const rows = await db.sourceLine.findMany({
    where: { caseId: item.caseId, evidenceId: item.id, parseResultId },
    orderBy: [{ pageNumber: 'asc' }, { lineNumber: 'asc' }],
  });
  return rows.map((row) => ({
    id: row.id,
    caseId: row.caseId,
    evidenceId: row.evidenceId,
    parseResultId: row.parseResultId,
    pageNumber: row.pageNumber,
    lineNumber: row.lineNumber,
    locationKind: row.locationKind,
    headerName: row.headerName,
    text: row.text,
    bbox: row.bbox,
    ocrConfidence: row.ocrConfidence === null ? null : Number(row.ocrConfidence),
  }));
}

/**
 * Overlapping accepted values of the same type are deduplicated: the longest span wins, then a
 * rule match over a model match (07 §16.2). Different types may share text (URL and DOMAIN).
 */
function dedupe(valid: ValidatedCandidate[]): ValidatedCandidate[] {
  const length = (v: ValidatedCandidate) =>
    v.matchOffsets.reduce((sum, m) => sum + m.end - m.start, 0);
  const ordered = [...valid].sort(
    (a, b) =>
      length(b) - length(a) ||
      (a.method === b.method ? 0 : a.method === 'RULE' ? -1 : 1) ||
      comparePosition(a, b),
  );
  const kept: ValidatedCandidate[] = [];
  for (const v of ordered) {
    const clash = kept.some(
      (k) =>
        k.fieldType === v.fieldType &&
        k.matchOffsets.some((a) =>
          v.matchOffsets.some((b) => a.lineId === b.lineId && a.start < b.end && b.start < a.end),
        ),
    );
    if (!clash) kept.push(v);
  }
  return kept.sort(comparePosition);
}

const comparePosition = (a: ValidatedCandidate, b: ValidatedCandidate) =>
  a.position[0] - b.position[0] || a.position[1] - b.position[1] || a.position[2] - b.position[2];

/**
 * Builds the rows. A time-only DATETIME gets `dateContextExtractionId`: the nearest preceding
 * date-only extraction in the same item (07 §16.3). Times are never combined here.
 */
function toRows(item: EvidenceItem, agentStepId: string, kept: ValidatedCandidate[]) {
  const extractions: Prisma.ExtractionCreateManyInput[] = [];
  const links: Prisma.ExtractionSourceLineCreateManyInput[] = [];
  let lastDateId: string | null = null;
  for (const v of kept) {
    const id = randomUUID();
    const attributes: Record<string, unknown> = { ...v.attributes };
    if (v.fieldType === 'DATETIME') {
      if (attributes.fragment === 'DATE') lastDateId = id;
      if (attributes.fragment === 'TIME' && lastDateId) {
        attributes.dateContextExtractionId = lastDateId;
      }
    }
    const n = v.normalized;
    extractions.push({
      id,
      caseId: item.caseId,
      evidenceId: item.id,
      parseResultId: v.parseResultId,
      agentStepId,
      fieldType: v.fieldType,
      rawValue: v.rawValue,
      normalizedValue: n.status === 'NORMALIZED' ? n.value : null,
      normalizationStatus: n.status,
      valueAmountMinor: n.amountMinor ?? null,
      valueCurrency: n.currency ?? null,
      valueDatetime: n.datetime ?? null,
      valueDatetimePrecision: n.datetime ? (n.precision ?? 'EXACT') : null,
      sourceLabel: v.sourceLabel,
      attributes: attributes as Prisma.InputJsonObject,
      method: v.method,
      confidence: v.confidence,
      confidenceBasis: v.confidenceBasis,
      confidenceBand: v.confidenceBand,
      snippet: v.snippet,
    });
    v.lineIds.forEach((sourceLineId, index) =>
      links.push({ extractionId: id, sourceLineId, caseId: item.caseId, ordinal: index + 1 }),
    );
  }
  return { extractions, links };
}
