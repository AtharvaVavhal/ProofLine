import { z } from 'zod';

/** Counts Unicode code points, matching PostgreSQL char_length(). */
const text = (max: number) =>
  z.string().refine((value) => [...value].length <= max, { message: `at most ${max} characters` });

export const PASTE_KINDS = ['MESSAGE', 'CHAT_TRANSCRIPT', 'URL'] as const;

/**
 * POST /cases/:id/evidence (05 §8.1). Type, size and length limits are checked by the server so
 * it can answer with the specific 413/415/422 codes; the schema only checks shape.
 */
export const registerEvidenceSchema = z.discriminatedUnion('source', [
  z.strictObject({
    source: z.literal('FILE'),
    filename: text(255).refine((v) => v.length > 0, { message: 'required' }),
    declaredContentType: z.string().max(255),
    byteSize: z.number().int(),
    label: text(100).nullable().optional(),
  }),
  z.strictObject({
    source: z.literal('PASTE'),
    pasteKind: z.enum(PASTE_KINDS),
    content: z.string(),
    label: text(100).nullable().optional(),
  }),
]);
export type RegisterEvidenceInput = z.infer<typeof registerEvidenceSchema>;

export const deleteEvidenceQuerySchema = z.strictObject({ confirm: z.string().optional() });

/** Evidence object (05 §8.4). */
export type EvidenceResponse = {
  id: string;
  evidenceRef: string;
  evidenceType: 'PNG' | 'JPEG' | 'PDF' | 'TXT' | 'EML' | 'TEXT' | 'URL';
  pasteKind: (typeof PASTE_KINDS)[number] | null;
  label: string | null;
  originalFilename: string | null;
  contentType: string | null;
  byteSize: number | null;
  pageCount: number | null;
  imageWidth: number | null;
  imageHeight: number | null;
  textCharCount: number | null;
  sha256: string | null;
  uploadedAt: string | null;
  processingStatus: 'UPLOADING' | 'UPLOADED' | 'PROCESSING' | 'PROCESSED' | 'FAILED';
  failure: { code: string; retryable: boolean; pagesWithoutText?: number[] } | null;
  integrity: {
    latestResult: 'NOT_YET_VERIFIED' | 'MATCH' | 'MISMATCH' | 'COULD_NOT_COMPLETE';
    verifiedAt: string | null;
  };
  email: {
    attachments: { filename: string; contentType: string; sizeBytes: number }[];
    attachmentsProcessed: false;
  } | null;
  createdAt: string;
};

export type RegisterEvidenceResponse = {
  evidence: EvidenceResponse;
  upload?: { url: string; method: 'PUT'; headers: { 'Content-Type': string }; expiresAt: string };
};

export type EvidenceListResponse = { items: EvidenceResponse[] };

export type EvidenceDownloadResponse = { url: string; expiresAt: string };

export type DeleteEvidenceResponse = {
  caseStatus: string;
  reportsInvalidated: number;
  exportsDeleted: number;
};
