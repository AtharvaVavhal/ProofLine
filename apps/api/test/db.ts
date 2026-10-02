import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

export const HASH_A = 'a'.repeat(64);
export const HASH_B = 'b'.repeat(64);

export async function createUserAndCase() {
  const user = await prisma.user.create({ data: { email: `test-${randomUUID()}@example.test` } });
  const kase = await prisma.case.create({ data: { userId: user.id } });
  return { user, kase };
}

/** A valid UPLOADED PNG evidence row; override fields to probe constraints. */
function pngEvidence(
  caseId: string,
  sequenceNo: number,
  overrides: Partial<Prisma.EvidenceItemUncheckedCreateInput> = {},
): Prisma.EvidenceItemUncheckedCreateInput {
  return {
    caseId,
    sequenceNo,
    evidenceType: 'PNG',
    originalFilename: 'evidence.png',
    storageKey: `test/${randomUUID()}`,
    processingStatus: 'UPLOADED',
    detectedContentType: 'image/png',
    byteSize: 100n,
    imageWidth: 10,
    imageHeight: 10,
    sha256: HASH_A,
    uploadedAt: new Date(),
    ...overrides,
  };
}

export async function createEvidence(
  caseId: string,
  sequenceNo: number,
  overrides: Partial<Prisma.EvidenceItemUncheckedCreateInput> = {},
) {
  return prisma.evidenceItem.create({ data: pngEvidence(caseId, sequenceNo, overrides) });
}

/** Asserts that a write is rejected and that the error names the expected constraint/trigger. */
export async function expectRejected(write: Promise<unknown>, pattern: RegExp): Promise<void> {
  await expect(write).rejects.toThrow(pattern);
}
