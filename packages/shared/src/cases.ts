import { z } from 'zod';

/** Counts Unicode code points, matching PostgreSQL char_length() (03 §5.1 length CHECKs). */
const text = (max: number) =>
  z.string().refine((value) => [...value].length <= max, { message: `at most ${max} characters` });

export const INCIDENT_TIME_PRECISIONS = ['EXACT', 'APPROXIMATE', 'UNKNOWN'] as const;
export type IncidentTimePrecision = (typeof INCIDENT_TIME_PRECISIONS)[number];

/**
 * User-editable case fields (05 §7.1). All optional. `userId`, `caseReference`, `status`,
 * `incidentType` and every derived field are rejected as unknown fields.
 */
const caseFields = {
  incidentTime: z.iso.datetime().nullable().optional(),
  incidentTimePrecision: z.enum(INCIDENT_TIME_PRECISIONS).nullable().optional(),
  contact: text(200).nullable().optional(),
  location: text(200).nullable().optional(),
  summary: text(2000).nullable().optional(),
};

type CaseFieldsInput = {
  incidentTime?: string | null;
  incidentTimePrecision?: IncidentTimePrecision | null;
};

/** Body-level pairing: a time needs EXACT/APPROXIMATE; UNKNOWN needs no time (05 §7.1). */
function checkPairing(value: CaseFieldsInput, ctx: z.RefinementCtx): void {
  const { incidentTime, incidentTimePrecision } = value;
  if (
    typeof incidentTime === 'string' &&
    incidentTimePrecision !== 'EXACT' &&
    incidentTimePrecision !== 'APPROXIMATE'
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['incidentTimePrecision'],
      message: 'required with incidentTime',
    });
  }
  if (incidentTimePrecision === 'UNKNOWN' && typeof incidentTime === 'string') {
    ctx.addIssue({ code: 'custom', path: ['incidentTime'], message: 'must be null when UNKNOWN' });
  }
}

export const createCaseSchema = z.strictObject(caseFields).superRefine(checkPairing);
export type CreateCaseInput = z.infer<typeof createCaseSchema>;

/** PATCH accepts any subset of the create fields (05 §7.5). */
export const updateCaseSchema = z.strictObject(caseFields).superRefine(checkPairing);
export type UpdateCaseInput = z.infer<typeof updateCaseSchema>;

/** Opaque cursor pagination (05 §26). */
export const listCasesQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().max(200).optional(),
});

export const auditLogQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().max(200).optional(),
});

export const deleteCaseQuerySchema = z.strictObject({ confirm: z.string().optional() });

const EVIDENCE_STATUSES = ['UPLOADING', 'UPLOADED', 'PROCESSING', 'PROCESSED', 'FAILED'] as const;
export type EvidenceStatusCounts = Record<(typeof EVIDENCE_STATUSES)[number], number>;
export { EVIDENCE_STATUSES };

/** Case object (05 §7.3). */
export type CaseResponse = {
  id: string;
  caseReference: string;
  status: string;
  statusChangedAt: string;
  incidentTime: string | null;
  incidentTimePrecision: IncidentTimePrecision | null;
  contact: string | null;
  location: string | null;
  summary: string | null;
  incidentType: string | null;
  financialLossReported: boolean | null;
  evidence: { total: number; byStatus: EvidenceStatusCounts };
  latestRun: {
    id: string;
    kind: string;
    status: string;
    failedStep: string | null;
    fallbackUsed: boolean;
  } | null;
  scamSignals: unknown[];
  urgency: {
    assessed: boolean;
    level: string | null;
    outOfDate: boolean;
    ruleVersion: string | null;
    explanation: string | null;
    disclaimer: string | null;
    reasons: unknown[];
    computedAt: string | null;
  };
  entityCounts: Record<string, number>;
  report: {
    currentVersion: number;
    currentStatus: string;
    reviewed: boolean;
    confirmedAt: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
};

/** Case list item (05 §7.4). */
export type CaseListItem = {
  id: string;
  caseReference: string;
  status: string;
  incidentType: string | null;
  urgency: { level: string | null };
  evidence: { total: number };
  createdAt: string;
  updatedAt: string;
};

export type CaseListResponse = { items: CaseListItem[]; nextCursor: string | null };

/** Audit log (05 §22). The actor's user ID is never returned. */
export type AuditLogEntry = {
  id: string;
  occurredAt: string;
  actorKind: 'USER' | 'SYSTEM';
  actorIsYou: boolean;
  action: string;
  targetType: string | null;
  targetId: string | null;
  outcome: string;
  requestId: string | null;
  metadata: Record<string, unknown>;
};

export type AuditLogResponse = { entries: AuditLogEntry[]; nextCursor: string | null };
