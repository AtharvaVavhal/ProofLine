import { createHash } from 'node:crypto';
import type { Response } from 'supertest';
import { loadConfig } from '../src/config/env';
import { S3ObjectStorage } from '../src/storage/s3-object-storage';
import { ORIGIN, TestApp } from './auth-app';

/** Direct storage access for assertions and fault injection (bypasses the signed URLs). */
export const adminStorage = new S3ObjectStorage(loadConfig().storage);

export const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export function api(t: TestApp, cookie: string) {
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

export const FILE_TYPES = {
  png: { filename: 'chat.png', declaredContentType: 'image/png' },
  jpeg: { filename: 'sms.jpg', declaredContentType: 'image/jpeg' },
  pdf: { filename: 'receipt.pdf', declaredContentType: 'application/pdf' },
  txt: { filename: 'note.txt', declaredContentType: 'text/plain' },
  eml: { filename: 'mail.eml', declaredContentType: 'message/rfc822' },
} as const;

/** Step 1: register a file; returns the evidence and the signed upload instructions. */
export async function registerFile(
  t: TestApp,
  cookie: string,
  caseId: string,
  type: keyof typeof FILE_TYPES,
  byteSize: number,
  extra: Record<string, unknown> = {},
) {
  const res = await api(t, cookie)
    .post(`/api/cases/${caseId}/evidence`, {
      source: 'FILE',
      ...FILE_TYPES[type],
      byteSize,
      ...extra,
    })
    .expect(201);
  return res.body as {
    evidence: { id: string; evidenceRef: string; [k: string]: unknown };
    upload: { url: string; method: string; headers: { 'Content-Type': string }; expiresAt: string };
  };
}

/** Step 2: the browser's direct PUT to storage. */
export async function putToStorage(
  upload: { url: string; headers: { 'Content-Type': string } },
  bytes: Buffer,
) {
  return fetch(upload.url, { method: 'PUT', body: bytes, headers: upload.headers });
}

/** Steps 1–3 for a file. Returns the completion response. */
export async function uploadFile(
  t: TestApp,
  cookie: string,
  caseId: string,
  type: keyof typeof FILE_TYPES,
  bytes: Buffer,
): Promise<Response> {
  const { evidence, upload } = await registerFile(t, cookie, caseId, type, bytes.length);
  const put = await putToStorage(upload, bytes);
  if (put.status !== 200) throw new Error(`storage PUT failed: ${put.status}`);
  return api(t, cookie).post(`/api/evidence/${evidence.id}/complete`);
}
