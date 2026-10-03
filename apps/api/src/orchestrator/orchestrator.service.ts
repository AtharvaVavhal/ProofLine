import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { AgentStep, EvidenceItem, Prisma, StepName } from '@prisma/client';
import type { ActivityResponse, StartAnalysisResponse } from '@proofline/shared';
import type { AiCallMetrics } from '../ai/ai-gateway.service';
import { AuditService } from '../audit/audit.service';
import { CaseAccessService } from '../cases/case-access.service';
import { CaseStateService } from '../cases/case-state.service';
import { ApiError } from '../common/api-error';
import { PrismaService } from '../database/prisma.service';
import {
  CorrelationService,
  CorrelationFailure,
  CorrelationInputChanged,
  PreparedCorrelation,
} from '../graph/correlation.service';
import { EntityResolutionService } from '../entities/entity-resolution.service';
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
import {
  ANALYSIS_PLAN,
  AVAILABLE_CASE_STEPS,
  DEPENDENCIES,
  UNAVAILABLE_STEPS,
  planFor,
} from './analysis-plan';
import { CASE_STEP_PROCESSORS, CaseStepFailure, CaseStepProcessor } from './case-step-processor';
export { planFor } from './analysis-plan';

type Actor = { userId: string; requestId: string };

/**
 * Complete step contracts (06 §4.2). DECISIONS §12 separates infrastructure readiness from
 * the final joint Gate G. Unavailable processors stay pending, never successful.
 */
export const PHASE_PLAN: readonly StepName[] = ANALYSIS_PLAN;

/** Items processed in parallel inside one run (07 §29: limited concurrency). */
const ITEM_CONCURRENCY = 2;

/** Step idempotency key part: sha256(evidence.sha256 ‖ step) (07 §24). */
export const stepInputHash = (sha256: string, step: StepName) =>
  createHash('sha256').update(`${sha256}${step}`).digest('hex');

class CaseGoneError extends Error {}

/**
 * Case orchestration (14 R-N3; 06 §4; 04 §14): one active run per
 * case, a stored plan, idempotent processors, and run/step status. It never calls
 * an LLM itself; EXTRACT reaches the model only through the extraction module and the gateway.
 */
@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger('Orchestrator');
  private readonly executing = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CaseAccessService,
    private readonly audit: AuditService,
    private readonly runs: AnalysisRunsService,
    private readonly lifecycle: EvidenceLifecycleService,
    private readonly processing: ProcessingService,
    private readonly extraction: ExtractionService,
    private readonly entityResolution: EntityResolutionService,
    private readonly correlation: CorrelationService,
    private readonly caseState: CaseStateService,
    @Optional() @Inject(CASE_STEP_PROCESSORS) private readonly processors: CaseStepProcessor[] = [],
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
    // pg-boss serialises normal deliveries; this also coalesces same-process redelivery.
    // Every write still verifies the run/case under a database lock.
    if (this.executing.has(job.runId)) return;
    this.executing.add(job.runId);
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
      if (!(await this.evidenceGate(job))) {
        await this.finishRun(job.runId);
        return;
      }
      for (const stepName of ANALYSIS_PLAN.slice(3)) {
        if (
          !AVAILABLE_CASE_STEPS.includes(stepName) &&
          !this.processors.some((p) => p.name === stepName)
        )
          continue;
        const steps = await this.prisma.agentStep.findMany({
          where: {
            runId: job.runId,
            caseId: job.caseId,
            stepName,
            status: { in: ['PENDING', 'RUNNING'] },
          },
        });
        for (const step of steps) await this.runCaseStep(step);
      }
      await this.finishRun(job.runId);
    } catch (error) {
      if (error instanceof CaseGoneError || !(await this.caseExists(job.caseId))) return; // INV-D2
      this.logger.error(
        `Run failed unexpectedly: ${error instanceof Error ? error.constructor.name : 'unknown'}`,
      );
      await this.failRun(job.runId, 'INTERNAL_ERROR', true).catch(() => undefined);
    } finally {
      this.executing.delete(job.runId);
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

      const state = await tx.case.findUniqueOrThrow({ where: { id: job.caseId } });
      const statement = await tx.userStatement.findFirst({
        where: { caseId: job.caseId, statementKind: { in: ['CORRECTION', 'FOLLOW_UP_ANSWER'] } },
        orderBy: { createdAt: 'desc' },
      });
      const plan = planFor(run.trigger, {
        state: state.status,
        timeChanged: statement?.valueDatetime !== null && statement?.valueDatetime !== undefined,
      });
      const evidence = await tx.evidenceItem.findMany({
        where: { caseId: job.caseId },
        orderBy: { sequenceNo: 'asc' },
      });
      const items = plan.includes('PARSE')
        ? await tx.evidenceItem.findMany({
            where: {
              caseId: job.caseId,
              uploadedAt: { lte: run.createdAt },
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
          outputSummary: {
            items: items.length,
            evidence: evidence.map((e) => ({ id: e.id, sha256: e.sha256 })),
            statements: await this.statementIds(tx, job.caseId),
          },
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
      for (const [index, stepName] of ANALYSIS_PLAN.slice(3).entries()) {
        if (plan.includes(stepName)) {
          await tx.agentStep.create({
            data: {
              runId: run.id,
              caseId: job.caseId,
              stepName,
              sequenceNo: 2 + items.length * 2 + index,
            },
          });
        }
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
      await this.prisma.$transaction(async (tx) => {
        if (!(await this.lockCaseStep(tx, step))) return;
        const current = await tx.agentStep.findUniqueOrThrow({ where: { id: step.id } });
        await tx.agentStep.update({
          where: { id: step.id },
          data: {
            status: current.status === 'PENDING' ? 'SKIPPED' : 'SUCCEEDED',
            outputSummary: { reusedStepId: prior.id },
            finishedAt: new Date(),
          },
        });
      });
      return;
    }

    const claimed = await this.prisma.$transaction(async (tx) => {
      if (!(await this.lockCaseStep(tx, step))) return false;
      await tx.agentStep.update({
        where: { id: step.id },
        data: { status: 'RUNNING', startedAt: step.startedAt ?? new Date() },
      });
      return true;
    });
    if (!claimed) return;

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
        const cases = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM cases WHERE id = ${step.caseId}::uuid FOR UPDATE`;
        if (!cases.length) throw new CaseGoneError();
        if (!(await this.lockCaseStep(tx, step))) return;
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
    const item = await this.prisma.$transaction(async (tx) => {
      if (!(await this.lockCaseStep(tx, step))) return null;
      const item = step.evidenceId
        ? await tx.evidenceItem.findFirst({
            where: { id: step.evidenceId, caseId: step.caseId },
          })
        : null;
      if (!item || stepInputHash(item.sha256 ?? '', 'EXTRACT') !== step.inputHash) {
        await this.completeStep(tx, step.id, {
          status: 'FAILED',
          failureCode: 'CASE_CHANGED_DURING_RUN',
          failureRetryable: true,
        });
        return null;
      }
      if (item.processingStatus !== 'PROCESSING') {
        // A failed PARSE contributes no extraction work. Skip before starting the processor.
        const current = await tx.agentStep.findUniqueOrThrow({ where: { id: step.id } });
        await tx.agentStep.update({
          where: { id: step.id },
          data: {
            status: current.status === 'PENDING' ? 'SKIPPED' : 'FAILED',
            ...(current.status === 'RUNNING'
              ? { failureCode: 'CASE_CHANGED_DURING_RUN', failureRetryable: true }
              : {}),
            finishedAt: new Date(),
          },
        });
        return null;
      }
      await tx.agentStep.update({
        where: { id: step.id },
        data: { status: 'RUNNING', startedAt: step.startedAt ?? new Date() },
      });
      return item;
    });
    if (!item) return;

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
        const cases = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM cases WHERE id = ${step.caseId}::uuid FOR UPDATE`;
        if (!cases.length) throw new CaseGoneError();
        if (!(await this.lockCaseStep(tx, step))) return;
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

  /** Phase 7 case steps: facts + sources + completion commit under the same case lock. */
  private async runCaseStep(step: AgentStep): Promise<void> {
    const started = await this.prisma.$transaction(async (tx) => {
      if (!(await this.lockCaseStep(tx, step))) return false;
      if (!(await this.inputsUnchanged(tx, step.runId, step.caseId))) {
        await this.completeStep(tx, step.id, {
          status: 'FAILED',
          failureCode: 'CASE_CHANGED_DURING_RUN',
          failureRetryable: true,
        });
        return false;
      }
      const prior = await tx.agentStep.findMany({
        where: { runId: step.runId, sequenceNo: { lt: step.sequenceNo } },
      });
      // An upstream failure already fails the run with its own code: skip, don't misreport it.
      if (prior.some((s) => s.status === 'FAILED')) {
        await tx.agentStep.update({
          where: { id: step.id },
          data: { status: 'SKIPPED', finishedAt: new Date() },
        });
        return false;
      }
      // An item step whose evidence was deleted (evidence_id set null) means the case changed.
      if (
        prior.some((s) => ['PARSE', 'EXTRACT'].includes(s.stepName) && s.inputHash && !s.evidenceId)
      ) {
        await this.completeStep(tx, step.id, {
          status: 'FAILED',
          failureCode: 'CASE_CHANGED_DURING_RUN',
          failureRetryable: true,
        });
        return false;
      }
      const dependencies = prior.filter((s) => DEPENDENCIES[step.stepName]?.includes(s.stepName));
      if (dependencies.some((s) => s.status === 'PENDING' || s.status === 'RUNNING')) return false;
      // A skipped dependency cannot produce a successful downstream correlation step.
      if (!(await Promise.all(dependencies.map((s) => this.stepDone(tx, s)))).every(Boolean)) {
        await tx.agentStep.update({
          where: { id: step.id },
          data: { status: 'SKIPPED', finishedAt: new Date() },
        });
        return false;
      }
      const inputHash = await this.caseStepHash(tx, step.caseId, step.stepName);
      const run = await tx.analysisRun.findUniqueOrThrow({ where: { id: step.runId } });
      if (run.trigger === 'USER_RETRY') {
        const previous = await tx.analysisRun.findFirst({
          where: {
            caseId: step.caseId,
            id: { not: step.runId },
            kind: 'ANALYSIS',
            status: 'FAILED',
          },
          orderBy: { createdAt: 'desc' },
          include: { failedStep: true },
        });
        const failedName = previous?.failedStep?.stepName;
        const candidate = await tx.agentStep.findFirst({
          where: {
            caseId: step.caseId,
            stepName: step.stepName,
            inputHash,
            status: { in: ['SUCCEEDED', 'SKIPPED'] },
            runId: previous?.id ?? '00000000-0000-0000-0000-000000000000',
            id: { not: step.id },
          },
          orderBy: { finishedAt: 'desc' },
        });
        const reused =
          candidate && (await this.stepDone(tx, candidate))
            ? candidate.status === 'SUCCEEDED'
              ? candidate
              : await tx.agentStep.findUnique({
                  where: { id: (candidate.outputSummary as { reusedStepId: string }).reusedStepId },
                })
            : null;
        if (
          reused &&
          failedName &&
          ANALYSIS_PLAN.indexOf(step.stepName) < ANALYSIS_PLAN.indexOf(failedName)
        ) {
          await tx.agentStep.update({
            where: { id: step.id },
            data: {
              status: 'SKIPPED',
              inputHash,
              finishedAt: new Date(),
              outputSummary: { reusedStepId: reused.id },
            },
          });
          return false;
        }
      }
      await tx.agentStep.update({
        where: { id: step.id },
        data: { status: 'RUNNING', inputHash, startedAt: step.startedAt ?? new Date() },
      });
      return true;
    });
    if (!started) return;
    let prepared: PreparedCorrelation | null = null;
    let extension: Awaited<ReturnType<CaseStepProcessor['prepare']>> | null = null;
    try {
      const processor = this.processors.find((p) => p.name === step.stepName);
      if (processor)
        extension = await processor.prepare({
          caseId: step.caseId,
          runId: step.runId,
          stepId: step.id,
        });
      if (step.stepName === 'CORRELATE') prepared = await this.correlation.prepare(step.caseId);
      await this.prisma.$transaction(
        async (tx) => {
          if (!(await this.lockCaseStep(tx, step))) return;
          const current = await tx.agentStep.findUniqueOrThrow({ where: { id: step.id } });
          if (
            !(await this.inputsUnchanged(tx, step.runId, step.caseId)) ||
            current.inputHash !== (await this.caseStepHash(tx, step.caseId, step.stepName))
          ) {
            throw new CaseChangedError();
          }
          const summary = extension
            ? await extension.persist(tx)
            : step.stepName === 'NORMALIZE'
              ? await this.entityResolution.resolve(tx, step.caseId)
              : await this.correlation.save(tx, step.caseId, step.id, prepared!);
          await this.completeStep(tx, step.id, {
            status: 'SUCCEEDED',
            outputSummary: summary,
            ...aiColumns(extension?.metrics ?? prepared?.metrics ?? null),
          });
          await this.advanceLifecycle(tx, step.runId, step.caseId);
          if (extension?.metrics?.fallbackUsed || prepared?.metrics?.fallbackUsed) {
            await tx.analysisRun.update({
              where: { id: step.runId },
              data: { fallbackUsed: true },
            });
            await this.audit.record(tx, {
              action: 'FALLBACK_USED',
              outcome: 'SUCCEEDED',
              caseId: step.caseId,
              targetType: 'agent_step',
              targetId: step.id,
              metadata: { stepName: step.stepName },
            });
          }
        },
        { timeout: 30_000 },
      );
    } catch (error) {
      if (!(await this.caseExists(step.caseId))) throw new CaseGoneError();
      const code =
        error instanceof CorrelationInputChanged || error instanceof CaseChangedError
          ? 'CASE_CHANGED_DURING_RUN'
          : error instanceof CorrelationFailure || error instanceof CaseStepFailure
            ? error.code
            : step.stepName === 'NORMALIZE'
              ? 'NORMALIZE_FAILED'
              : step.stepName === 'CORRELATE'
                ? 'CORRELATION_FAILED'
                : 'INTERNAL_ERROR';
      // Fixed codes only: database/provider errors may embed source-derived values.
      this.logger.error(`${step.stepName} failed: ${code}`);
      await this.prisma.$transaction(async (tx) => {
        if (!(await this.lockCaseStep(tx, step))) return;
        await this.completeStep(tx, step.id, {
          status: 'FAILED',
          failureCode: code,
          failureRetryable: true,
          ...aiColumns(
            error instanceof CorrelationFailure || error instanceof CaseStepFailure
              ? error.metrics
              : (extension?.metrics ?? prepared?.metrics ?? null),
          ),
        });
      });
    }
  }

  private async lockCaseStep(tx: Prisma.TransactionClient, step: AgentStep): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM cases WHERE id = ${step.caseId}::uuid FOR UPDATE`;
    if (!rows.length) throw new CaseGoneError();
    const current = await tx.agentStep.findFirst({
      where: {
        id: step.id,
        caseId: step.caseId,
        runId: step.runId,
        status: { in: ['PENDING', 'RUNNING'] },
        run: { status: 'RUNNING' },
      },
    });
    return current !== null;
  }

  private statementIds(tx: Prisma.TransactionClient, caseId: string) {
    return tx.userStatement.findMany({
      where: { caseId },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
  }

  /** SKIPPED is completion only when it references actual same-case, same-input successful work. */
  private async stepDone(tx: Prisma.TransactionClient, step: AgentStep): Promise<boolean> {
    if (step.status === 'SUCCEEDED') return true;
    if (step.status !== 'SKIPPED') return false;
    const reused = step.outputSummary as { reusedStepId?: unknown } | null;
    if (typeof reused?.reusedStepId !== 'string' || !step.inputHash) return false;
    return (
      (await tx.agentStep.count({
        where: {
          id: reused.reusedStepId,
          caseId: step.caseId,
          stepName: step.stepName,
          inputHash: step.inputHash,
          status: 'SUCCEEDED',
        },
      })) === 1
    );
  }

  /** Lifecycle gates consume actual completion records, never the mere presence of a plan. */
  private async advanceLifecycle(tx: Prisma.TransactionClient, runId: string, caseId: string) {
    const steps = await tx.agentStep.findMany({ where: { runId, caseId } });
    const completed = await Promise.all(
      steps.map(async (s) => ({ name: s.stepName, done: await this.stepDone(tx, s) })),
    );
    const done = (name: StepName) => completed.some((s) => s.name === name && s.done);
    let state = (await tx.case.findUniqueOrThrow({ where: { id: caseId } })).status;
    const transition = async (to: typeof state) => {
      await this.caseState.transition(tx, { caseId, from: state, to });
      state = to;
    };
    if (state === 'EXTRACTED' && done('SCAM_ANALYSIS')) await transition('ANALYZING');
    if (state === 'ANALYZING' && done('SCAM_ANALYSIS') && done('CORRELATE'))
      await transition('CORRELATED');
    if (state === 'CORRELATED' && done('TIMELINE')) await transition('TIMELINE_READY');
    if (
      state === 'TIMELINE_READY' &&
      ['MISSING_INFO', 'ACTIONS', 'URGENCY'].every((n) => done(n as StepName))
    ) {
      await transition('ACTIONS_READY');
    }
  }

  /** IDs/hashes only. No source text or credentials in run metadata. */
  private async inputsUnchanged(tx: Prisma.TransactionClient, runId: string, caseId: string) {
    const plan = await tx.agentStep.findFirst({ where: { runId, caseId, stepName: 'PLAN' } });
    const snapshot = plan?.outputSummary as {
      evidence?: { id: string; sha256: string | null }[];
      statements?: { id: string }[];
    } | null;
    if (!snapshot?.evidence) return true; // persisted pre-P8 jobs still stop at the full-run gate
    const evidence = await tx.evidenceItem.findMany({
      where: { caseId },
      select: { id: true, sha256: true },
    });
    return (
      evidence.length === snapshot.evidence.length &&
      snapshot.evidence.every((e) =>
        evidence.some(
          (current) => current.id === e.id && (e.sha256 === null || e.sha256 === current.sha256),
        ),
      ) &&
      JSON.stringify(snapshot.statements) === JSON.stringify(await this.statementIds(tx, caseId))
    );
  }

  private async caseStepHash(tx: Prisma.TransactionClient, caseId: string, stepName: StepName) {
    const extractions = await tx.extraction.findMany({
      where: { caseId },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        normalizedValue: true,
        correctedNormalizedValue: true,
        correctionStatus: true,
      },
    });
    const evidence = await tx.evidenceItem.findMany({
      where: { caseId },
      orderBy: { id: 'asc' },
      select: { id: true, sha256: true, processingStatus: true },
    });
    return createHash('sha256')
      .update(
        JSON.stringify({
          stepName,
          evidence,
          extractions,
          statements: await this.statementIds(tx, caseId),
        }),
      )
      .digest('hex');
  }

  /** INV-E9: every registered item must be PROCESSED, including excluded/late uploads. */
  private async evidenceGate(job: AnalyzeCaseJob): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM cases WHERE id = ${job.caseId}::uuid FOR UPDATE`;
      if (!rows.length) throw new CaseGoneError();
      const run = await tx.analysisRun.findFirst({
        where: { id: job.runId, caseId: job.caseId, status: 'RUNNING' },
      });
      if (!run) return false;
      const failed = await tx.agentStep.count({ where: { runId: job.runId, status: 'FAILED' } });
      let code: string | null = null;
      if (!(await this.inputsUnchanged(tx, job.runId, job.caseId)))
        code = 'CASE_CHANGED_DURING_RUN';
      else if (!failed) {
        const evidence = await tx.evidenceItem.findMany({ where: { caseId: job.caseId } });
        if (!evidence.length || evidence.some((e) => e.processingStatus !== 'PROCESSED'))
          code = 'EVIDENCE_PENDING';
      }
      if (code || failed) {
        const pending = await tx.agentStep.findMany({
          where: {
            runId: job.runId,
            status: 'PENDING',
            stepName: { notIn: ['PLAN', 'PARSE', 'EXTRACT'] },
          },
          orderBy: { sequenceNo: 'asc' },
        });
        if (code && pending[0])
          await this.completeStep(tx, pending[0].id, {
            status: 'FAILED',
            failureCode: code,
            failureRetryable: true,
          });
        await tx.agentStep.updateMany({
          where: { runId: job.runId, status: 'PENDING' },
          data: { status: 'SKIPPED', finishedAt: new Date() },
        });
        return false;
      }
      const kase = await tx.case.findUniqueOrThrow({ where: { id: job.caseId } });
      if (kase.status === 'INGESTING')
        await this.caseState.transition(tx, {
          caseId: job.caseId,
          from: kase.status,
          to: 'EXTRACTED',
        });
      return true;
    });
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
      await this.prisma.$transaction(async (tx) => {
        if (!(await this.lockCaseStep(tx, step))) return;
        await tx.agentStep.update({
          where: { id: step.id },
          data: {
            status: 'FAILED',
            failureCode: 'CASE_CHANGED_DURING_RUN',
            failureRetryable: true,
            finishedAt: new Date(),
          },
        });
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
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM cases WHERE id = ${run.caseId}::uuid FOR UPDATE`;
      if (!rows.length) return;
      const current = await tx.analysisRun.findUnique({ where: { id: runId } });
      if (current?.status !== 'RUNNING') return;
      // A mutation can commit after the last processor but before run completion.
      // Recheck under the same lock used to finalise the run; retain completed facts.
      if (!(await this.inputsUnchanged(tx, runId, run.caseId))) {
        await tx.analysisRun.update({
          where: { id: runId },
          data: {
            status: 'FAILED',
            failureCode: 'CASE_CHANGED_DURING_RUN',
            failureRetryable: true,
            finishedAt: new Date(),
          },
        });
        await this.audit.record(tx, {
          action: 'ANALYSIS_FAILED',
          outcome: 'FAILED',
          caseId: run.caseId,
          targetType: 'analysis_run',
          targetId: runId,
          metadata: { code: 'CASE_CHANGED_DURING_RUN' },
        });
        return;
      }
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
      if (await tx.agentStep.count({ where: { runId, status: { in: ['PENDING', 'RUNNING'] } } })) {
        // Missing processors are not successful steps or fabricated business outputs.
        // End the attempt using the existing error convention; retry retains completed facts.
        const unavailable = await tx.agentStep.findFirst({
          where: { runId, stepName: { in: [...UNAVAILABLE_STEPS] }, status: 'PENDING' },
          orderBy: { sequenceNo: 'asc' },
        });
        if (!unavailable) return;
        await tx.analysisRun.update({
          where: { id: runId },
          data: {
            status: 'FAILED',
            failedStepId: unavailable.id,
            failureCode: 'INTERNAL_ERROR',
            failureRetryable: true,
            finishedAt: new Date(),
          },
        });
        await this.audit.record(tx, {
          action: 'ANALYSIS_FAILED',
          outcome: 'FAILED',
          caseId: run.caseId,
          targetType: 'analysis_run',
          targetId: runId,
          metadata: { code: 'INTERNAL_ERROR' },
        });
        return;
      }
      const kase = await tx.case.findUniqueOrThrow({ where: { id: run.caseId } });
      const steps = await tx.agentStep.findMany({ where: { runId, caseId: run.caseId } });
      const plan = Array.isArray(run.plan) ? (run.plan as StepName[]) : [];
      const completed = await Promise.all(steps.map((s) => this.stepDone(tx, s)));
      const planComplete =
        plan.length > 0 &&
        plan.every(
          (name) =>
            steps.some((s) => s.stepName === name) &&
            steps.every((s, i) => s.stepName !== name || completed[i]),
        );
      if (kase.status !== 'ACTIONS_READY' || !planComplete) {
        await tx.analysisRun.update({
          where: { id: runId },
          data: {
            status: 'FAILED',
            failureCode: 'INTERNAL_ERROR',
            failureRetryable: true,
            finishedAt: new Date(),
          },
        });
        await this.audit.record(tx, {
          action: 'ANALYSIS_FAILED',
          outcome: 'FAILED',
          caseId: run.caseId,
          targetType: 'analysis_run',
          targetId: runId,
          metadata: { code: 'INTERNAL_ERROR' },
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
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM cases WHERE id = ${run.caseId}::uuid FOR UPDATE`;
      if (!rows.length) return;
      const current = await tx.analysisRun.findUnique({ where: { id: runId } });
      if (current?.status !== 'QUEUED' && current?.status !== 'RUNNING') return;
      const running = await tx.agentStep.findFirst({
        where: { runId, status: 'RUNNING' },
        orderBy: { sequenceNo: 'asc' },
      });
      if (running)
        await this.completeStep(tx, running.id, {
          status: 'FAILED',
          failureCode: code,
          failureRetryable: retryable,
        });
      await tx.agentStep.updateMany({
        where: { runId, status: 'PENDING' },
        data: { status: 'SKIPPED', finishedAt: new Date() },
      });
      await tx.analysisRun.update({
        where: { id: runId },
        data: {
          status: 'FAILED',
          failureCode: code,
          failureRetryable: retryable,
          ...(running ? { failedStepId: running.id } : {}),
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
    case 'NORMALIZE':
      return 'Matched identical details across evidence';
    case 'CORRELATE':
      return 'Connected the evidence';
    case 'SCAM_ANALYSIS':
      return 'Checked for known scam patterns';
    case 'TIMELINE':
      return 'Rebuilt the timeline';
    case 'MISSING_INFO':
      return 'Checked for missing information';
    case 'ACTIONS':
      return 'Prepared next steps';
    case 'URGENCY':
      return 'Set urgency (rule-based)';
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
