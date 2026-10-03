import { Injectable } from '@nestjs/common';
import type { AnalysisRun, Prisma, RunTrigger } from '@prisma/client';
import type { AnalysisRunSummary } from '@proofline/shared';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../jobs/queue.service';

export const runSummary = (run: AnalysisRun): AnalysisRunSummary => ({
  id: run.id,
  kind: run.kind,
  status: run.status,
  trigger: run.trigger,
  plan: (run.plan as string[] | null) ?? null,
});

/**
 * Creates and enqueues analysis runs (owner of `analysis_runs`: orchestrator, 04 §5.4). Shared by
 * `POST /cases/:id/analyze` and the re-entry triggers (corrections, 06 §4.3), so every trigger
 * gets the same audit entry and the same singleton job. Callers hold the case-row lock.
 */
@Injectable()
export class AnalysisRunsService {
  constructor(
    private readonly audit: AuditService,
    private readonly queue: QueueService,
  ) {}

  /** The case's QUEUED or RUNNING run, if any (one per case: INV-Q1). */
  findActive(db: Prisma.TransactionClient, caseId: string): Promise<AnalysisRun | null> {
    return db.analysisRun.findFirst({ where: { caseId, status: { in: ['QUEUED', 'RUNNING'] } } });
  }

  async enqueue(
    db: Prisma.TransactionClient,
    params: { caseId: string; trigger: RunTrigger; userId: string; requestId?: string },
  ): Promise<AnalysisRun> {
    const run = await db.analysisRun.create({
      data: {
        caseId: params.caseId,
        kind: 'ANALYSIS',
        trigger: params.trigger,
        status: 'QUEUED',
        createdBy: params.userId,
      },
    });
    await this.audit.record(db, {
      action: 'ANALYSIS_STARTED',
      outcome: 'SUCCEEDED',
      actorUserId: params.userId,
      caseId: params.caseId,
      targetType: 'analysis_run',
      targetId: run.id,
      requestId: params.requestId,
      metadata: { trigger: params.trigger },
    });
    await this.queue.enqueueAnalysis(db, { caseId: params.caseId, runId: run.id });
    return run;
  }
}
