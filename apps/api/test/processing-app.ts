import { PassThrough, Readable } from 'node:stream';
import { LLM_PROVIDER, LlmProvider } from '../src/ai/llm-provider';
import { OCR_ENGINE, OcrEngine, OcrLine, OcrResult } from '../src/processing/ocr/ocr-engine';
import {
  OBJECT_STORAGE,
  ObjectNotFoundError,
  ObjectStorage,
  StorageUnavailableError,
} from '../src/storage/object-storage';
import { ORIGIN, ProviderOverride, TestApp, createTestApp } from './auth-app';

/**
 * In-memory ObjectStorage for pipeline tests (same port as the S3 adapter). "Browser uploads"
 * are simulated by writing bytes at the registered key.
 */
export class MemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, Buffer>();
  failReads = false;

  async createSignedUploadUrl(key: string) {
    return `memory://upload/${key}`;
  }
  async createSignedDownloadUrl(key: string) {
    return `memory://download/${key}`;
  }
  async headObject(key: string) {
    const object = this.objects.get(key);
    if (!object) throw new ObjectNotFoundError();
    return { byteSize: object.length };
  }
  async getObjectStream(key: string): Promise<Readable> {
    if (this.failReads) throw new StorageUnavailableError();
    const object = this.objects.get(key);
    if (!object) throw new ObjectNotFoundError();
    const stream = new PassThrough();
    stream.end(object);
    return stream;
  }
  async putObject(key: string, body: Buffer) {
    this.objects.set(key, Buffer.from(body));
  }
  async deleteObject(key: string) {
    this.objects.delete(key);
  }
}

/** Recorded OCR output (Doc 15 §16: downstream contracts use recorded OCR for determinism). */
export class FakeOcr implements OcrEngine {
  lines: OcrLine[] = [];
  error: Error | null = null;
  calls = 0;
  /** When set, recognition waits for this promise (for deletion-race tests). */
  gate: Promise<void> | null = null;

  async recognize(): Promise<OcrResult> {
    this.calls += 1;
    if (this.gate) await this.gate;
    if (this.error) throw this.error;
    return { engine: 'fake-ocr', engineVersion: '1', lines: this.lines };
  }
  async reset() {}
}

export const ocrLine = (
  text: string,
  block: number,
  y: number,
  x = 0.05,
  confidence = 0.9,
): OcrLine => ({
  text,
  block,
  confidence,
  bbox: { x, y, w: 0.5, h: 0.04 },
});

export type PipelineApp = TestApp & { storage: MemoryStorage; ocr: FakeOcr };

export async function createPipelineApp(
  options: { realOcr?: boolean; llm?: LlmProvider } = {},
): Promise<PipelineApp> {
  const storage = new MemoryStorage();
  const ocr = new FakeOcr();
  const overrides: ProviderOverride[] = [{ provide: OBJECT_STORAGE, useValue: storage }];
  if (!options.realOcr) overrides.push({ provide: OCR_ENGINE, useValue: ocr });
  if (options.llm) overrides.push({ provide: LLM_PROVIDER, useValue: options.llm });
  const t = await createTestApp(undefined, overrides);
  return Object.assign(t, { storage, ocr });
}

export function client(t: TestApp, cookie: string) {
  return {
    post: (path: string, body: unknown = {}) =>
      t
        .http()
        .post(path)
        .set('Origin', ORIGIN)
        .set('Cookie', cookie)
        .send(body as object),
    get: (path: string) => t.http().get(path).set('Cookie', cookie),
    del: (path: string) => t.http().delete(path).set('Origin', ORIGIN).set('Cookie', cookie),
  };
}

const TYPES = {
  png: { name: 'shot.png', type: 'image/png' },
  jpeg: { name: 'shot.jpg', type: 'image/jpeg' },
  pdf: { name: 'doc.pdf', type: 'application/pdf' },
  txt: { name: 'note.txt', type: 'text/plain' },
  eml: { name: 'mail.eml', type: 'message/rfc822' },
} as const;

/** Register → write bytes at the key (the browser PUT) → complete. Returns the evidence id. */
export async function addFile(
  t: PipelineApp,
  cookie: string,
  caseId: string,
  kind: keyof typeof TYPES,
  bytes: Buffer,
) {
  const api = client(t, cookie);
  const reg = await api
    .post(`/api/cases/${caseId}/evidence`, {
      source: 'FILE',
      filename: TYPES[kind].name,
      declaredContentType: TYPES[kind].type,
      byteSize: bytes.length,
    })
    .expect(201);
  const id = reg.body.evidence.id as string;
  await t.storage.putObject(`cases/${caseId}/evidence/${id}`, bytes);
  await api.post(`/api/evidence/${id}/complete`).expect(200);
  return id;
}

export async function addPaste(
  t: TestApp,
  cookie: string,
  caseId: string,
  content: string,
  pasteKind = 'MESSAGE',
) {
  const res = await client(t, cookie)
    .post(`/api/cases/${caseId}/evidence`, { source: 'PASTE', pasteKind, content })
    .expect(201);
  return res.body.evidence.id as string;
}

/** POST analyze, then poll the activity feed until the run finishes (OD-10 polling). */
export async function analyzeAndWait(
  t: TestApp,
  cookie: string,
  caseId: string,
  timeoutMs = 30_000,
) {
  const api = client(t, cookie);
  const start = await api.post(`/api/cases/${caseId}/analyze`);
  if (start.status !== 202)
    throw new Error(`analyze returned ${start.status}: ${JSON.stringify(start.body)}`);
  return waitForRun(t, cookie, caseId, start.body.run.id, timeoutMs);
}

export async function waitForRun(
  t: TestApp,
  cookie: string,
  caseId: string,
  runId: string,
  timeoutMs = 30_000,
) {
  const api = client(t, cookie);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const activity = await api.get(`/api/cases/${caseId}/activity`).expect(200);
    if (
      activity.body.run?.id === runId &&
      ['SUCCEEDED', 'FAILED'].includes(activity.body.run.status)
    ) {
      return activity.body;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('run did not finish in time');
}
