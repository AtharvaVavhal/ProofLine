import { Injectable } from '@nestjs/common';
import type { EntityType, Prisma } from '@prisma/client';
import { normalize } from '../extraction/normalize';
import { maskedValue } from './entity-masking';
import { sweepOrphanEntities } from './entity-cleanup';

/**
 * The effective value for entity resolution: if the extraction is corrected, use the corrected
 * normalized value; otherwise use the extraction's own normalized value (07 §19; 05 §13).
 */
function effectiveNormalized(extraction: {
  normalizedValue: string | null;
  normalizationStatus: string;
  correctionStatus: string;
  correctedValue: string | null;
  correctedNormalizedValue: string | null;
  fieldType: EntityType;
}): { value: string | null; status: string } {
  if (extraction.correctionStatus === 'USER_CORRECTED' && extraction.correctedValue) {
    // Re-normalize the corrected value (Phase 7 correction integration).
    const n = normalize(extraction.fieldType, extraction.correctedValue);
    return { value: n.status === 'NORMALIZED' ? n.value : null, status: n.status };
  }
  return { value: extraction.normalizedValue, status: extraction.normalizationStatus };
}

/**
 * Entity resolution (07 §19, 03 §10). Upserts canonical entities by `(case_id, entity_type,
 * canonical_value)` and sets `extractions.entity_id`. One transaction per case.
 *
 * - DATETIME extractions are excluded (03 §10.2: they feed the timeline, not the graph).
 * - NOT_NORMALIZED extractions are excluded (07 §19: not merged).
 * - Exact canonical equality only; no fuzzy matching (07 §19).
 * - Case-scoped; no cross-case lookup (NFR-08).
 */
@Injectable()
export class EntityResolutionService {
  /**
   * Resolves all extractions for a case into canonical entities. Called by the NORMALIZE step
   * in the orchestrator. Runs inside a transaction provided by the caller.
   *
   * Returns a summary for the agent step's output.
   */
  async resolve(
    tx: Prisma.TransactionClient,
    caseId: string,
  ): Promise<{ created: number; linked: number; orphansRemoved: number }> {
    // Serialize normalization with corrections, deletion and concurrent deliveries (03 §22).
    const cases = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM cases WHERE id = ${caseId}::uuid FOR UPDATE`;
    if (cases.length === 0) throw new Error('CASE_CHANGED_DURING_RUN');

    // 1. Load all extractions for the case (non-DATETIME, with normalization data).
    const extractions = await tx.extraction.findMany({
      where: { caseId },
      orderBy: [
        { evidence: { sequenceNo: 'asc' } },
        { fieldType: 'asc' },
        { rawValue: 'asc' },
        { id: 'asc' },
      ],
      select: {
        id: true,
        rawValue: true,
        evidence: { select: { processingStatus: true } },
        fieldType: true,
        normalizedValue: true,
        normalizationStatus: true,
        correctionStatus: true,
        correctedValue: true,
        correctedNormalizedValue: true,
        entityId: true,
      },
    });

    // 2. Build entity candidates: group by (type, canonical) for normalized non-DATETIME.
    const entityMap = new Map<
      string,
      { type: EntityType; canonical: string; extractionIds: string[] }
    >();
    const extractionEntityMap = new Map<string, string | null>(); // extractionId → entityKey

    for (const ext of extractions) {
      if (
        ext.fieldType === 'DATETIME' ||
        ext.evidence.processingStatus !== 'PROCESSED' ||
        ext.normalizationStatus !== 'NORMALIZED'
      ) {
        // DATETIME: entity_id stays null (03 §10.2).
        extractionEntityMap.set(ext.id, null);
        continue;
      }
      const eff = effectiveNormalized(ext);
      if (eff.status !== 'NORMALIZED' || eff.value === null) {
        // NOT_NORMALIZED: not merged into entities (07 §19).
        extractionEntityMap.set(ext.id, null);
        continue;
      }
      const key = `${ext.fieldType}::${ext.fieldType === 'BANK_OR_WALLET' ? eff.value.toLowerCase() : eff.value}`;
      const existing = entityMap.get(key);
      if (existing) {
        existing.extractionIds.push(ext.id);
      } else {
        entityMap.set(key, {
          type: ext.fieldType,
          canonical: eff.value,
          extractionIds: [ext.id],
        });
      }
      extractionEntityMap.set(ext.id, key);
    }

    // 3. Upsert entities and collect their IDs.
    let created = 0;
    let linked = 0;
    const entityIdByKey = new Map<string, string>();

    for (const [key, candidate] of entityMap) {
      // Bank spelling is preserved (07 §15), with case-insensitive equality (06 §8).
      // The case lock makes selection of the existing natural key atomic.
      const previous = await tx.entity.findFirst({
        where: {
          caseId,
          entityType: candidate.type,
          canonicalValue:
            candidate.type === 'BANK_OR_WALLET'
              ? { equals: candidate.canonical, mode: 'insensitive' }
              : candidate.canonical,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      const canonical = previous?.canonicalValue ?? candidate.canonical;
      const supporting = extractions.find((x) => x.id === candidate.extractionIds[0])!;
      const raw = supporting.correctedValue ?? supporting.rawValue;
      const masked = maskedValue(candidate.type, canonical, raw);
      // Typed amount fields for AMOUNT entities.
      let amountMinor: bigint | null = null;
      let currency: string | null = null;
      if (candidate.type === 'AMOUNT') {
        const n = normalize('AMOUNT', candidate.canonical);
        if (n.amountMinor !== undefined) amountMinor = n.amountMinor;
        if (n.currency !== undefined) currency = n.currency;
      }

      const entity = await tx.entity.upsert({
        where: {
          caseId_entityType_canonicalValue: {
            caseId,
            entityType: candidate.type,
            canonicalValue: canonical,
          },
        },
        create: {
          caseId,
          entityType: candidate.type,
          canonicalValue: canonical,
          maskedValue: masked,
          amountMinor,
          currency,
        },
        update: {
          // Touch updatedAt; masked value might change if we improve masking.
          maskedValue: masked,
          isUserStated: false,
          amountMinor,
          currency,
        },
        select: { id: true },
      });

      if (!previous) created++;

      entityIdByKey.set(key, entity.id);
    }

    // 4. Set entity_id on each extraction.
    for (const ext of extractions) {
      const key = extractionEntityMap.get(ext.id);
      const newEntityId = key ? (entityIdByKey.get(key) ?? null) : null;
      if (ext.entityId !== newEntityId) {
        await tx.extraction.update({
          where: { id: ext.id },
          data: { entityId: newEntityId },
        });
        if (newEntityId) linked++;
      } else if (newEntityId) {
        linked++;
      }
    }

    const orphansRemoved = await sweepOrphanEntities(tx, caseId);
    return { created, linked, orphansRemoved };
  }
}
