import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AiCallFailure, AiGateway } from '../src/ai/ai-gateway.service';
import { CachedLlmProvider } from '../src/ai/cached-llm-provider';
import { LlmError, LlmProvider, LlmRequest, LlmResponse } from '../src/ai/llm-provider';
import type { AppConfig } from '../src/config/env';
import { extractEnvelopeSchema, extractOutputJsonSchema } from '../src/extraction/extract-prompt';

const MANIFEST_SHA = 'a'.repeat(64);
const UNKNOWN_SHA = 'b'.repeat(64);

/** A scripted provider: each call takes the next response (or error) and records the request. */
class ScriptedProvider implements LlmProvider {
  readonly name = 'fake';
  readonly model = 'fake-model';
  readonly requests: LlmRequest[] = [];
  constructor(private readonly script: (LlmResponse | LlmError | 'hang')[]) {}
  async generateStructured(request: LlmRequest, signal: AbortSignal): Promise<LlmResponse> {
    this.requests.push(request);
    const next = this.script.shift() ?? new LlmError('PROVIDER_UNAVAILABLE');
    if (next === 'hang') {
      return new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(new Error('aborted'))),
      );
    }
    if (next instanceof LlmError) throw next;
    return next;
  }
}

describe('AI gateway contract (06 §20, §22; 15 §27 AI-01–AI-12)', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'proofline-synthetic-'));
    writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ artifacts: [{ id: 'E01', sha256: MANIFEST_SHA }] }),
    );
    mkdirSync(path.join(dir, 'fallback', 'EXTRACT'), { recursive: true });
    writeFileSync(
      path.join(dir, 'fallback', 'EXTRACT', `${MANIFEST_SHA}.json`),
      JSON.stringify({ candidates: [{ fieldType: 'PERSON', value: 'Rohan', lineIds: ['L1'] }] }),
    );
    // A cached file for a hash that is not in the manifest must never be served.
    writeFileSync(
      path.join(dir, 'fallback', 'EXTRACT', `${UNKNOWN_SHA}.json`),
      JSON.stringify({ candidates: [] }),
    );
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const gateway = (
    provider: LlmProvider | null,
    demoFallback: 'off' | 'auto' | 'force' = 'off',
    timeoutMs = 1000,
  ) => {
    const config = {
      ai: { provider: 'none', model: null, timeoutMs, demoFallback, syntheticDir: dir },
    } as unknown as AppConfig;
    return new AiGateway(config, new CachedLlmProvider(config), provider);
  };
  const request = (sha = UNKNOWN_SHA) => ({
    step: 'EXTRACT' as const,
    promptVersion: 'extract-v1',
    instructions: 'fixed instructions',
    evidenceBlocks: '<evidence_data ref="E01" line="L1">text</evidence_data>',
    schema: extractOutputJsonSchema,
    envelope: extractEnvelopeSchema,
    evidenceSha256s: [sha],
  });
  const failure = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      if (error instanceof AiCallFailure)
        return [error.code, error.metrics.retryCount, error.metrics.fallbackUsed];
      throw error;
    }
    throw new Error('expected a failure');
  };

  it('AI-01: valid output is returned with metrics; the schema binds submit_result', async () => {
    const provider = new ScriptedProvider([
      { output: { candidates: [] }, tokensIn: 120, tokensOut: 8 },
    ]);
    const result = await gateway(provider).generate(request());
    expect(result.output).toEqual({ candidates: [] });
    expect(result.metrics).toMatchObject({
      provider: 'fake',
      model: 'fake-model',
      promptVersion: 'extract-v1',
      tokensIn: 120,
      tokensOut: 8,
      retryCount: 0,
      fallbackUsed: false,
    });
    expect(provider.requests[0]!.schema).toMatchObject({ additionalProperties: false });
    expect(provider.requests[0]!.images).toBeUndefined(); // text-only by default (06 §23)
  });

  it('AI-02: malformed output gets one generic re-ask, then fails retryably', async () => {
    const provider = new ScriptedProvider([{ output: '{not json' }, { output: 'still not json' }]);
    expect(await failure(gateway(provider).generate(request()))).toEqual([
      'INVALID_OUTPUT',
      1,
      false,
    ]);
    expect(provider.requests.map((r) => r.reask)).toEqual([false, true]);
    expect(provider.requests[1]!.evidenceBlocks).toBe(provider.requests[0]!.evidenceBlocks);
  });

  it('AI-02: a valid answer to the re-ask is accepted; JSON text is parsed', async () => {
    const provider = new ScriptedProvider([
      { output: { candidates: 'x' } },
      { output: '{"candidates":[]}' },
    ]);
    const result = await gateway(provider).generate(request());
    expect(result.output).toEqual({ candidates: [] });
    expect(result.metrics.retryCount).toBe(1);
  });

  it('AI-12: extra top-level fields are invalid output (additionalProperties: false)', async () => {
    const provider = new ScriptedProvider([
      { output: { candidates: [], note: 'hi' } },
      { output: { candidates: [], tool: 'fetch_url' } },
    ]);
    expect(await failure(gateway(provider).generate(request()))).toEqual([
      'INVALID_OUTPUT',
      1,
      false,
    ]);
  });

  it('AI-11: a timeout gets one retry, then fails; no fallback for unknown hashes', async () => {
    const provider = new ScriptedProvider(['hang', 'hang']);
    expect(await failure(gateway(provider, 'auto', 1000).generate(request(UNKNOWN_SHA)))).toEqual([
      'TIMEOUT',
      1,
      false,
    ]);
    expect(provider.requests).toHaveLength(2);
  });

  it('AI-11: transient errors recover on the retry', async () => {
    const provider = new ScriptedProvider([
      new LlmError('RATE_LIMITED'),
      { output: { candidates: [] } },
    ]);
    expect((await gateway(provider).generate(request())).metrics.retryCount).toBe(1);
  });

  it('refusals are not retried and never fall back', async () => {
    const provider = new ScriptedProvider([new LlmError('REFUSED')]);
    expect(await failure(gateway(provider, 'auto').generate(request(MANIFEST_SHA)))).toEqual([
      'REFUSED',
      0,
      false,
    ]);
    expect(provider.requests).toHaveLength(1);
  });

  it('DEMO_FALLBACK=auto serves cached output only for manifest hashes, disclosed', async () => {
    const down = () =>
      new ScriptedProvider([
        new LlmError('PROVIDER_UNAVAILABLE'),
        new LlmError('PROVIDER_UNAVAILABLE'),
      ]);
    const result = await gateway(down(), 'auto').generate(request(MANIFEST_SHA));
    expect(result.output).toEqual({
      candidates: [{ fieldType: 'PERSON', value: 'Rohan', lineIds: ['L1'] }],
    });
    expect(result.metrics).toMatchObject({ provider: 'cached', fallbackUsed: true });
    // A file whose hash is not in the manifest (unknown or modified) never gets cached results.
    expect(await failure(gateway(down(), 'auto').generate(request(UNKNOWN_SHA)))).toEqual([
      'PROVIDER_UNAVAILABLE',
      1,
      false,
    ]);
    // With fallback off, a manifest hash fails like any other.
    expect(await failure(gateway(down(), 'off').generate(request(MANIFEST_SHA)))).toEqual([
      'PROVIDER_UNAVAILABLE',
      1,
      false,
    ]);
  });

  it('DEMO_FALLBACK=force never calls the provider and still needs a manifest hash', async () => {
    const provider = new ScriptedProvider([{ output: { candidates: [] } }]);
    const g = gateway(provider, 'force');
    expect(g.enabled).toBe(true);
    expect((await g.generate(request(MANIFEST_SHA))).metrics.fallbackUsed).toBe(true);
    expect(await failure(g.generate(request(UNKNOWN_SHA)))).toEqual([
      'PROVIDER_UNAVAILABLE',
      0,
      false,
    ]);
    expect(provider.requests).toHaveLength(0);
  });

  it('LLM_PROVIDER=none: the gateway is disabled unless forced offline', async () => {
    expect(gateway(null, 'off').enabled).toBe(false);
    expect(gateway(null, 'auto').enabled).toBe(false);
    expect(await failure(gateway(null, 'auto').generate(request(MANIFEST_SHA)))).toEqual([
      'PROVIDER_UNAVAILABLE',
      0,
      false,
    ]);
  });
});
