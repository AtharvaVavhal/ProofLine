import type { Readable } from 'node:stream';

/**
 * Vendor-agnostic object storage port (04 §9, 07 §5). Only the storage module holds
 * credentials. Keys are opaque (`cases/{caseId}/evidence/{evidenceId}`); never filenames.
 */
export interface ObjectStorage {
  /** Single-key, PUT-only URL with the content type and exact length bound into the signature. */
  createSignedUploadUrl(
    key: string,
    contentType: string,
    byteSize: number,
    expiresInSeconds: number,
  ): Promise<string>;
  /** Single-key, GET-only URL that forces a download (09 §11). */
  createSignedDownloadUrl(
    key: string,
    options: { contentType: string; downloadName: string; expiresInSeconds: number },
  ): Promise<string>;
  /** Returns the stored size, or throws ObjectNotFoundError. */
  headObject(key: string): Promise<{ byteSize: number }>;
  getObjectStream(key: string): Promise<Readable>;
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Idempotent: deleting a missing key succeeds. */
  deleteObject(key: string): Promise<void>;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export class ObjectNotFoundError extends Error {}

/** Any storage failure other than "not found"; mapped to 503 (05 §30). */
export class StorageUnavailableError extends Error {}

export const evidenceObjectKey = (caseId: string, evidenceId: string) =>
  `cases/${caseId}/evidence/${evidenceId}`;
