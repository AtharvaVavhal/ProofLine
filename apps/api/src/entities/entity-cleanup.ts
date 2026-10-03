import type { Prisma } from '@prisma/client';

/** INV-N1: derived entities with no surviving source are removed under the case lock. */
export async function sweepOrphanEntities(tx: Prisma.TransactionClient, caseId: string) {
  const removed = await tx.entity.deleteMany({
    where: {
      caseId,
      extractions: { none: {} },
      factSources: { none: { refKind: 'USER_STATEMENT' } },
    },
  });
  return removed.count;
}
