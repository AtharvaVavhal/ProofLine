import type { EvidenceType } from '@prisma/client';
import {
  MIN_READABLE_CHARS,
  ParsedEvidence,
  ProcessingFailure,
  nonWhitespaceLength,
} from '../parsed-evidence';
import { splitLines } from '../text-lines';

const ENGINE = { engine: 'proofline-text', engineVersion: '1' };

/**
 * TXT files and pasted text/URL (07 §11, §13). Strict UTF-8 was checked at completion; the BOM
 * is dropped for parsing only (the fingerprint covers the original bytes).
 */
export function parseText(bytes: Buffer, evidenceType: EvidenceType): ParsedEvidence {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  if (evidenceType === 'URL') {
    // A URL paste is one line and is never fetched (FR-003).
    return {
      parserKind: 'URL_STRING',
      ...ENGINE,
      pages: [{ pageNumber: 1 }],
      lines: [{ pageNumber: 1, text: text.trim(), locationKind: 'TEXT_LINE' }],
    };
  }
  if (nonWhitespaceLength(text) < MIN_READABLE_CHARS) {
    throw new ProcessingFailure('NO_READABLE_TEXT', true, undefined, {
      parserKind: 'PLAIN_TEXT',
      ...ENGINE,
      pages: [{ pageNumber: 1 }],
    });
  }
  return {
    parserKind: 'PLAIN_TEXT',
    ...ENGINE,
    pages: [{ pageNumber: 1 }],
    lines: splitLines(text).map((line) => ({
      pageNumber: 1,
      text: line,
      locationKind: 'TEXT_LINE',
    })),
  };
}
