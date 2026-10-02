import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * Per-action metadata whitelist (03 §19.2, 04 §20). Later phases add their actions here.
 * Values are limited to enum codes, counts and booleans, so evidence content, emails, IPs,
 * codes and tokens can never be recorded.
 */
const METADATA_WHITELIST = {
  AUTH_CODE_REQUESTED: ['code'],
  AUTH_SIGNED_IN: [],
  AUTH_SIGN_IN_FAILED: ['code'],
  AUTH_SIGNED_OUT: [],
  CASE_CREATED: ['statusTo'],
  CASE_UPDATED: ['incidentTimeChanged', 'summaryChanged', 'contactChanged', 'locationChanged'],
  CASE_STATUS_CHANGED: ['statusFrom', 'statusTo'],
  CASE_DELETED: ['statusFrom'],
} as const satisfies Record<string, readonly string[]>;

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

const ENUM_CODE = /^[A-Z][A-Z0-9_]*$/;

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
  const allowed: readonly string[] = METADATA_WHITELIST[action];
  for (const [key, value] of Object.entries(metadata)) {
    if (!allowed.includes(key)) {
      throw new AuditMetadataError(`Audit metadata key not allowed for ${action}`);
    }
    if (typeof value === 'string' && !ENUM_CODE.test(value)) {
      throw new AuditMetadataError(`Audit metadata value for ${action} must be an enum code`);
    }
  }
}
