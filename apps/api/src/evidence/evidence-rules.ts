import type { EvidenceType } from '@prisma/client';
import { EncryptedPDFError, PDFDocument } from 'pdf-lib';
import { parse as parseDomain } from 'tldts';

/** G-4 limits (DECISIONS §7.4; 07 §8). */
export const LIMITS = {
  maxBytes: 10_485_760,
  maxItemsPerCase: 20,
  maxPdfPages: 20,
  maxImagePixels: 40_000_000,
  maxPasteChars: 20_000,
  uploadUrlSeconds: 10 * 60,
  downloadUrlSeconds: 5 * 60,
  /** Abandoned UPLOADING rows are removed after the URL lifetime plus this grace period. */
  abandonedGraceSeconds: 5 * 60,
} as const;

export type RejectionCode =
  | 'TYPE_NOT_SUPPORTED'
  | 'EMAIL_FORMAT_NOT_SUPPORTED'
  | 'CONTENT_TYPE_MISMATCH'
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'PDF_TOO_MANY_PAGES'
  | 'PDF_ENCRYPTED'
  | 'IMAGE_TOO_LARGE'
  | 'TEXT_NOT_UTF8';

/** HTTP status and user message per rejection code (05 §8.2; 07 §22). */
export const REJECTIONS: Record<RejectionCode, { status: number; message: string }> = {
  TYPE_NOT_SUPPORTED: {
    status: 415,
    message: "This file type isn't supported. Use PNG, JPG, PDF, TXT or .eml.",
  },
  EMAIL_FORMAT_NOT_SUPPORTED: { status: 415, message: 'Save the email as .eml or paste its text.' },
  CONTENT_TYPE_MISMATCH: {
    status: 415,
    message: "This file doesn't match its type or is damaged.",
  },
  EMPTY_FILE: { status: 422, message: 'This file is empty.' },
  FILE_TOO_LARGE: { status: 413, message: 'Files can be up to 10 MB.' },
  PDF_TOO_MANY_PAGES: { status: 422, message: 'PDFs can have up to 20 pages.' },
  PDF_ENCRYPTED: { status: 422, message: "Password-protected PDFs can't be read." },
  IMAGE_TOO_LARGE: { status: 422, message: 'Images can be up to 40 megapixels.' },
  TEXT_NOT_UTF8: { status: 422, message: 'Text files must be UTF-8.' },
};

type FileType = { evidenceType: EvidenceType; contentType: string };

const BY_CONTENT_TYPE: Record<string, FileType> = {
  'image/png': { evidenceType: 'PNG', contentType: 'image/png' },
  'image/jpeg': { evidenceType: 'JPEG', contentType: 'image/jpeg' },
  'application/pdf': { evidenceType: 'PDF', contentType: 'application/pdf' },
  'text/plain': { evidenceType: 'TXT', contentType: 'text/plain' },
  'message/rfc822': { evidenceType: 'EML', contentType: 'message/rfc822' },
};

const EXTENSIONS: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  pdf: 'application/pdf',
  txt: 'text/plain',
  eml: 'message/rfc822',
};

const MAILBOX_EXTENSIONS = new Set(['msg', 'mbox', 'mbx', 'pst']);

/**
 * Registration check (07 §4): the declared MIME type must be supported and agree with the
 * filename extension. Mailbox formats get the dedicated email message.
 */
export function checkDeclaredType(
  filename: string,
  declaredContentType: string,
): { ok: true; type: FileType } | { ok: false; code: RejectionCode } {
  const dot = filename.lastIndexOf('.');
  const extension = dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
  if (MAILBOX_EXTENSIONS.has(extension)) return { ok: false, code: 'EMAIL_FORMAT_NOT_SUPPORTED' };
  const type = BY_CONTENT_TYPE[declaredContentType.trim().toLowerCase()];
  if (!type || EXTENSIONS[extension] !== type.contentType) {
    return { ok: false, code: 'TYPE_NOT_SUPPORTED' };
  }
  return { ok: true, type };
}

export function checkDeclaredSize(byteSize: number): RejectionCode | null {
  if (byteSize <= 0) return 'EMPTY_FILE';
  if (byteSize > LIMITS.maxBytes) return 'FILE_TOO_LARGE';
  return null;
}

export type Inspection =
  | {
      ok: true;
      detectedContentType: string;
      pageCount: number | null;
      imageWidth: number | null;
      imageHeight: number | null;
      sourceMetadata: Record<string, unknown>;
    }
  | { ok: false; code: RejectionCode };

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const OLE_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

type Sniffed = 'image/png' | 'image/jpeg' | 'application/pdf' | 'ole' | 'text' | 'binary';

function sniff(bytes: Buffer): Sniffed {
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(OLE_SIGNATURE)) return 'ole';
  if (bytes.subarray(0, 1024).includes('%PDF-')) return 'application/pdf';
  return decodeText(bytes) === null ? 'binary' : 'text';
}

/** Strict UTF-8 without NUL bytes (07 §8); returns null when the bytes are not such text. */
function decodeText(bytes: Buffer): string | null {
  if (bytes.includes(0)) return null;
  try {
    return utf8.decode(bytes);
  } catch {
    return null;
  }
}

const imageResult = (contentType: string, width: number, height: number): Inspection => {
  if (width <= 0 || height <= 0) return { ok: false, code: 'CONTENT_TYPE_MISMATCH' };
  if (width * height > LIMITS.maxImagePixels) return { ok: false, code: 'IMAGE_TOO_LARGE' };
  return {
    ok: true,
    detectedContentType: contentType,
    pageCount: null,
    imageWidth: width,
    imageHeight: height,
    sourceMetadata: {},
  };
};

/** PNG: the first chunk must be IHDR; reads its width and height only (header-only, 07 §8). */
function inspectPng(bytes: Buffer): Inspection {
  if (bytes.length < 24 || bytes.toString('latin1', 12, 16) !== 'IHDR') {
    return { ok: false, code: 'CONTENT_TYPE_MISMATCH' };
  }
  return imageResult('image/png', bytes.readUInt32BE(16), bytes.readUInt32BE(20));
}

/** JPEG: walks marker segments to the first SOF0/SOF2 frame header (07 §8). */
function inspectJpeg(bytes: Buffer): Inspection {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return { ok: false, code: 'CONTENT_TYPE_MISMATCH' };
    const marker = bytes[offset + 1]!;
    if (marker === 0xff) {
      offset += 1; // fill byte
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2; // markers without a length
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // EOI or start of scan before a frame header
    const length = bytes.readUInt16BE(offset + 2);
    if (marker === 0xc0 || marker === 0xc2) {
      if (offset + 9 > bytes.length) break;
      return imageResult(
        'image/jpeg',
        bytes.readUInt16BE(offset + 7),
        bytes.readUInt16BE(offset + 5),
      );
    }
    offset += 2 + length;
  }
  return { ok: false, code: 'CONTENT_TYPE_MISMATCH' };
}

/** PDF: structure only (no rendering). Encrypted → reject; 1–20 pages (07 §8). */
async function inspectPdf(bytes: Buffer): Promise<Inspection> {
  let pageCount: number;
  try {
    const document = await PDFDocument.load(bytes, { updateMetadata: false });
    pageCount = document.getPageCount();
  } catch (error) {
    // pdf-lib's CommonJS build loses the subclass prototype, so its fixed message is checked too.
    if (
      error instanceof EncryptedPDFError ||
      /is encrypted/.test(String((error as Error)?.message))
    ) {
      return { ok: false, code: 'PDF_ENCRYPTED' };
    }
    return { ok: false, code: 'CONTENT_TYPE_MISMATCH' };
  }
  if (pageCount < 1) return { ok: false, code: 'CONTENT_TYPE_MISMATCH' };
  if (pageCount > LIMITS.maxPdfPages) return { ok: false, code: 'PDF_TOO_MANY_PAGES' };
  return {
    ok: true,
    detectedContentType: 'application/pdf',
    pageCount,
    imageWidth: null,
    imageHeight: null,
    sourceMetadata: {},
  };
}

const HEADER_FIELD = /^[!-9;-~]+:/;

/**
 * EML shape (07 §8): text whose first non-empty lines are RFC 5322 header fields up to the
 * first blank line. A leading "From " line means an mbox export.
 */
function inspectEml(content: string): Inspection {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  let index = lines.findIndex((line) => line.trim() !== '');
  if (index === -1) return { ok: false, code: 'CONTENT_TYPE_MISMATCH' };
  if (lines[index]!.startsWith('From ')) return { ok: false, code: 'EMAIL_FORMAT_NOT_SUPPORTED' };
  let fields = 0;
  for (; index < lines.length && lines[index] !== ''; index += 1) {
    const line = lines[index]!;
    if (HEADER_FIELD.test(line)) fields += 1;
    else if (!(fields > 0 && /^[ \t]/.test(line)))
      return { ok: false, code: 'CONTENT_TYPE_MISMATCH' };
  }
  if (fields === 0) return { ok: false, code: 'CONTENT_TYPE_MISMATCH' };
  return {
    ok: true,
    detectedContentType: 'message/rfc822',
    pageCount: null,
    imageWidth: null,
    imageHeight: null,
    sourceMetadata: {},
  };
}

/**
 * Completion check on the stored bytes (07 §6–§8). Fails closed: anything that cannot be
 * confirmed as the declared type within the limits is rejected.
 */
export async function inspectUpload(
  bytes: Buffer,
  declaredContentType: string,
): Promise<Inspection> {
  if (bytes.length === 0) return { ok: false, code: 'EMPTY_FILE' };
  if (bytes.length > LIMITS.maxBytes) return { ok: false, code: 'FILE_TOO_LARGE' };

  const sniffed = sniff(bytes);
  if (sniffed === 'ole') return { ok: false, code: 'EMAIL_FORMAT_NOT_SUPPORTED' };

  switch (declaredContentType) {
    case 'image/png':
      return sniffed === 'image/png'
        ? inspectPng(bytes)
        : { ok: false, code: 'CONTENT_TYPE_MISMATCH' };
    case 'image/jpeg':
      return sniffed === 'image/jpeg'
        ? inspectJpeg(bytes)
        : { ok: false, code: 'CONTENT_TYPE_MISMATCH' };
    case 'application/pdf':
      return sniffed === 'application/pdf'
        ? inspectPdf(bytes)
        : { ok: false, code: 'CONTENT_TYPE_MISMATCH' };
    case 'text/plain': {
      if (sniffed !== 'text' && sniffed !== 'binary')
        return { ok: false, code: 'CONTENT_TYPE_MISMATCH' };
      if (decodeText(bytes) === null) return { ok: false, code: 'TEXT_NOT_UTF8' };
      const hadBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
      return {
        ok: true,
        detectedContentType: 'text/plain',
        pageCount: null,
        imageWidth: null,
        imageHeight: null,
        sourceMetadata: { encoding: 'utf-8', had_bom: hadBom },
      };
    }
    case 'message/rfc822': {
      const content = sniffed === 'text' ? decodeText(bytes) : null;
      return content === null ? { ok: false, code: 'CONTENT_TYPE_MISMATCH' } : inspectEml(content);
    }
    default:
      return { ok: false, code: 'TYPE_NOT_SUPPORTED' };
  }
}

/** Identifies the canonical-bytes rule used for paste fingerprints (03 §6.3, G-3). */
export const PASTE_CANONICALIZATION = 'G3-UTF8-NFC-LF-v1';

/** G-3 canonical form: UTF-8, Unicode NFC, CRLF and CR → LF. Nothing else changes (07 §13). */
export function canonicalizePaste(content: string): string {
  return content.normalize('NFC').replace(/\r\n?/g, '\n');
}

export const charCount = (value: string) => [...value].length;

const BARE_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}(?:\/\S*)?$/i;
const RESERVED_TLDS = new Set(['example', 'test']);

/**
 * URL paste (07 §8, §16): the whole canonical content must be an absolute http(s) URL, or a
 * bare host with a known TLD (public-suffix list, plus reserved `example` and `test`),
 * optionally followed by a path. The URL is never fetched.
 */
export function isPastedUrl(content: string): boolean {
  if (content.length === 0 || /\s/.test(content)) return false;
  if (/^https?:\/\//i.test(content)) {
    try {
      return new URL(content).hostname.length > 0;
    } catch {
      return false;
    }
  }
  if (!BARE_HOST.test(content)) return false;
  const host = content.split('/')[0]!.toLowerCase();
  const parsed = parseDomain(host);
  const tld = host.slice(host.lastIndexOf('.') + 1);
  return parsed.isIcann === true || RESERVED_TLDS.has(tld);
}
