import { Injectable } from '@nestjs/common';
import type { FactRefKind, Prisma, StatementKind } from '@prisma/client';
import type { SourceRef } from '@proofline/shared';

export type StatementInput = {
  caseId: string;
  authorUserId: string;
  kind: StatementKind;
  /** What the statement is about, e.g. `case.summary` (03 §9.5). */
  subject: string;
  valueText: string;
  normalizedValue?: string | null;
  valueDatetime?: Date | null;
  valueAmountMinor?: bigint | null;
};

/** The facts that may own `fact_sources` rows (03 §11.2: exactly one owner per row). */
export type SourceOwner =
  | { kind: 'relationship'; id: string }
  | { kind: 'timelineEvent'; id: string }
  | { kind: 'scamSignal'; id: string }
  | { kind: 'missingInfoItem'; id: string }
  | { kind: 'actionItem'; id: string }
  | { kind: 'urgencyReason'; id: string }
  | { kind: 'entity'; id: string };

/** A SourceRef to attach (AD-02): an extraction, an evidence item (+ line), or a statement. */
export type SourceRefInput =
  | { kind: 'EXTRACTION'; extractionId: string }
  | { kind: 'EVIDENCE'; evidenceId: string; sourceLineId?: string }
  | { kind: 'USER_STATEMENT'; userStatementId: string };

/** A write that would leave a fact without valid, same-case provenance (INV-P1, INV-P3). */
export class ProvenanceError extends Error {}

const OWNER_COLUMN = {
  relationship: 'relationshipId',
  timelineEvent: 'timelineEventId',
  scamSignal: 'scamSignalId',
  missingInfoItem: 'missingInfoItemId',
  actionItem: 'actionItemId',
  urgencyReason: 'urgencyReasonId',
  entity: 'entityId',
} as const;

/** Owns `user_statements` and `fact_sources` (04 §5.2). Statements are append-only. */
@Injectable()
export class ProvenanceService {
  /** Reconcile the current support set without replacing surviving source rows (08 §9–§12). */
  async replaceRelationshipSources(
    db: Prisma.TransactionClient,
    caseId: string,
    relationshipId: string,
    extractionIds: string[],
  ) {
    if (extractionIds.length === 0) throw new ProvenanceError('A relationship needs evidence');
    await this.attachSources(db, {
      caseId,
      owner: { kind: 'relationship', id: relationshipId },
      refs: extractionIds.map((extractionId) => ({ kind: 'EXTRACTION', extractionId })),
    });
    await db.factSource.deleteMany({
      where: {
        caseId,
        relationshipId,
        OR: [{ refKind: { not: 'EXTRACTION' } }, { extractionId: { notIn: extractionIds } }],
      },
    });
  }

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
        valueAmountMinor: input.valueAmountMinor ?? null,
        supersedesStatementId: previous?.id ?? null,
      },
      select: { id: true },
    });
    return statement.id;
  }

  /**
   * Attaches sources to a fact in the caller's transaction (INV-P1: ≥ 1 source; INV-P3: every
   * target in the same case). A missing or foreign reference throws, failing the transaction.
   * The composite foreign keys enforce the same rule in the database (03 §20).
   */
  async attachSources(
    db: Prisma.TransactionClient,
    params: { caseId: string; owner: SourceOwner; refs: SourceRefInput[] },
  ): Promise<void> {
    if (params.refs.length === 0) throw new ProvenanceError('A fact needs at least one source');
    if (params.owner.kind === 'entity' && params.refs.some((r) => r.kind !== 'USER_STATEMENT')) {
      // An entity's evidence support is its extractions; only user-stated support is a row.
      throw new ProvenanceError('Entity sources are user statements only');
    }
    const data: Prisma.FactSourceCreateManyInput[] = [];
    for (const [index, ref] of params.refs.entries()) {
      await this.assertSameCase(db, params.caseId, ref);
      data.push({
        caseId: params.caseId,
        [OWNER_COLUMN[params.owner.kind]]: params.owner.id,
        refKind: ref.kind as FactRefKind,
        extractionId: ref.kind === 'EXTRACTION' ? ref.extractionId : null,
        evidenceId: ref.kind === 'EVIDENCE' ? ref.evidenceId : null,
        sourceLineId: ref.kind === 'EVIDENCE' ? (ref.sourceLineId ?? null) : null,
        userStatementId: ref.kind === 'USER_STATEMENT' ? ref.userStatementId : null,
        ordinal: index + 1,
      });
    }
    await db.factSource.createMany({ data, skipDuplicates: true });
  }

  private async assertSameCase(
    db: Prisma.TransactionClient,
    caseId: string,
    ref: SourceRefInput,
  ): Promise<void> {
    let found = 0;
    if (ref.kind === 'EXTRACTION') {
      found = await db.extraction.count({ where: { id: ref.extractionId, caseId } });
    } else if (ref.kind === 'USER_STATEMENT') {
      found = await db.userStatement.count({ where: { id: ref.userStatementId, caseId } });
    } else {
      found = await db.evidenceItem.count({ where: { id: ref.evidenceId, caseId } });
      if (found && ref.sourceLineId) {
        // A cited line must belong to the cited evidence item, not merely to the case.
        found = await db.sourceLine.count({
          where: { id: ref.sourceLineId, caseId, evidenceId: ref.evidenceId },
        });
      }
    }
    if (found === 0) throw new ProvenanceError('Source is missing or belongs to another case');
  }

  /** SourceRef (05 §3.1) of an extraction: evidence, page, lines and the redacted snippet. */
  async extractionSourceRef(
    db: Prisma.TransactionClient,
    caseId: string,
    extractionId: string,
  ): Promise<SourceRef | null> {
    const row = await db.extraction.findFirst({
      where: { id: extractionId, caseId },
      include: {
        evidence: { select: { evidenceRef: true } },
        sourceLines: { include: { sourceLine: true }, orderBy: { ordinal: 'asc' } },
      },
    });
    if (!row) return null;
    const lines = row.sourceLines.map((l) => l.sourceLine);
    const first = lines[0];
    return {
      kind: 'EXTRACTION',
      id: row.id,
      evidenceId: row.evidenceId,
      evidenceRef: row.evidence.evidenceRef,
      location: first
        ? {
            pageNumber: first.pageNumber,
            lineNumbers: lines
              .filter((l) => l.pageNumber === first.pageNumber)
              .map((l) => l.lineNumber),
            headerName: first.headerName,
          }
        : null,
      snippet: row.snippet,
      statementText: null,
    };
  }

  /**
   * Gate F coverage (14 Phase 6): extractions of the case that lack a line of their own
   * evidence item. Must be zero (INV-X2).
   */
  async extractionsWithoutOwnLines(db: Prisma.TransactionClient, caseId: string): Promise<number> {
    const [row] = await db.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM extractions x
      WHERE x.case_id = ${caseId}::uuid AND NOT EXISTS (
        SELECT 1 FROM extraction_source_lines esl
        JOIN source_lines sl ON sl.id = esl.source_line_id
        WHERE esl.extraction_id = x.id AND sl.evidence_id = x.evidence_id
          AND sl.case_id = x.case_id)`;
    return Number(row?.count ?? 0);
  }
}
