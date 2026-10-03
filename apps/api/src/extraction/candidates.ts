import type { EntityType, LineLocationKind } from '@prisma/client';

/**
 * A proposal from the rules or the model (06 §6.1 "candidate extraction"). Untrusted, held in
 * memory only; it reaches `extractions` only through the literal validator.
 */
export type ExtractionCandidate = {
  origin: 'RULE' | 'LLM';
  evidenceId: string;
  fieldType: EntityType;
  value: string;
  lineIds: string[];
  /** Judgement attributes (PERSON context). Never identifiers or values. */
  attributes?: Record<string, string>;
  /** Model-reported confidence for non-identifier judgements only (06 §21). */
  judgementConfidence?: number;
  /** Rule candidates: offset of the match in the first line, to pick that occurrence. */
  at?: number;
};

/** Rejection reasons counted in `agent_steps.output_summary` (07 §16.2; no values kept). */
export const REJECT_REASONS = ['NOT_LITERAL', 'FORMAT', 'FOREIGN_LINE', 'REDACTED_SPAN'] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

/** A stored, redacted source line as the validator sees it. */
export type SourceLineRecord = {
  id: string;
  caseId: string;
  evidenceId: string;
  parseResultId: string;
  pageNumber: number;
  lineNumber: number;
  locationKind: LineLocationKind;
  headerName: string | null;
  text: string;
  bbox: unknown;
  ocrConfidence: number | null;
};

/** Reading order within one parse result (07 §14). */
export const byReadingOrder = (a: SourceLineRecord, b: SourceLineRecord) =>
  a.pageNumber - b.pageNumber || a.lineNumber - b.lineNumber;
