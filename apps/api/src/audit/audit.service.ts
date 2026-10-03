import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/** The kinds of value audit metadata may hold. Free text is never allowed (03 §19.2). */
const VALUE_RULES = {
  code: (v: unknown) => typeof v === 'string' && /^[A-Z][A-Z0-9_]*$/.test(v),
  sha256: (v: unknown) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v),
  evidenceRef: (v: unknown) => typeof v === 'string' && /^E(0[1-9]|1[0-9]|20)$/.test(v),
  boolean: (v: unknown) => typeof v === 'boolean',
} as const;

type ValueKind = keyof typeof VALUE_RULES;

/**
 * Per-action metadata whitelist (03 §19.2, 04 §20, 09 §28). Later phases add their actions here.
 * Evidence content, filenames, labels, emails, IPs, codes and tokens can never be recorded.
 */
const METADATA_WHITELIST = {
  AUTH_CODE_REQUESTED: { code: 'code' },
  AUTH_SIGNED_IN: {},
  AUTH_SIGN_IN_FAILED: { code: 'code' },
  AUTH_SIGNED_OUT: {},
  CASE_CREATED: { statusTo: 'code' },
  CASE_UPDATED: {
    incidentTimeChanged: 'boolean',
    summaryChanged: 'boolean',
    contactChanged: 'boolean',
    locationChanged: 'boolean',
  },
  CASE_STATUS_CHANGED: { statusFrom: 'code', statusTo: 'code' },
  CASE_DELETED: { statusFrom: 'code' },
  EVIDENCE_UPLOADED: { evidenceRef: 'evidenceRef', sha256: 'sha256', code: 'code' },
  EVIDENCE_REJECTED: { evidenceRef: 'evidenceRef', code: 'code' },
  EVIDENCE_VIEWED: { evidenceRef: 'evidenceRef' },
  EVIDENCE_DELETED: { evidenceRef: 'evidenceRef', sha256: 'sha256' },
  EVIDENCE_PROCESSING_FAILED: { evidenceRef: 'evidenceRef', code: 'code' },
  ANALYSIS_STARTED: { trigger: 'code' },
  ANALYSIS_COMPLETED: {},
  ANALYSIS_FAILED: { code: 'code' },
  FALLBACK_USED: { stepName: 'code', evidenceRef: 'evidenceRef' },
  EXTRACTION_CORRECTED: { evidenceRef: 'evidenceRef', fieldType: 'code' },
  REPORT_CONFIRMATION_VOIDED: { code: 'code' },
} as const satisfies Record<string, Record<string, ValueKind>>;

export type AuditAction = keyof typeof METADATA_WHITELIST;

type MetadataValue = string | number | boolean;

export type AuditEntry = {
  action: AuditAction;
  outcome: 'SUCCEEDED' | 'FAILED' | 'DENIED';
  actorUserId?: string;
  caseId?: string;
  targetType?: string;
  targetId?: string;
  requestId?: string;
  metadata?: Record<string, MetadataValue>;
};

export class AuditMetadataError extends Error {}

/** Writes audit rows inside the caller's transaction, so a failed audit write fails the action. */
@Injectable()
export class AuditService {
  async record(db: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    const metadata = entry.metadata ?? {};
    assertWhitelisted(entry.action, metadata);
    await db.auditLog.create({
      data: {
        action: entry.action,
        outcome: entry.outcome,
        actorKind: entry.actorUserId ? 'USER' : 'SYSTEM',
        actorUserId: entry.actorUserId ?? null,
        caseId: entry.caseId ?? null,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        requestId: entry.requestId ?? null,
        metadata,
      },
    });
  }
}

function assertWhitelisted(action: AuditAction, metadata: Record<string, MetadataValue>): void {
  const allowed: Record<string, ValueKind> = METADATA_WHITELIST[action];
  for (const [key, value] of Object.entries(metadata)) {
    const kind = allowed[key];
    if (!kind) {
      throw new AuditMetadataError(`Audit metadata key not allowed for ${action}`);
    }
    if (!VALUE_RULES[kind](value)) {
      throw new AuditMetadataError(`Audit metadata value for ${action} has the wrong form`);
    }
  }
}
