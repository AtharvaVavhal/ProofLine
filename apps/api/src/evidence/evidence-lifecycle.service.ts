import { Injectable } from '@nestjs/common';
import { EvidenceFailureCode, Prisma } from '@prisma/client';

/**
 * Evidence status changes made by processing (07 §3: "processing → evidence, status via the
 * evidence service"). Called inside the caller's transaction.
 */
@Injectable()
export class EvidenceLifecycleService {
  /** UPLOADED or retryable FAILED → PROCESSING when an analysis run includes the item. */
  async markProcessing(db: Prisma.TransactionClient, evidenceIds: string[]): Promise<void> {
    if (evidenceIds.length === 0) return;
    await db.evidenceItem.updateMany({
      where: {
        id: { in: evidenceIds },
        OR: [
          { processingStatus: 'UPLOADED' },
          { processingStatus: 'FAILED', failureRetryable: true },
        ],
      },
      data: {
        processingStatus: 'PROCESSING',
        failureCode: null,
        failureRetryable: null,
        failureDetail: Prisma.DbNull,
      },
    });
  }

  /**
   * PARSE stored the item's lines: merge what the parser learned (EML attachments, body part;
   * 03 §6.3). The item stays PROCESSING until EXTRACT succeeds (03 §23.2).
   */
  async recordParsed(
    db: Prisma.TransactionClient,
    evidenceId: string,
    sourceMetadata?: Record<string, unknown>,
  ): Promise<void> {
    if (!sourceMetadata) return;
    const current = (
      await db.evidenceItem.findUniqueOrThrow({
        where: { id: evidenceId },
        select: { sourceMetadata: true },
      })
    ).sourceMetadata as Record<string, unknown>;
    await db.evidenceItem.update({
      where: { id: evidenceId },
      data: { sourceMetadata: { ...current, ...sourceMetadata } as Prisma.InputJsonObject },
    });
  }

  /** PROCESSING → PROCESSED: parse and extraction both succeeded (03 §23.2). */
  async markProcessed(db: Prisma.TransactionClient, evidenceId: string): Promise<void> {
    await db.evidenceItem.update({
      where: { id: evidenceId },
      data: { processingStatus: 'PROCESSED' },
    });
  }

  async markFailed(
    db: Prisma.TransactionClient,
    evidenceId: string,
    failure: { code: EvidenceFailureCode; retryable: boolean; detail?: Record<string, unknown> },
  ): Promise<void> {
    await db.evidenceItem.update({
      where: { id: evidenceId },
      data: {
        processingStatus: 'FAILED',
        failureCode: failure.code,
        // OD-03: a PDF without a text layer is never retryable (also a DB CHECK).
        failureRetryable: failure.code === 'PDF_NO_TEXT_LAYER' ? false : failure.retryable,
        ...(failure.detail ? { failureDetail: failure.detail as Prisma.InputJsonObject } : {}),
      },
    });
  }
}
