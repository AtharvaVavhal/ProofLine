import { Injectable } from '@nestjs/common';
import type { Prisma, StatementKind } from '@prisma/client';

export type StatementInput = {
  caseId: string;
  authorUserId: string;
  kind: StatementKind;
  /** What the statement is about, e.g. `case.summary` (03 §9.5). */
  subject: string;
  valueText: string;
  normalizedValue?: string | null;
  valueDatetime?: Date | null;
};

/** Owns `user_statements` and `fact_sources` (04 §5.2). Statements are append-only. */
@Injectable()
export class ProvenanceService {
  /** Records a statement; a later statement on the same subject supersedes the earlier one. */
  async recordStatement(db: Prisma.TransactionClient, input: StatementInput): Promise<string> {
    const previous = await db.userStatement.findFirst({
      where: { caseId: input.caseId, subject: input.subject },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    const statement = await db.userStatement.create({
      data: {
        caseId: input.caseId,
        authorUserId: input.authorUserId,
        statementKind: input.kind,
        subject: input.subject,
        valueText: input.valueText,
        normalizedValue: input.normalizedValue ?? null,
        valueDatetime: input.valueDatetime ?? null,
        supersedesStatementId: previous?.id ?? null,
      },
      select: { id: true },
    });
    return statement.id;
  }
}
