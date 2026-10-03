import type { Prisma, StepName } from '@prisma/client';
import type { AiCallMetrics } from '../ai/ai-gateway.service';
import type { LlmErrorCode } from '../ai/llm-provider';

/** Owning modules translate their errors to fixed codes, never source/provider messages. */
export class CaseStepFailure extends Error {
  constructor(
    readonly code: LlmErrorCode | 'INTERNAL_ERROR',
    readonly metrics: AiCallMetrics | null = null,
  ) {
    super(code);
  }
}

/** Internal owning-module contract (OD-12). No client can supply a processor or output.
 * prepare runs outside the write transaction; persist validates and writes facts/sources
 * atomically. Later modules supply their own implementation, never a success placeholder. */
export const CASE_STEP_PROCESSORS = Symbol('CASE_STEP_PROCESSORS');
export type StepContext = { caseId: string; runId: string; stepId: string };
export interface CaseStepProcessor {
  readonly name: Exclude<
    StepName,
    'PLAN' | 'PARSE' | 'EXTRACT' | 'NORMALIZE' | 'CORRELATE' | 'REPORT'
  >;
  prepare(context: StepContext): Promise<{
    metrics: AiCallMetrics | null;
    persist(tx: Prisma.TransactionClient): Promise<Prisma.InputJsonObject>;
  }>;
}
