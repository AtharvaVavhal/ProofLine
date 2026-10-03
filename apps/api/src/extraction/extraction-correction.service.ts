import { Injectable } from '@nestjs/common';
import type { CorrectExtractionInput, CorrectExtractionResponse } from '@proofline/shared';
import { AuditService } from '../audit/audit.service';
import { CaseAccessService } from '../cases/case-access.service';
import { CaseStateService } from '../cases/case-state.service';
import { ApiError } from '../common/api-error';
import { isUuid } from '../common/cursor';
import { PrismaService } from '../database/prisma.service';
import { sweepOrphanEntities } from '../entities/entity-cleanup';
import { invalidateExtractionRelationships } from '../graph/relationship-cleanup';
import { AnalysisRunsService, runSummary } from '../orchestrator/analysis-runs.service';
import { ProvenanceService } from '../provenance/provenance.service';
import { EXTRACTION_INCLUDE, presentExtraction } from './extraction.presenter';
import { isValidFormat, normalize } from './normalize';

type Actor = { userId: string; requestId: string };

const extractionNotFound = () =>
  new ApiError(404, 'NOT_FOUND', "This extracted detail isn't available.");

/**
 * Extraction correction (05 #24; FR-013; 03 §9.2). The user's value becomes a CORRECTION user
 * statement and the correction columns; `raw_value`, `normalized_value`, the source lines and
 * the evidence are never changed (INV-X5). Then the S-4 re-entry: case back to EXTRACTED (if it
 * had passed it), confirmations voided, and a CORRECTION run enqueued — all in one transaction.
 */
@Injectable()
export class ExtractionCorrectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CaseAccessService,
    private readonly caseState: CaseStateService,
    private readonly provenance: ProvenanceService,
    private readonly runs: AnalysisRunsService,
    private readonly audit: AuditService,
  ) {}

  async correct(
    caseId: string,
    extractionId: string,
    input: CorrectExtractionInput,
    actor: Actor,
  ): Promise<CorrectExtractionResponse> {
    return this.prisma.$transaction(async (tx) => {
      const owned = await this.access.assertCaseAccess(actor.userId, caseId, {
        db: tx,
        lock: true,
      });
      if (!isUuid(extractionId)) throw extractionNotFound();
      // Nested IDs must belong to the case (05 §4.2): another case's extraction is the same 404.
      const extraction = await tx.extraction.findFirst({
        where: { id: extractionId, caseId: owned.id },
        include: { evidence: { select: { evidenceRef: true } } },
      });
      if (!extraction) throw extractionNotFound();
      if (await this.runs.findActive(tx, owned.id)) {
        throw new ApiError(
          409,
          'ANALYSIS_IN_PROGRESS',
          'Analysis is running. Try again when it finishes.',
        );
      }

      const correctedValue = input.correctedValue.trim();
      if (!isValidFormat(extraction.fieldType, correctedValue)) {
        throw new ApiError(422, 'VALIDATION_FAILED', "This value isn't valid for this detail.", {
          fieldErrors: [{ field: 'correctedValue', code: 'INVALID_FORMAT' }],
        });
      }
      const normalized = normalize(extraction.fieldType, correctedValue);
      const correctedNormalizedValue = normalized.status === 'NORMALIZED' ? normalized.value : null;
      const changed =
        correctedNormalizedValue !==
        (extraction.correctionStatus === 'USER_CORRECTED'
          ? extraction.correctedNormalizedValue
          : extraction.normalizedValue);

      const statementId = await this.provenance.recordStatement(tx, {
        caseId: owned.id,
        authorUserId: actor.userId,
        kind: 'CORRECTION',
        subject: `extraction:${extraction.id}`,
        // The user's words: the note when given, else the value itself (13 §23 pattern).
        valueText: input.note?.trim() || correctedValue,
        normalizedValue: correctedNormalizedValue ?? correctedValue,
        valueDatetime: normalized.datetime ?? null,
        valueAmountMinor: normalized.amountMinor ?? null,
      });
      const updated = await tx.extraction.update({
        where: { id: extraction.id },
        data: {
          correctionStatus: 'USER_CORRECTED',
          correctedValue,
          correctedNormalizedValue,
          correctionStatementId: statementId,
          correctedAt: new Date(),
          ...(changed ? { entityId: null } : {}),
        },
        include: EXTRACTION_INCLUDE,
      });
      // Invalidate obsolete support immediately, even if queued re-resolution later fails.
      // Original values, source lines and append-only correction statements remain intact.
      if (changed) {
        await invalidateExtractionRelationships(tx, owned.id, extraction.id, extraction.evidenceId);
        await sweepOrphanEntities(tx, owned.id);
      }

      await this.caseState.rewind(tx, {
        caseId: owned.id,
        from: owned.status,
        to: 'EXTRACTED',
        actorUserId: actor.userId,
        requestId: actor.requestId,
      });
      await this.audit.record(tx, {
        action: 'EXTRACTION_CORRECTED',
        outcome: 'SUCCEEDED',
        actorUserId: actor.userId,
        caseId: owned.id,
        targetType: 'extraction',
        targetId: extraction.id,
        requestId: actor.requestId,
        metadata: { evidenceRef: extraction.evidence.evidenceRef, fieldType: extraction.fieldType },
      });
      const run = await this.runs.enqueue(tx, {
        caseId: owned.id,
        trigger: 'CORRECTION',
        userId: actor.userId,
        requestId: actor.requestId,
      });
      return { extraction: presentExtraction(updated), run: runSummary(run) };
    });
  }
}
