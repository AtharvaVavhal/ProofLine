import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Inject, Injectable } from '@nestjs/common';
import type { CaseStatus, EvidenceItem, Prisma } from '@prisma/client';
import type {
  DeleteEvidenceResponse,
  EvidenceDownloadResponse,
  EvidenceListResponse,
  EvidenceResponse,
  RegisterEvidenceInput,
  RegisterEvidenceResponse,
} from '@proofline/shared';
import { AuditService } from '../audit/audit.service';
import { CaseAccessService } from '../cases/case-access.service';
import { CaseStateService } from '../cases/case-state.service';
import { ApiError } from '../common/api-error';
import { PrismaService } from '../database/prisma.service';
import { sweepOrphanEntities } from '../entities/entity-cleanup';
import { sweepOrphanRelationships } from '../graph/relationship-cleanup';
import {
  OBJECT_STORAGE,
  ObjectNotFoundError,
  ObjectStorage,
  evidenceObjectKey,
} from '../storage/object-storage';
import { removeObjectsAfterCommit } from '../storage/remove-objects';
import { EvidencePresenter } from './evidence.presenter';
import {
  LIMITS,
  PASTE_CANONICALIZATION,
  REJECTIONS,
  RejectionCode,
  canonicalizePaste,
  charCount,
  checkDeclaredSize,
  checkDeclaredType,
  inspectUpload,
  isPastedUrl,
} from './evidence-rules';

type Actor = { userId: string; requestId: string };

const rejection = (code: RejectionCode) =>
  new ApiError(REJECTIONS[code].status, code, REJECTIONS[code].message);

const storageUnavailable = () =>
  new ApiError(503, 'SERVICE_UNAVAILABLE', "We couldn't finish checking this file. Retry.");

const DOWNLOAD_EXTENSION: Record<EvidenceItem['evidenceType'], string> = {
  PNG: 'png',
  JPEG: 'jpg',
  PDF: 'pdf',
  TXT: 'txt',
  EML: 'eml',
  TEXT: 'txt',
  URL: 'txt',
};

class TooLargeError extends Error {}

/** Reads the whole object, failing as soon as it exceeds the 10 MB limit. */
async function readCapped(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.length;
    if (total > LIMITS.maxBytes) {
      stream.destroy();
      throw new TooLargeError();
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * Evidence registration, upload completion, listing, download and removal (05 #3, #18, #19,
 * #21, #22; 07 §4–§8). Owns `evidence_items`. Completion never starts processing (07 N-1).
 */
@Injectable()
export class EvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CaseAccessService,
    private readonly caseState: CaseStateService,
    private readonly audit: AuditService,
    private readonly presenter: EvidencePresenter,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  register(
    caseId: string,
    input: RegisterEvidenceInput,
    actor: Actor,
  ): Promise<RegisterEvidenceResponse> {
    return input.source === 'FILE'
      ? this.registerFile(caseId, input, actor)
      : this.registerPaste(caseId, input, actor);
  }

  /** Step 1 of 3 (OD-14): an UPLOADING row and a signed PUT URL. No audit until completion. */
  private async registerFile(
    caseId: string,
    input: Extract<RegisterEvidenceInput, { source: 'FILE' }>,
    actor: Actor,
  ): Promise<RegisterEvidenceResponse> {
    const item = await this.prisma.$transaction(async (tx) => {
      const owned = await this.access.assertCaseAccess(actor.userId, caseId, {
        db: tx,
        lock: true,
      });
      await this.assertNoActiveRun(tx, caseId);
      const declared = checkDeclaredType(input.filename, input.declaredContentType);
      if (!declared.ok) throw rejection(declared.code);
      const sizeProblem = checkDeclaredSize(input.byteSize);
      if (sizeProblem) throw rejection(sizeProblem);

      const id = randomUUID();
      const created = await tx.evidenceItem.create({
        data: {
          id,
          caseId,
          sequenceNo: await this.allocateSlot(tx, caseId),
          evidenceType: declared.type.evidenceType,
          label: input.label ?? null,
          originalFilename: input.filename,
          declaredContentType: declared.type.contentType,
          byteSize: BigInt(input.byteSize),
          storageKey: evidenceObjectKey(caseId, id),
        },
      });
      await this.caseState.transition(tx, {
        caseId,
        from: owned.status,
        to: 'INGESTING',
        actorUserId: actor.userId,
        requestId: actor.requestId,
      });
      return created;
    });

    const expiresAt = new Date(Date.now() + LIMITS.uploadUrlSeconds * 1000);
    const contentType = item.declaredContentType!;
    let url: string;
    try {
      url = await this.storage.createSignedUploadUrl(
        item.storageKey,
        contentType,
        input.byteSize,
        LIMITS.uploadUrlSeconds,
      );
    } catch {
      // The UPLOADING row stays; the user can remove it, and the cleanup job removes it otherwise.
      throw storageUnavailable();
    }
    return {
      evidence: await this.presenter.presentOne(item),
      upload: {
        url,
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        expiresAt: expiresAt.toISOString(),
      },
    };
  }

  /** Paste: canonicalise (G-3), hash, store and record as UPLOADED in one request (07 §4, §13). */
  private async registerPaste(
    caseId: string,
    input: Extract<RegisterEvidenceInput, { source: 'PASTE' }>,
    actor: Actor,
  ): Promise<RegisterEvidenceResponse> {
    const item = await this.prisma.$transaction(async (tx) => {
      const owned = await this.access.assertCaseAccess(actor.userId, caseId, {
        db: tx,
        lock: true,
      });
      await this.assertNoActiveRun(tx, caseId);

      const canonical = canonicalizePaste(input.content);
      const chars = charCount(canonical);
      if (chars === 0) {
        throw new ApiError(
          400,
          'VALIDATION_FAILED',
          'Check the highlighted fields and try again.',
          {
            fieldErrors: [{ field: 'content', code: 'INVALID' }],
          },
        );
      }
      if (chars > LIMITS.maxPasteChars) {
        throw new ApiError(413, 'TEXT_TOO_LONG', 'Pasted text can be up to 20,000 characters.');
      }
      if (input.pasteKind === 'URL' && !isPastedUrl(canonical)) {
        throw new ApiError(
          422,
          'NOT_A_URL',
          "This doesn't look like a link. Paste it as a message instead.",
        );
      }

      const bytes = Buffer.from(canonical, 'utf8');
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const id = randomUUID();
      const key = evidenceObjectKey(caseId, id);
      const created = await tx.evidenceItem.create({
        data: {
          id,
          caseId,
          sequenceNo: await this.allocateSlot(tx, caseId),
          evidenceType: input.pasteKind === 'URL' ? 'URL' : 'TEXT',
          pasteKind: input.pasteKind,
          label: input.label ?? null,
          declaredContentType: 'text/plain',
          detectedContentType: 'text/plain',
          byteSize: BigInt(bytes.length),
          textCharCount: chars,
          storageKey: key,
          sha256,
          uploadedAt: new Date(),
          processingStatus: 'UPLOADED',
          sourceMetadata: { canonicalization: PASTE_CANONICALIZATION },
        },
      });
      // Stored before commit; if the commit then fails the object is an orphan for cleanup.
      try {
        await this.storage.putObject(key, bytes, 'text/plain; charset=utf-8');
      } catch {
        throw new ApiError(503, 'SERVICE_UNAVAILABLE', "We couldn't save this text. Retry.");
      }
      await this.audit.record(tx, {
        action: 'EVIDENCE_UPLOADED',
        outcome: 'SUCCEEDED',
        actorUserId: actor.userId,
        caseId,
        targetType: 'evidence',
        targetId: id,
        requestId: actor.requestId,
        metadata: { evidenceRef: created.evidenceRef, sha256 },
      });
      await this.caseState.transition(tx, {
        caseId,
        from: owned.status,
        to: 'INGESTING',
        actorUserId: actor.userId,
        requestId: actor.requestId,
      });
      return created;
    });
    return { evidence: await this.presenter.presentOne(item) };
  }

  /**
   * Step 3 of 3 (07 §6): validate and fingerprint the stored bytes. Streaming happens outside
   * the transaction; the result is applied under the case lock after re-checking the state.
   */
  async complete(evidenceId: string, actor: Actor): Promise<EvidenceResponse> {
    await this.access.assertEvidenceAccess(actor.userId, evidenceId);
    const item = await this.prisma.evidenceItem.findUniqueOrThrow({ where: { id: evidenceId } });
    if (item.processingStatus !== 'UPLOADING') return this.presenter.presentOne(item);

    let bytes: Buffer;
    try {
      const head = await this.storage.headObject(item.storageKey);
      // Oversized objects (e.g. written around the signed URL) are rejected without reading.
      if (head.byteSize > LIMITS.maxBytes) throw new TooLargeError();
      bytes = await readCapped(await this.storage.getObjectStream(item.storageKey));
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        throw new ApiError(409, 'EVIDENCE_NOT_UPLOADED', "Upload didn't finish. Retry or remove.");
      }
      if (error instanceof TooLargeError) return this.reject(evidenceId, 'FILE_TOO_LARGE', actor);
      // Storage or stream failure: the item stays UPLOADING and the user can retry (07 N-2).
      await this.audit.record(this.prisma, {
        action: 'EVIDENCE_UPLOADED',
        outcome: 'FAILED',
        actorUserId: actor.userId,
        caseId: item.caseId,
        targetType: 'evidence',
        targetId: evidenceId,
        requestId: actor.requestId,
        metadata: { evidenceRef: item.evidenceRef, code: 'STORAGE_UNAVAILABLE' },
      });
      throw storageUnavailable();
    }

    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const inspection = await inspectUpload(bytes, item.declaredContentType ?? '');
    if (!inspection.ok) return this.reject(evidenceId, inspection.code, actor);

    return this.prisma.$transaction(async (tx) => {
      await this.access.assertEvidenceAccess(actor.userId, evidenceId, { db: tx, lock: true });
      const current = await tx.evidenceItem.findUniqueOrThrow({ where: { id: evidenceId } });
      // A concurrent completion already accepted it: same answer (idempotent, 05 §24).
      if (current.processingStatus !== 'UPLOADING') return this.presenter.presentOne(current, tx);
      const accepted = await tx.evidenceItem.update({
        where: { id: evidenceId },
        data: {
          processingStatus: 'UPLOADED',
          sha256,
          uploadedAt: new Date(),
          detectedContentType: inspection.detectedContentType,
          byteSize: BigInt(bytes.length),
          pageCount: inspection.pageCount,
          imageWidth: inspection.imageWidth,
          imageHeight: inspection.imageHeight,
          sourceMetadata: inspection.sourceMetadata as Prisma.InputJsonObject,
        },
      });
      await this.audit.record(tx, {
        action: 'EVIDENCE_UPLOADED',
        outcome: 'SUCCEEDED',
        actorUserId: actor.userId,
        caseId: accepted.caseId,
        targetType: 'evidence',
        targetId: evidenceId,
        requestId: actor.requestId,
        metadata: { evidenceRef: accepted.evidenceRef, sha256 },
      });
      return this.presenter.presentOne(accepted, tx);
    });
  }

  /** Rejection leaves no evidence row (G-4): row deleted + audit in one tx, object after commit. */
  private async reject(evidenceId: string, code: RejectionCode, actor: Actor): Promise<never> {
    const key = await this.prisma.$transaction(async (tx) => {
      const owned = await this.access.assertEvidenceAccess(actor.userId, evidenceId, {
        db: tx,
        lock: true,
      });
      const item = await tx.evidenceItem.findUniqueOrThrow({ where: { id: evidenceId } });
      if (item.processingStatus !== 'UPLOADING') return null;
      await tx.evidenceItem.delete({ where: { id: evidenceId } });
      await this.audit.record(tx, {
        action: 'EVIDENCE_REJECTED',
        outcome: 'SUCCEEDED',
        actorUserId: actor.userId,
        caseId: owned.caseId,
        targetType: 'evidence',
        targetId: evidenceId,
        requestId: actor.requestId,
        metadata: { evidenceRef: item.evidenceRef, code },
      });
      await this.caseState.settleAfterEvidenceRemoval(tx, {
        caseId: owned.caseId,
        from: owned.caseStatus,
        actorUserId: actor.userId,
        requestId: actor.requestId,
      });
      return item.storageKey;
    });
    if (key) await removeObjectsAfterCommit(this.storage, [key]);
    throw rejection(code);
  }

  async list(caseId: string, actor: Actor): Promise<EvidenceListResponse> {
    await this.access.assertCaseAccess(actor.userId, caseId);
    const items = await this.prisma.evidenceItem.findMany({
      where: { caseId },
      orderBy: { sequenceNo: 'asc' },
    });
    return { items: await this.presenter.present(items) };
  }

  /** Signed GET for the original (05 #21; 09 §11): 5 minutes, forced download, audited. */
  async download(evidenceId: string, actor: Actor): Promise<EvidenceDownloadResponse> {
    const owned = await this.access.assertEvidenceAccess(actor.userId, evidenceId);
    const item = await this.prisma.evidenceItem.findUniqueOrThrow({ where: { id: evidenceId } });
    if (item.sha256 === null || item.detectedContentType === null) {
      throw new ApiError(409, 'EVIDENCE_NOT_UPLOADED', "This file hasn't finished uploading.");
    }
    await this.audit.record(this.prisma, {
      action: 'EVIDENCE_VIEWED',
      outcome: 'SUCCEEDED',
      actorUserId: actor.userId,
      caseId: owned.caseId,
      targetType: 'evidence',
      targetId: evidenceId,
      requestId: actor.requestId,
      metadata: { evidenceRef: item.evidenceRef },
    });
    const expiresAt = new Date(Date.now() + LIMITS.downloadUrlSeconds * 1000);
    try {
      const url = await this.storage.createSignedDownloadUrl(item.storageKey, {
        contentType: item.detectedContentType,
        // Built from the reference, never the user's filename (no PII in URLs).
        downloadName: `${item.evidenceRef}.${DOWNLOAD_EXTENSION[item.evidenceType]}`,
        expiresInSeconds: LIMITS.downloadUrlSeconds,
      });
      return { url, expiresAt: expiresAt.toISOString() };
    } catch {
      throw new ApiError(
        503,
        'SERVICE_UNAVAILABLE',
        'The service is temporarily unavailable. Please try again shortly.',
      );
    }
  }

  /**
   * DELETE /evidence/:id?confirm=true (05 §23). Rows cascade; the case returns to INGESTING, or
   * NEW when none remain. Report invalidation and export deletion arrive with reports
   * (Phase 13); until then there is nothing to invalidate.
   */
  async remove(
    evidenceId: string,
    confirm: string | undefined,
    actor: Actor,
  ): Promise<DeleteEvidenceResponse> {
    if (confirm !== 'true') {
      throw new ApiError(400, 'CONFIRMATION_REQUIRED', 'Confirm the removal to continue.');
    }
    const { key, caseStatus } = await this.prisma.$transaction(async (tx) => {
      const owned = await this.access.assertEvidenceAccess(actor.userId, evidenceId, {
        db: tx,
        lock: true,
      });
      const item = await tx.evidenceItem.delete({ where: { id: evidenceId } });
      await sweepOrphanEntities(tx, owned.caseId);
      await sweepOrphanRelationships(tx, owned.caseId);
      await this.audit.record(tx, {
        action: 'EVIDENCE_DELETED',
        outcome: 'SUCCEEDED',
        actorUserId: actor.userId,
        caseId: owned.caseId,
        targetType: 'evidence',
        targetId: evidenceId,
        requestId: actor.requestId,
        metadata: {
          evidenceRef: item.evidenceRef,
          ...(item.sha256 ? { sha256: item.sha256 } : {}),
        },
      });
      const status = await this.caseState.settleAfterEvidenceRemoval(tx, {
        caseId: owned.caseId,
        from: owned.caseStatus,
        actorUserId: actor.userId,
        requestId: actor.requestId,
      });
      return { key: item.storageKey, caseStatus: status };
    });
    await removeObjectsAfterCommit(this.storage, [key]);
    return { caseStatus, reportsInvalidated: 0, exportsDeleted: 0 };
  }

  /**
   * Removes UPLOADING rows older than the upload-URL lifetime plus a grace period, with their
   * objects (07 §5, 03 §6.2). System action; returns how many were removed.
   */
  async cleanupAbandonedUploads(now = new Date()): Promise<number> {
    const cutoff = new Date(
      now.getTime() - (LIMITS.uploadUrlSeconds + LIMITS.abandonedGraceSeconds) * 1000,
    );
    const stale = await this.prisma.evidenceItem.findMany({
      where: { processingStatus: 'UPLOADING', createdAt: { lt: cutoff } },
      select: { id: true, caseId: true },
    });
    let removed = 0;
    for (const candidate of stale) {
      const key = await this.prisma.$transaction(async (tx) => {
        const [kase] = await tx.$queryRaw<{ status: CaseStatus }[]>`
          SELECT status FROM cases WHERE id = ${candidate.caseId}::uuid FOR UPDATE`;
        const item = await tx.evidenceItem.findUnique({ where: { id: candidate.id } });
        if (!kase || !item || item.processingStatus !== 'UPLOADING') return null;
        await tx.evidenceItem.delete({ where: { id: item.id } });
        await this.audit.record(tx, {
          action: 'EVIDENCE_REJECTED',
          outcome: 'SUCCEEDED',
          caseId: item.caseId,
          targetType: 'evidence',
          targetId: item.id,
          metadata: { evidenceRef: item.evidenceRef, code: 'TRANSFER_FAILED' },
        });
        await this.caseState.settleAfterEvidenceRemoval(tx, {
          caseId: item.caseId,
          from: kase.status,
        });
        return item.storageKey;
      });
      if (key) {
        await removeObjectsAfterCommit(this.storage, [key]);
        removed += 1;
      }
    }
    return removed;
  }

  /** Registration is refused while a run is QUEUED/RUNNING (05 §25). */
  private async assertNoActiveRun(tx: Prisma.TransactionClient, caseId: string): Promise<void> {
    const active = await tx.analysisRun.count({
      where: { caseId, status: { in: ['QUEUED', 'RUNNING'] } },
    });
    if (active > 0) {
      throw new ApiError(
        409,
        'ANALYSIS_IN_PROGRESS',
        'Analysis is running. You can add more evidence when it finishes.',
      );
    }
  }

  /**
   * Lowest free slot 1–20 (07 §4). The caller holds the case-row lock, so concurrent
   * registrations are serialised; UNIQUE (case_id, sequence_no) and the 1–20 CHECK back it up.
   */
  private async allocateSlot(tx: Prisma.TransactionClient, caseId: string): Promise<number> {
    const used = new Set(
      (await tx.evidenceItem.findMany({ where: { caseId }, select: { sequenceNo: true } })).map(
        (row) => row.sequenceNo,
      ),
    );
    for (let slot = 1; slot <= LIMITS.maxItemsPerCase; slot += 1) {
      if (!used.has(slot)) return slot;
    }
    throw new ApiError(409, 'TOO_MANY_ITEMS', 'A case can hold up to 20 evidence items.');
  }
}
