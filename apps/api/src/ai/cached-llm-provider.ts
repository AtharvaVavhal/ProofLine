import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type { StepName } from '@prisma/client';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env';

const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Cached LLM-step outputs for the committed synthetic dataset only (AD-06, 13 §37). Lookup is by
 * the SHA-256 of every evidence item in the step's scope: each must be in `manifest.json`, so an
 * unknown or modified file never gets cached results. It provides model outputs only; they
 * still pass every validator. Files: `<SYNTHETIC_DIR>/manifest.json` (13 §34) and
 * `<SYNTHETIC_DIR>/fallback/<STEP>/<sha256>.json`.
 */
@Injectable()
export class CachedLlmProvider {
  readonly name = 'cached';
  readonly model = 'synthetic-manifest';
  private manifest: Promise<Set<string>> | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** The cached output for this step and evidence set, or null when fallback cannot apply. */
  async lookup(step: StepName, evidenceSha256s: string[]): Promise<unknown> {
    if (evidenceSha256s.length !== 1) return null; // only per-item steps are cached so far
    const sha = evidenceSha256s[0]!;
    if (!SHA256.test(sha) || !(await this.manifestHashes()).has(sha)) return null;
    try {
      const file = path.join(this.config.ai.syntheticDir, 'fallback', step, `${sha}.json`);
      return JSON.parse(await readFile(file, 'utf8')) as unknown;
    } catch {
      return null;
    }
  }

  private manifestHashes(): Promise<Set<string>> {
    this.manifest ??= readFile(path.join(this.config.ai.syntheticDir, 'manifest.json'), 'utf8')
      .then((text) => {
        const parsed = JSON.parse(text) as { artifacts?: { sha256?: unknown }[] };
        return new Set(
          (parsed.artifacts ?? [])
            .map((a) => a.sha256)
            .filter((s): s is string => typeof s === 'string' && SHA256.test(s)),
        );
      })
      .catch(() => new Set<string>()); // no dataset committed yet → never used
    return this.manifest;
  }
}
