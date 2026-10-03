import type { EvidenceFailureCode, LineLocationKind, ParserKind } from '@prisma/client';

/** A line as read from the evidence, before redaction. Exists only in memory (07 §18.3). */
export type RawLine = {
  pageNumber: number;
  text: string;
  locationKind: LineLocationKind;
  headerName?: string;
  bbox?: { x: number; y: number; w: number; h: number };
  ocrConfidence?: number;
};

export type PageInfo = {
  pageNumber: number;
  width?: number;
  height?: number;
  /** PDF only: embedded text size, for the OD-03 text-layer gate. */
  nonWhitespaceCharCount?: number;
};

/** Parser output (07 §32 ParsedEvidence), in reading order. */
export type ParsedEvidence = {
  parserKind: ParserKind;
  engine: string;
  engineVersion: string;
  pages: PageInfo[];
  lines: RawLine[];
  /** Merged into evidence_items.source_metadata (EML attachments and body part, 03 §6.3). */
  sourceMetadata?: Record<string, unknown>;
};

/**
 * A processing failure with its 03 §4.1 code (07 §22). `parse` is set when the parser got far
 * enough to describe the document (e.g. the PDF pages that failed the text-layer gate).
 */
export class ProcessingFailure extends Error {
  constructor(
    readonly code: EvidenceFailureCode,
    readonly retryable: boolean,
    readonly detail?: { pages_without_text?: number[] },
    readonly parse?: Omit<ParsedEvidence, 'lines'>,
  ) {
    super(code);
  }
}

export const nonWhitespaceLength = (text: string) => text.replace(/\s/g, '').length;

/** Below this many non-whitespace characters an item has no readable text (07 §9, §11). */
export const MIN_READABLE_CHARS = 10;
