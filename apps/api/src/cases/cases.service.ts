import { Injectable } from '@nestjs/common';
import { IncidentTimePrecision, Prisma } from '@prisma/client';
import type {
  AuditLogResponse,
  CaseListResponse,
  CaseResponse,
  CreateCaseInput,
  UpdateCaseInput,
} from '@proofline/shared';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import { cursorTimestampSql, decodeCursor, encodeCursor } from '../common/cursor';
import { PrismaService } from '../database/prisma.service';
import { ProvenanceService } from '../provenance/provenance.service';
import { CaseAccessService } from './case-access.service';
import { CaseReadModel } from './case-read-model';

type Metadata = {
  incidentTime: Date | null;
  incidentTimePrecision: IncidentTimePrecision | null;
  contact: string | null;
  location: string | null;
  summary: string | null;
};

type Field = 'incidentTime' | 'summary' | 'contact' | 'location';

type Actor = { userId: string; requestId: string };

const EMPTY: Metadata = {
  incidentTime: null,
  incidentTimePrecision: null,
  contact: null,
  location: null,
  summary: null,
};

const validationError = (field: string) =>
  new ApiError(400, 'VALIDATION_FAILED', 'Check the highlighted fields and try again.', {
    fieldErrors: [{ field, code: 'INVALID' }],
  });

/** Applies a create/patch body over the stored values; absent fields are unchanged. */
function merge(current: Metadata, input: CreateCaseInput | UpdateCaseInput): Metadata {
  const pick = <K extends keyof Metadata>(key: K, value: Metadata[K] | undefined) =>
    value === undefined ? current[key] : value;
  return {
    incidentTime: pick(
      'incidentTime',
      input.incidentTime === undefined
        ? undefined
        : input.incidentTime === null
          ? null
          : new Date(input.incidentTime),
    ),
    incidentTimePrecision: pick('incidentTimePrecision', input.incidentTimePrecision),
    contact: pick('contact', input.contact),
    location: pick('location', input.location),
    summary: pick('summary', input.summary),
  };
}

/** The pairing the database enforces (cases_incident_time_precision_check), checked first. */
function assertPairing(next: Metadata): void {
  const precision = next.incidentTimePrecision;
  if (next.incidentTime && precision !== 'EXACT' && precision !== 'APPROXIMATE') {
    throw validationError('incidentTimePrecision');
  }
  if (!next.incidentTime && (precision === 'EXACT' || precision === 'APPROXIMATE')) {
    throw validationError('incidentTime');
  }
}

function changedFields(before: Metadata, after: Metadata): Field[] {
  const changed: Field[] = [];
  if (
    before.incidentTime?.getTime() !== after.incidentTime?.getTime() ||
    before.incidentTimePrecision !== after.incidentTimePrecision
  ) {
    changed.push('incidentTime');
  }
  for (const field of ['summary', 'contact', 'location'] as const) {
    if (before[field] !== after[field]) changed.push(field);
  }
  return changed;
}

/** User statement content per field (CASE_METADATA, 05 §7.1). A cleared value is recorded as ''. */
function statementFor(field: Field, value: Metadata) {
  if (field === 'incidentTime') {
    if (value.incidentTime) {
      return {
        subject: 'case.incident_time',
        valueText: value.incidentTime.toISOString(),
        normalizedValue: value.incidentTimePrecision,
        valueDatetime: value.incidentTime,
      };
    }
    return {
      subject: 'case.incident_time',
      valueText: value.incidentTimePrecision ?? '',
      normalizedValue: value.incidentTimePrecision,
    };
  }
  return { subject: `case.${field}`, valueText: value[field] ?? '' };
}

/** Case lifecycle (05 #1, #2, #15–#17, #37). Owns the `cases` table writes for metadata. */
@Injectable()
export class CasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CaseAccessService,
    private readonly audit: AuditService,
    private readonly provenance: ProvenanceService,
    private readonly readModel: CaseReadModel,
  ) {}

  async create(input: CreateCaseInput, actor: Actor): Promise<CaseResponse> {
    const next = merge(EMPTY, input);
    assertPairing(next);
    const caseId = await this.prisma.$transaction(async (tx) => {
      // status defaults to NEW and case_reference comes from case_reference_seq (03 §5.1).
      const kase = await tx.case.create({
        data: {
          userId: actor.userId,
          incidentTime: next.incidentTime,
          incidentTimePrecision: next.incidentTimePrecision,
          contactText: next.contact,
          locationText: next.location,
          summary: next.summary,
        },
        select: { id: true },
      });
      await this.recordStatements(tx, kase.id, changedFields(EMPTY, next), next, actor);
      await this.audit.record(tx, {
        action: 'CASE_CREATED',
        outcome: 'SUCCEEDED',
        actorUserId: actor.userId,
        caseId: kase.id,
        targetType: 'case',
        targetId: kase.id,
        requestId: actor.requestId,
        metadata: { statusTo: 'NEW' },
      });
      return kase.id;
    });
    return this.readModel.getCase(caseId);
  }

  async get(caseId: string, actor: Actor): Promise<CaseResponse> {
    await this.access.assertCaseAccess(actor.userId, caseId);
    return this.readModel.getCase(caseId);
  }

  async list(actor: Actor, query: { limit?: number; cursor?: string }): Promise<CaseListResponse> {
    return this.readModel.listCases(actor.userId, query.limit ?? 20, decodeCursor(query.cursor));
  }

  /** Metadata edits never change the case status (05 §7.5). */
  async update(caseId: string, input: UpdateCaseInput, actor: Actor): Promise<CaseResponse> {
    await this.prisma.$transaction(async (tx) => {
      await this.access.assertCaseAccess(actor.userId, caseId, { db: tx, lock: true });
      const stored = await tx.case.findUniqueOrThrow({ where: { id: caseId } });
      const before: Metadata = {
        incidentTime: stored.incidentTime,
        incidentTimePrecision: stored.incidentTimePrecision,
        contact: stored.contactText,
        location: stored.locationText,
        summary: stored.summary,
      };
      const next = merge(before, input);
      assertPairing(next);
      const changed = changedFields(before, next);
      if (changed.length === 0) return;

      await tx.case.update({
        where: { id: caseId },
        data: {
          incidentTime: next.incidentTime,
          incidentTimePrecision: next.incidentTimePrecision,
          contactText: next.contact,
          locationText: next.location,
          summary: next.summary,
        },
      });
      await this.recordStatements(tx, caseId, changed, next, actor);
      await this.audit.record(tx, {
        action: 'CASE_UPDATED',
        outcome: 'SUCCEEDED',
        actorUserId: actor.userId,
        caseId,
        targetType: 'case',
        targetId: caseId,
        requestId: actor.requestId,
        metadata: {
          incidentTimeChanged: changed.includes('incidentTime'),
          summaryChanged: changed.includes('summary'),
          contactChanged: changed.includes('contact'),
          locationChanged: changed.includes('location'),
        },
      });
    });
    return this.readModel.getCase(caseId);
  }

  /**
   * Hard delete in one transaction (03 §24.1). Every case-owned row cascades; content-free audit
   * rows and the CASE_DELETED tombstone remain. Stored objects are removed after commit once
   * evidence storage exists (Phase 4).
   */
  async delete(caseId: string, confirm: string | undefined, actor: Actor): Promise<void> {
    if (confirm !== 'true') {
      throw new ApiError(400, 'CONFIRMATION_REQUIRED', 'Confirm the deletion to continue.');
    }
    await this.prisma.$transaction(async (tx) => {
      const owned = await this.access.assertCaseAccess(actor.userId, caseId, {
        db: tx,
        lock: true,
      });
      await tx.case.delete({ where: { id: caseId } });
      await this.audit.record(tx, {
        action: 'CASE_DELETED',
        outcome: 'SUCCEEDED',
        actorUserId: actor.userId,
        caseId,
        targetType: 'case',
        targetId: caseId,
        requestId: actor.requestId,
        metadata: { statusFrom: owned.status },
      });
    });
  }

  /** Content-free case audit log, newest first (05 §22). */
  async auditLog(
    caseId: string,
    actor: Actor,
    query: { limit?: number; cursor?: string },
  ): Promise<AuditLogResponse> {
    await this.access.assertCaseAccess(actor.userId, caseId);
    const limit = query.limit ?? 50;
    const after = decodeCursor(query.cursor);
    const position = after
      ? Prisma.sql`AND (occurred_at, id) < (${after.at}::timestamptz, ${after.id}::uuid)`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        occurred_at: Date;
        cursor_at: string;
        actor_kind: 'USER' | 'SYSTEM';
        actor_user_id: string | null;
        action: string;
        target_type: string | null;
        target_id: string | null;
        outcome: string;
        request_id: string | null;
        metadata: Record<string, unknown>;
      }[]
    >`
      SELECT id, occurred_at, ${Prisma.raw(cursorTimestampSql('occurred_at'))} AS cursor_at,
             actor_kind::text AS actor_kind, actor_user_id, action, target_type, target_id,
             outcome::text AS outcome, request_id, metadata
      FROM audit_logs
      WHERE case_id = ${caseId}::uuid ${position}
      ORDER BY occurred_at DESC, id DESC
      LIMIT ${limit + 1}`;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      entries: page.map((row) => ({
        id: row.id,
        occurredAt: row.occurred_at.toISOString(),
        actorKind: row.actor_kind,
        actorIsYou: row.actor_user_id === actor.userId,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        outcome: row.outcome,
        requestId: row.request_id,
        metadata: row.metadata,
      })),
      nextCursor:
        rows.length > limit && last ? encodeCursor({ at: last.cursor_at, id: last.id }) : null,
    };
  }

  private async recordStatements(
    tx: Prisma.TransactionClient,
    caseId: string,
    fields: Field[],
    value: Metadata,
    actor: Actor,
  ): Promise<void> {
    for (const field of fields) {
      await this.provenance.recordStatement(tx, {
        caseId,
        authorUserId: actor.userId,
        kind: 'CASE_METADATA',
        ...statementFor(field, value),
      });
    }
  }
}
