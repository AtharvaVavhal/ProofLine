import { Injectable } from '@nestjs/common';
import type { CaseStatus, Prisma } from '@prisma/client';
import { ApiError } from '../common/api-error';
import { isUuid } from '../common/cursor';
import { PrismaService } from '../database/prisma.service';

export const caseNotFound = () => new ApiError(404, 'NOT_FOUND', "This case isn't available.");

export type OwnedCase = { id: string; status: CaseStatus };

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
}
