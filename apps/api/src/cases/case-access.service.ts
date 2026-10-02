import { Injectable } from '@nestjs/common';
import type { CaseStatus, Prisma } from '@prisma/client';
import { ApiError } from '../common/api-error';
import { isUuid } from '../common/cursor';
import { PrismaService } from '../database/prisma.service';

export const caseNotFound = () => new ApiError(404, 'NOT_FOUND', "This case isn't available.");

export type OwnedCase = { id: string; status: CaseStatus };

export const evidenceNotFound = () =>
  new ApiError(404, 'NOT_FOUND', "This evidence isn't available.");

export type OwnedEvidence = { id: string; caseId: string; caseStatus: CaseStatus };

/**
 * The single case-ownership check (05 §4.2 CaseGuard, 09 §7). The lookup is scoped by the
 * session user, so a missing case and another user's case are the same 404 and nothing about
 * the other case is read. Later phases resolve nested resources through this first.
 */
@Injectable()
export class CaseAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async assertCaseAccess(
    userId: string,
    caseId: string,
    options: { db?: Prisma.TransactionClient; lock?: boolean } = {},
  ): Promise<OwnedCase> {
    if (!isUuid(caseId)) throw caseNotFound();
    const db = options.db ?? this.prisma;
    const rows = options.lock
      ? await db.$queryRaw<OwnedCase[]>`
          SELECT id, status FROM cases WHERE id = ${caseId}::uuid AND user_id = ${userId}::uuid
          FOR UPDATE`
      : await db.$queryRaw<OwnedCase[]>`
          SELECT id, status FROM cases WHERE id = ${caseId}::uuid AND user_id = ${userId}::uuid`;
    const found = rows[0];
    if (!found) throw caseNotFound();
    return found;
  }

  /**
   * Evidence-scoped routes resolve evidence → case → owner in one query (05 §4.2), so another
   * user's evidence is the same 404 as a missing one. `lock` takes the case and evidence rows.
   */
  async assertEvidenceAccess(
    userId: string,
    evidenceId: string,
    options: { db?: Prisma.TransactionClient; lock?: boolean } = {},
  ): Promise<OwnedEvidence> {
    if (!isUuid(evidenceId)) throw evidenceNotFound();
    const db = options.db ?? this.prisma;
    const rows = options.lock
      ? await db.$queryRaw<OwnedEvidence[]>`
          SELECT e.id, e.case_id AS "caseId", c.status AS "caseStatus"
          FROM evidence_items e JOIN cases c ON c.id = e.case_id
          WHERE e.id = ${evidenceId}::uuid AND c.user_id = ${userId}::uuid
          FOR UPDATE OF c, e`
      : await db.$queryRaw<OwnedEvidence[]>`
          SELECT e.id, e.case_id AS "caseId", c.status AS "caseStatus"
          FROM evidence_items e JOIN cases c ON c.id = e.case_id
          WHERE e.id = ${evidenceId}::uuid AND c.user_id = ${userId}::uuid`;
    const found = rows[0];
    if (!found) throw evidenceNotFound();
    return found;
  }
}
