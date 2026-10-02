import { Injectable } from '@nestjs/common';
import type { CaseStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';

const ORDER: readonly CaseStatus[] = [
  'NEW',
  'INGESTING',
  'EXTRACTED',
  'ANALYZING',
  'CORRELATED',
  'TIMELINE_READY',
  'ACTIONS_READY',
  'REPORT_DRAFT',
  'USER_REVIEW',
  'EXPORTED',
];
const rank = (status: CaseStatus) => ORDER.indexOf(status);

/**
 * The case transition table of 03 §23.1. There is no FAILED case state; confirmation does not
 * change the status (R-1). Same-state "transitions" are no-ops and are not checked here.
 */
export function isAllowedTransition(from: CaseStatus, to: CaseStatus): boolean {
  switch (to) {
    case 'NEW':
    case 'INGESTING':
      return true; // evidence deleted (NEW if none remain) / new evidence from any state
    case 'EXTRACTED':
    case 'TIMELINE_READY':
    case 'ACTIONS_READY':
      // Forward from the previous state, or a rewind from any later state (S-4).
      return rank(from) === rank(to) - 1 || rank(from) > rank(to);
    case 'ANALYZING':
      return from === 'EXTRACTED';
    case 'CORRELATED':
      return from === 'ANALYZING';
    case 'REPORT_DRAFT':
      return from === 'ACTIONS_READY' || from === 'USER_REVIEW' || from === 'EXPORTED';
    case 'USER_REVIEW':
      return from === 'REPORT_DRAFT';
    case 'EXPORTED':
      return from === 'USER_REVIEW';
  }
}

export class InvalidCaseTransitionError extends Error {
  constructor(from: CaseStatus, to: CaseStatus) {
    super(`Case transition ${from} → ${to} is not allowed`);
  }
}

/** All case status changes go through here, with a CASE_STATUS_CHANGED audit entry (INV-C3). */
@Injectable()
export class CaseStateService {
  constructor(private readonly audit: AuditService) {}

  /** The caller must hold the case-row lock (CaseAccessService with `lock: true`). */
  async transition(
    db: Prisma.TransactionClient,
    params: {
      caseId: string;
      from: CaseStatus;
      to: CaseStatus;
      actorUserId?: string;
      requestId?: string;
    },
  ): Promise<void> {
    if (params.from === params.to) return;
    if (!isAllowedTransition(params.from, params.to)) {
      throw new InvalidCaseTransitionError(params.from, params.to);
    }
    await db.case.update({
      where: { id: params.caseId },
      data: { status: params.to, statusChangedAt: new Date() },
    });
    await this.audit.record(db, {
      action: 'CASE_STATUS_CHANGED',
      outcome: 'SUCCEEDED',
      actorUserId: params.actorUserId,
      caseId: params.caseId,
      targetType: 'case',
      targetId: params.caseId,
      requestId: params.requestId,
      metadata: { statusFrom: params.from, statusTo: params.to },
    });
  }

  /**
   * After an evidence row is removed (deletion, rejection, abandonment): `NEW` if no evidence
   * remains, otherwise `INGESTING` (03 §23.1). Returns the resulting status.
   */
  async settleAfterEvidenceRemoval(
    db: Prisma.TransactionClient,
    params: { caseId: string; from: CaseStatus; actorUserId?: string; requestId?: string },
  ): Promise<CaseStatus> {
    const remaining = await db.evidenceItem.count({ where: { caseId: params.caseId } });
    const to: CaseStatus = remaining === 0 ? 'NEW' : 'INGESTING';
    await this.transition(db, { ...params, to });
    return to;
  }
}
