import type { StepName } from '@prisma/client';

/**
 * The OD-02 contract: `generateStructured(schema, instructions, evidenceBlocks, images?)`. The
 * adapter binds `schema` to a single `submit_result` tool (04 §13.1); it exposes no other tool.
 * The vendor is an implementation decision (OD-02, DECISIONS §11); adapters live behind this port.
 */
export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  generateStructured(request: LlmRequest, signal: AbortSignal): Promise<LlmResponse>;
}

export type LlmRequest = {
  step: StepName;
  promptVersion: string;
  /** Application-authored layers 1–3 of 06 §18 (fixed, versioned). */
  instructions: string;
  /** Layer 4: delimited, redacted evidence blocks (data, never instructions). */
  evidenceBlocks: string;
  /** Layer 6: JSON Schema of the `submit_result` input (additionalProperties: false). */
  schema: Record<string, unknown>;
  /** Set on the single re-ask after invalid output; the message never echoes evidence. */
  reask?: boolean;
  /** OD-02 keeps optional image input; text-only is the default and nothing passes images. */
  images?: never[];
};

export type LlmResponse = { output: unknown; tokensIn?: number; tokensOut?: number };

/** Normalised provider failures (06 §22). Never surfaced raw to users. */
export type LlmErrorCode =
  'TIMEOUT' | 'PROVIDER_UNAVAILABLE' | 'RATE_LIMITED' | 'INVALID_OUTPUT' | 'REFUSED';

export class LlmError extends Error {
  constructor(readonly code: LlmErrorCode) {
    super(code);
  }
}

/** Errors worth one retry and, for manifest evidence, the disclosed fallback (04 §13.5). */
export const isTransient = (code: LlmErrorCode) =>
  code === 'TIMEOUT' || code === 'PROVIDER_UNAVAILABLE' || code === 'RATE_LIMITED';

/** DI token for the live provider; `null` when `LLM_PROVIDER=none`. */
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
