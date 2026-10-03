import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { AgentStep, EvidenceItem, Prisma, RunTrigger, StepName } from '@prisma/client';
import type { ActivityResponse, StartAnalysisResponse } from '@proofline/shared';
import type { AiCallMetrics } from '../ai/ai-gateway.service';
import { AuditService } from '../audit/audit.service';
import { CaseAccessService } from '../cases/case-access.service';
import { ApiError } from '../common/api-error';
import { PrismaService } from '../database/prisma.service';
import { EvidenceLifecycleService } from '../evidence/evidence-lifecycle.service';
import {
  ExtractionFailure,
  ExtractionInputChanged,
  ExtractionService,
  PreparedExtraction,
} from '../extraction/extraction.service';
import type { AnalyzeCaseJob } from '../jobs/queue.service';
import { ProcessingFailure } from '../processing/parsed-evidence';
import { ProcessingService } from '../processing/processing.service';
import { AnalysisRunsService, runSummary } from './analysis-runs.service';

type Actor = { userId: string; requestId: string };

/**
 * Steps implemented so far, in the established order (06 §4.2). Later phases append NORMALIZE,
 * SCAM_ANALYSIS, … ; until then an analysis run ends after EXTRACT, which marks items PROCESSED.
 */
export const PHASE_PLAN: StepName[] = ['PLAN', 'PARSE', 'EXTRACT'];

/**
 * Re-entry plans (06 §4.3) restricted to implemented steps. A correction re-runs NORMALIZE
 * onward and never re-parses evidence; none of those steps exists yet, so it plans only PLAN.
 */
export function planFor(trigger: RunTrigger): StepName[] {
  return trigger === 'CORRECTION' ? ['PLAN'] : PHASE_PLAN;
}

/** Items processed in parallel inside one run (07 §29: limited concurrency). */
const ITEM_CONCURRENCY = 2;

/** Step idempotency key part: sha256(evidence.sha256 ‖ step) (07 §24). */
export const stepInputHash = (sha256: string, step: StepName) =>
  createHash('sha256').update(`${sha256}${step}`).digest('hex');

class CaseGoneError extends Error {}

/**
 * Case orchestrator, minimal form until Phase 8 (14 R-N3; 06 §4; 04 §14): one active run per
 * case, a stored plan, idempotent PARSE and EXTRACT steps, and run/step status. It never calls
 * an LLM itself; EXTRACT reaches the model only through the extraction module and the gateway.
 */
@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger('Orchestrator');

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CaseAccessService,
    private readonly audit: AuditService,
    private readonly runs: AnalysisRunsService,
    private readonly lifecycle: EvidenceLifecycleService,
    private readonly processing: ProcessingService,
    private readonly extraction: ExtractionService,
  ) {}

  /** POST /cases/:id/analyze (05 §11.1). Asynchronous; returns the queued or already active run. */
  async start(
    caseId: string,
    actor: Actor,
  ): Promise<{ created: boolean; body: StartAnalysisResponse }> {
    return this.prisma.$transaction(async (tx) => {
      await this.access.assertCaseAccess(actor.userId, caseId, { db: tx, lock: true });
      const active = await this.runs.findActive(tx, caseId);
      if (active) {
        return { created: false, body: { run: runSummary(active), alreadyActive: true } };
      }

      const processable = await tx.evidenceItem.count({
        where: {
          caseId,
          OR: [
            { processingStatus: { in: ['UPLOADED', 'PROCESSED'] } },
            { processingStatus: 'FAILED', failureRetryable: true },
          ],
        },
      });
      if (processable === 0) {
        throw new ApiError(409, 'INVALID_CASE_STATE', 'Add evidence that can be analysed first.', {
          details: { reason: 'NO_PROCESSABLE_EVIDENCE' },
        });
      }

      const last = await tx.analysisRun.findFirst({
        where: { caseId, kind: 'ANALYSIS' },
        orderBy: { createdAt: 'desc' },
      });
      const trigger = last?.status === 'FAILED' ? 'USER_RETRY' : 'USER_START';
      const run = await this.runs.enqueue(tx, {
        caseId,
        trigger,
        userId: actor.userId,
        requestId: actor.requestId,
      });
      return { created: true, body: { run: runSummary(run) } };
    });
  }

  /** Worker entry point. Safe to call repeatedly for the same run (redelivery resumes it). */
  async execute(job: AnalyzeCaseJob): Promise<void> {
    try {
      const ready = await this.planRun(job);
      if (!ready) return;
      // PARSE ×N, then EXTRACT ×N (06 §4.2). Redelivery resumes unfinished steps.
      for (const [stepName, run] of [
        ['PARSE', (step: AgentStep) => this.runParseStep(step)],
        ['EXTRACT', (step: AgentStep) => this.runExtractStep(step)],
      ] as const) {
        const steps = await this.prisma.agentStep.findMany({
          where: { runId: job.runId, stepName, status: { in: ['PENDING', 'RUNNING'] } },
          orderBy: { sequenceNo: 'asc' },
        });
        await inPool(steps, ITEM_CONCURRENCY, run);
      }
      await this.finishRun(job.runId);
    } catch (error) {
      if (error instanceof CaseGoneError || !(await this.caseExists(job.caseId))) return; // INV-D2
      this.logger.error(
        `Run failed unexpectedly: ${error instanceof Error ? error.constructor.name : 'unknown'}`,
      );
      await this.failRun(job.runId, 'INTERNAL_ERROR', true).catch(() => undefined);
    }
  }

  /**
   * PLAN (06 §4.2): include UPLOADED and retryable FAILED items (none for a correction); store
   * the plan, one PARSE and one EXTRACT step per item.
   */
  private async planRun(job: AnalyzeCaseJob): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const [kase] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM cases WHERE id = ${job.caseId}::uuid FOR UPDATE`;
      if (!kase) return false;
      const run = await tx.analysisRun.findUnique({ where: { id: job.runId } });
      if (
        !run ||
        run.caseId !== job.caseId ||
        (run.status !== 'QUEUED' && run.status !== 'RUNNING')
      ) {
        return false; // stale or duplicate job
      }
      if (run.plan !== null) {
        if (run.status === 'QUEUED') {
          await tx.analysisRun.update({
            where: { id: run.id },
            data: { status: 'RUNNING', startedAt: new Date() },
          });
        }
        return true; // redelivery: resume
      }

      const plan = planFor(run.trigger);
      const items = plan.includes('PARSE')
        ? await tx.evidenceItem.findMany({
            where: {
              caseId: job.caseId,
              OR: [
                { processingStatus: 'UPLOADED' },
                { processingStatus: 'FAILED', failureRetryable: true },
              ],
            },
            orderBy: { sequenceNo: 'asc' },
          })
        : [];
      const now = new Date();
      await tx.agentStep.create({
        data: {
          runId: run.id,
          caseId: job.caseId,
          stepName: 'PLAN',
          sequenceNo: 1,
          status: 'SUCCEEDED',
          startedAt: now,
          finishedAt: now,
          outputSummary: { items: items.length },
        },
      });
      if (items.length > 0) {
        const perItem = (stepName: 'PARSE' | 'EXTRACT', offset: number) =>
          items.map((item, index) => ({
            runId: run.id,
            caseId: job.caseId,
            stepName,
            evidenceId: item.id,
            sequenceNo: offset + index,
            inputHash: stepInputHash(item.sha256!, stepName),
          }));
        await tx.agentStep.createMany({
          data: [...perItem('PARSE', 2), ...perItem('EXTRACT', 2 + items.length)],
        });
      }
      await this.lifecycle.markProcessing(
        tx,
        items.map((item) => item.id),
      );
      await tx.analysisRun.update({
        where: { id: run.id },
        data: { status: 'RUNNING', startedAt: now, plan },
      });
      return true;
    });
  }

  /** PARSE for one item: read + parse outside the transaction, then persist atomically. */
  private async runParseStep(step: AgentStep): Promise<void> {
    await this.prisma.agentStep.update({
      where: { id: step.id },
      data: { status: 'RUNNING', startedAt: new Date() },
    });

    // Idempotency (07 §24): the same evidence bytes already parsed successfully, and that parse
    // is still stored (EXTRACT failed later) → skip and reuse its lines.
    const prior = await this.prisma.agentStep.findFirst({
      where: {
        caseId: step.caseId,
        stepName: 'PARSE',
        evidenceId: step.evidenceId,
        inputHash: step.inputHash,
        status: 'SUCCEEDED',
        id: { not: step.id },
      },
      select: { id: true },
    });
    const storedParse =
      prior && step.evidenceId
        ? await this.prisma.parseResult.count({
            where: { evidenceId: step.evidenceId, agentStepId: prior.id, status: 'SUCCEEDED' },
          })
        : 0;
    if (prior && storedParse > 0) {
      await this.prisma.agentStep.update({
        where: { id: step.id },
        data: { status: 'SKIPPED', finishedAt: new Date() },
      });
      return;
    }

    const item = step.evidenceId
      ? await this.prisma.evidenceItem.findUnique({ where: { id: step.evidenceId } })
      : null;
    if (
      !item ||
      item.processingStatus !== 'PROCESSING' ||
      stepInputHash(item.sha256 ?? '', 'PARSE') !== step.inputHash
    ) {
      await this.markStepChanged(step);
      return;
    }

    let parsed: Awaited<ReturnType<ProcessingService['parse']>> | null = null;
    let failure: ProcessingFailure | null = null;
    try {
      parsed = await this.processing.parse(item);
    } catch (error) {
      failure =
        error instanceof ProcessingFailure
          ? error
          : new ProcessingFailure('EXTRACTION_FAILED', true);
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // Re-read under lock: the item may have been deleted or replaced meanwhile (07 §23).
        const [current] = await tx.$queryRaw<EvidenceItem[]>`
          SELECT id FROM evidence_items WHERE id = ${item.id}::uuid FOR UPDATE`;
        const fresh = current ? await tx.evidenceItem.findUnique({ where: { id: item.id } }) : null;
        if (!fresh || fresh.processingStatus !== 'PROCESSING' || fresh.sha256 !== item.sha256) {
          throw new CaseChangedError();
        }
        if (parsed) {
          const outcome = await this.processing.saveParsed(tx, fresh, step.id, parsed);
          await this.completeStep(tx, step.id, {
            status: 'SUCCEEDED',
            outputSummary: outcome.summary,
          });
        } else {
          const outcome = await this.processing.saveFailed(tx, fresh, step.id, failure!);
          await this.completeStep(tx, step.id, {
            status: 'FAILED',
            failureCode: outcome.code,
            failureRetryable: outcome.retryable,
          });
        }
      });
    } catch (error) {
      if (error instanceof CaseChangedError) {
        await this.markStepChanged(step);
        return;
      }
      if (!(await this.caseExists(step.caseId))) throw new CaseGoneError();
      throw error;
    }
  }

  /**
   * EXTRACT for one item (07 §16–§17): candidates and any model call outside the transaction,
   * then validation + extractions + PROCESSED atomically. Skipped when PARSE did not succeed.
   */
  private async runExtractStep(step: AgentStep): Promise<void> {
    await this.prisma.agentStep.update({
      where: { id: step.id },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
    const item = step.evidenceId
      ? await this.prisma.evidenceItem.findUnique({ where: { id: step.evidenceId } })
      : null;
    if (!item || stepInputHash(item.sha256 ?? '', 'EXTRACT') !== step.inputHash) {
      await this.markStepChanged(step);
      return;
    }
    if (item.processingStatus !== 'PROCESSING') {
      // PARSE failed for this item in this run (it is FAILED), so there is nothing to extract.
      await this.prisma.agentStep.update({
        where: { id: step.id },
        data: { status: 'SKIPPED', finishedAt: new Date() },
      });
      return;
    }

    let prepared: PreparedExtraction | null = null;
    let failure: ExtractionFailure | null = null;
    try {
      prepared = await this.extraction.prepare(item);
    } catch (error) {
      failure =
        error instanceof ExtractionFailure ? error : new ExtractionFailure('EXTRACTION_FAILED');
    }
    const metrics = prepared?.metrics ?? failure?.metrics ?? null;

    try {
      await this.prisma.$transaction(async (tx) => {
        const [current] = await tx.$queryRaw<EvidenceItem[]>`
          SELECT id FROM evidence_items WHERE id = ${item.id}::uuid FOR UPDATE`;
        const fresh = current ? await tx.evidenceItem.findUnique({ where: { id: item.id } }) : null;
        if (!fresh || fresh.processingStatus !== 'PROCESSING' || fresh.sha256 !== item.sha256) {
          throw new CaseChangedError();
        }
        if (prepared) {
          const summary = await this.extraction.save(tx, fresh, step.id, prepared);
          await this.completeStep(tx, step.id, {
            status: 'SUCCEEDED',
            outputSummary: summary as unknown as Prisma.InputJsonObject,
            ...aiColumns(metrics),
          });
        } else {
          await this.extraction.saveFailed(tx, fresh);
          await this.completeStep(tx, step.id, {
            status: 'FAILED',
            failureCode: failure!.stepCode,
            failureRetryable: true,
            ...aiColumns(metrics),
          });
        }
        if (metrics?.fallbackUsed) {
          // Disclosed fallback (FR-027): step, run and audit all record it.
          await tx.analysisRun.update({ where: { id: step.runId }, data: { fallbackUsed: true } });
          await this.audit.record(tx, {
            action: 'FALLBACK_USED',
            outcome: 'SUCCEEDED',
            caseId: step.caseId,
            targetType: 'agent_step',
            targetId: step.id,
            metadata: { stepName: 'EXTRACT', evidenceRef: fresh.evidenceRef },
          });
        }
      });
    } catch (error) {
      if (error instanceof CaseChangedError || error instanceof ExtractionInputChanged) {
        await this.markStepChanged(step);
        return;
      }
      if (!(await this.caseExists(step.caseId))) throw new CaseGoneError();
      throw error;
    }
  }

  private async completeStep(
    tx: Prisma.TransactionClient,
    stepId: string,
    data: {
      status: 'SUCCEEDED' | 'FAILED';
      outputSummary?: Prisma.InputJsonObject;
      failureCode?: string;
      failureRetryable?: boolean;
    } & Partial<ReturnType<typeof aiColumns>>,
  ): Promise<void> {
    await tx.agentStep.update({ where: { id: stepId }, data: { ...data, finishedAt: new Date() } });
  }

  /** Evidence deleted or changed during the run (05 §23; 06 §24). */
  private async markStepChanged(step: AgentStep): Promise<void> {
    try {
      await this.prisma.agentStep.update({
        where: { id: step.id },
        data: {
          status: 'FAILED',
          failureCode: 'CASE_CHANGED_DURING_RUN',
          failureRetryable: true,
          finishedAt: new Date(),
        },
      });
    } catch {
      throw new CaseGoneError();
    }
  }

  /** The run fails if any step failed; the first failed step is reported (04 §14.1). */
  private async finishRun(runId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const run = await tx.analysisRun.findUnique({ where: { id: runId } });
      if (!run || run.status !== 'RUNNING') return;
      const failed = await tx.agentStep.findMany({
        where: { runId, status: 'FAILED' },
        orderBy: { sequenceNo: 'asc' },
      });
      const first = failed[0];
      if (first) {
        // A deletion race is reported as such; otherwise the first failing item's code.
        const changed = failed.find((s) => s.failureCode === 'CASE_CHANGED_DURING_RUN');
        const reported = changed ?? first;
        await tx.analysisRun.update({
          where: { id: runId },
          data: {
            status: 'FAILED',
            failedStepId: reported.id,
            failureCode: reported.failureCode,
            failureRetryable: failed.some((s) => s.failureRetryable),
            finishedAt: new Date(),
          },
        });
        await this.audit.record(tx, {
          action: 'ANALYSIS_FAILED',
          outcome: 'FAILED',
          caseId: run.caseId,
          targetType: 'analysis_run',
          targetId: runId,
          metadata: { code: reported.failureCode ?? 'INTERNAL_ERROR' },
        });
        return;
      }
      await tx.analysisRun.update({
        where: { id: runId },
        data: { status: 'SUCCEEDED', finishedAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'ANALYSIS_COMPLETED',
        outcome: 'SUCCEEDED',
        caseId: run.caseId,
        targetType: 'analysis_run',
        targetId: runId,
      });
    });
  }

  private async failRun(runId: string, code: string, retryable: boolean): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const run = await tx.analysisRun.findUnique({ where: { id: runId } });
      if (!run || (run.status !== 'QUEUED' && run.status !== 'RUNNING')) return;
      await tx.analysisRun.update({
        where: { id: runId },
        data: {
          status: 'FAILED',
          failureCode: code,
          failureRetryable: retryable,
          finishedAt: new Date(),
        },
      });
      await this.audit.record(tx, {
        action: 'ANALYSIS_FAILED',
        outcome: 'FAILED',
        caseId: run.caseId,
        targetType: 'analysis_run',
        targetId: runId,
        metadata: { code },
      });
    });
  }

  private async caseExists(caseId: string): Promise<boolean> {
    return (await this.prisma.case.count({ where: { id: caseId } })) > 0;
  }

  /** GET /cases/:id/activity (05 §11.2): latest run, its steps and evidence progress. */
  async activity(caseId: string, actor: Actor): Promise<ActivityResponse> {
    await this.access.assertCaseAccess(actor.userId, caseId);
    const [run, processed, total] = await Promise.all([
      this.prisma.analysisRun.findFirst({
        where: { caseId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.evidenceItem.count({ where: { caseId, processingStatus: 'PROCESSED' } }),
      this.prisma.evidenceItem.count({ where: { caseId, processingStatus: { not: 'UPLOADING' } } }),
    ]);
    const steps = run
      ? await this.prisma.agentStep.findMany({
          where: { runId: run.id },
          orderBy: { sequenceNo: 'asc' },
          include: { evidence: { select: { evidenceRef: true } } },
        })
      : [];
    const iso = (d: Date | null) => d?.toISOString() ?? null;
    return {
      run: run
        ? {
            ...runSummary(run),
            fallbackUsed: run.fallbackUsed,
            startedAt: iso(run.startedAt),
            finishedAt: iso(run.finishedAt),
            failure:
              run.status === 'FAILED' && run.failureCode
                ? { code: run.failureCode, retryable: run.failureRetryable ?? false }
                : null,
          }
        : null,
      steps: steps.map((step) => ({
        id: step.id,
        stepName: step.stepName,
        evidenceRef: step.evidence?.evidenceRef ?? null,
        status: step.status,
        description: describe(step.stepName, step.evidence?.evidenceRef ?? null),
        fallbackUsed: step.fallbackUsed,
        startedAt: iso(step.startedAt),
        finishedAt: iso(step.finishedAt),
        failure:
          step.status === 'FAILED' && step.failureCode
            ? { code: step.failureCode, retryable: step.failureRetryable ?? false }
            : null,
      })),
      evidenceProgress: { processed, total },
      pollAfterMs: 1500,
    };
  }
}

class CaseChangedError extends Error {}

/** Model-call metadata for agent_steps (06 §22, §31); null columns when no model was called. */
function aiColumns(metrics: AiCallMetrics | null) {
  return {
    provider: metrics?.provider ?? null,
    model: metrics?.model ?? null,
    promptVersion: metrics?.promptVersion ?? null,
    latencyMs: metrics?.latencyMs ?? null,
    tokensIn: metrics?.tokensIn ?? null,
    tokensOut: metrics?.tokensOut ?? null,
    retryCount: metrics?.retryCount ?? 0,
    fallbackUsed: metrics?.fallbackUsed ?? false,
  };
}

function describe(step: StepName, evidenceRef: string | null): string {
  switch (step) {
    case 'PLAN':
      return 'Planned the analysis';
    case 'PARSE':
      return evidenceRef ? `Read text from ${evidenceRef}` : 'Read text from a removed item';
    case 'EXTRACT':
      return evidenceRef
        ? `Found key details in ${evidenceRef}`
        : 'Found key details in a removed item';
    default:
      return step;
  }
}

/** Runs tasks with at most `limit` in flight. */
async function inPool<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await task(item);
    }
  });
  await Promise.all(workers);
}
