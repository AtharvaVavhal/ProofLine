import type { Prisma } from '@prisma/client';

/** INV-P2, 08 §12. Cascades remove sources; this removes the now unsupported owners. */
export async function sweepOrphanRelationships(tx: Prisma.TransactionClient, caseId: string) {
  return (
    await tx.relationship.deleteMany({
      where: { caseId, factSources: { none: { refKind: { in: ['EXTRACTION', 'EVIDENCE'] } } } },
    })
  ).count;
}

/**
 * A correction invalidates this item's contribution to edges supported by that extraction.
 * Keep other evidence's support and surviving edge IDs; CORRELATE re-evaluates the changed
 * item. This prevents a queued or failed correction run from leaving obsolete provenance.
 */
export async function invalidateExtractionRelationships(
  tx: Prisma.TransactionClient,
  caseId: string,
  extractionId: string,
  evidenceId: string,
) {
  const affected = await tx.factSource.findMany({
    where: { caseId, extractionId, relationshipId: { not: null } },
    select: { relationshipId: true },
  });
  if (affected.length) {
    await tx.factSource.deleteMany({
      where: {
        caseId,
        relationshipId: { in: affected.map((s) => s.relationshipId!) },
        OR: [{ evidenceId }, { extraction: { evidenceId } }],
      },
    });
  }
  await sweepOrphanRelationships(tx, caseId);
}
