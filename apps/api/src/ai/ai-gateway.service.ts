import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { StepName } from '@prisma/client';
import type { z } from 'zod';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env';
import { CachedLlmProvider } from './cached-llm-provider';
import {
  LLM_PROVIDER,
  LlmError,
  LlmErrorCode,
  LlmProvider,
  LlmResponse,
  isTransient,
} from './llm-provider';

/** Recorded on agent_steps (06 §22, §31). Never prompts, completions or evidence. */
export type AiCallMetrics = {
  provider: string;
  model: string;
  promptVersion: string;
  latencyMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  retryCount: number;
  fallbackUsed: boolean;
};

export type GenerateRequest<T> = {
  step: StepName;
  promptVersion: string;
  instructions: string;
  evidenceBlocks: string;
  /** JSON Schema bound to `submit_result`. */
  schema: Record<string, unknown>;
  /** Strict validation of the whole output; per-item checks belong to the calling step. */
  envelope: z.ZodType<T>;
  /** SHA-256 of every evidence item in the step's scope (fallback lookup, AD-06). */
  evidenceSha256s: string[];
};

/** A failed model call, with what was spent on it. */
export class AiCallFailure extends Error {
  constructor(
    readonly code: LlmErrorCode,
    readonly metrics: AiCallMetrics,
  ) {
    super(code);
  }
}

/**
 * The only component that talks to an LLM (04 §13.1, 06 §22): fixed timeout, one retry on a
 * transient error or one re-ask on invalid output, strict schema validation, metrics, and the
 * disclosed cached fallback for synthetic-manifest evidence only. The model's single "tool" is
 * `submit_result`; it gets no database, network, file or shell capability.
 */
@Injectable()
export class AiGateway {
  private readonly logger = new Logger('AiGateway');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly cached: CachedLlmProvider,
    @Optional() @Inject(LLM_PROVIDER) private readonly live: LlmProvider | null = null,
  ) {}

  /** Whether model-assisted steps run at all (a live adapter, or forced offline fallback). */
  get enabled(): boolean {
    return this.live !== null || this.config.ai.demoFallback === 'force';
  }

  async generate<T>(request: GenerateRequest<T>): Promise<{ output: T; metrics: AiCallMetrics }> {
    const started = Date.now();
    const mode = this.config.ai.demoFallback;
    let retryCount = 0;
    let tokensIn: number | null = null;
    let tokensOut: number | null = null;
    const metrics = (provider: string, model: string, fallbackUsed: boolean): AiCallMetrics => ({
      provider,
      model,
      promptVersion: request.promptVersion,
      latencyMs: Date.now() - started,
      tokensIn,
      tokensOut,
      retryCount,
      fallbackUsed,
    });

    const fallback = async (code: LlmErrorCode, provider: string, model: string) => {
      const cachedOutput = await this.cached.lookup(request.step, request.evidenceSha256s);
      const parsed = cachedOutput === null ? null : request.envelope.safeParse(cachedOutput);
      if (!parsed?.success) throw new AiCallFailure(code, metrics(provider, model, false));
      this.logger.warn(`Fallback used for step ${request.step}`);
      return {
        output: parsed.data,
        metrics: metrics(this.cached.name, this.cached.model, true),
      };
    };

    if (mode === 'force') {
      return fallback('PROVIDER_UNAVAILABLE', this.cached.name, this.cached.model);
    }
    const live = this.live;
    if (!live) {
      throw new AiCallFailure(
        'PROVIDER_UNAVAILABLE',
        metrics('none', this.config.ai.model ?? 'none', false),
      );
    }

    let reask = false;
    for (;;) {
      let response: LlmResponse;
      try {
        response = await this.call(live, { ...request, reask });
      } catch (error) {
        const code = error instanceof LlmError ? error.code : 'PROVIDER_UNAVAILABLE';
        if (isTransient(code) && retryCount === 0) {
          retryCount += 1;
          continue;
        }
        if (isTransient(code) && mode === 'auto') return fallback(code, live.name, live.model);
        throw new AiCallFailure(code, metrics(live.name, live.model, false));
      }
      tokensIn = (tokensIn ?? 0) + (response.tokensIn ?? 0);
      tokensOut = (tokensOut ?? 0) + (response.tokensOut ?? 0);
      const parsed = request.envelope.safeParse(parseOutput(response.output));
      if (parsed.success) {
        return { output: parsed.data, metrics: metrics(live.name, live.model, false) };
      }
      if (reask || retryCount > 0) {
        throw new AiCallFailure('INVALID_OUTPUT', metrics(live.name, live.model, false));
      }
      reask = true; // one re-ask with a generic message; nothing from the output is echoed
      retryCount += 1;
    }
  }

  private async call(
    provider: LlmProvider,
    request: GenerateRequest<unknown> & { reask: boolean },
  ): Promise<LlmResponse> {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new LlmError('TIMEOUT'));
      }, this.config.ai.timeoutMs);
    });
    try {
      return await Promise.race([
        provider.generateStructured(
          {
            step: request.step,
            promptVersion: request.promptVersion,
            instructions: request.instructions,
            evidenceBlocks: request.evidenceBlocks,
            schema: request.schema,
            reask: request.reask,
          },
          controller.signal,
        ),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Structured output may arrive as an object or as JSON text; anything else is invalid. */
function parseOutput(output: unknown): unknown {
  if (typeof output !== 'string') return output;
  try {
    return JSON.parse(output) as unknown;
  } catch {
    return undefined;
  }
}
