import type { ConfidenceBand, ConfidenceBasis, EntityType } from '@prisma/client';
import { ExtractionCandidate, RejectReason, SourceLineRecord, byReadingOrder } from './candidates';
import { Normalized, TRANSACTION_LABEL, isValidFormat, normalize } from './normalize';

/** Identifier types: confidence is source validation, never the model's (03 §9.2 CHECK). */
export const IDENTIFIER_TYPES: ReadonlySet<EntityType> = new Set<EntityType>([
  'PHONE',
  'URL',
  'DOMAIN',
  'UPI_ID',
  'TRANSACTION',
  'AMOUNT',
  'EMAIL',
  'ACCOUNT_HINT',
  'SMS_SENDER_HEADER',
  'MESSAGING_HANDLE',
]);

/** Case-insensitive comparison only for these types (07 §17 step 3). */
const CASE_FOLDED: ReadonlySet<EntityType> = new Set<EntityType>([
  'URL',
  'DOMAIN',
  'EMAIL',
  'UPI_ID',
]);

const REDACTION_TOKEN = /\[REDACTED:(?:OTP|CARD)\]/g;
const PERSON_CONTEXTS = new Set(['payer', 'payee_display_name', 'claimed_name', 'other']);
const SNIPPET_MAX = 200;

/** 06 §21 bands. Only the band is ever shown. */
export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= 0.85) return 'HIGH';
  if (confidence >= 0.6) return 'MEDIUM';
  return 'LOW';
}

const VALIDATOR = Symbol('literal-validator');

type ValidatedFields = {
  evidenceId: string;
  parseResultId: string;
  fieldType: EntityType;
  rawValue: string;
  normalized: Normalized;
  /** Provenance lines in reading order: only the lines the matched span lies on. */
  lineIds: string[];
  matchOffsets: { lineId: string; start: number; end: number }[];
  method: 'RULE' | 'LLM';
  confidence: number;
  confidenceBasis: ConfidenceBasis;
  confidenceBand: ConfidenceBand;
  snippet: string;
  sourceLabel: string | null;
  attributes: Record<string, unknown>;
  /** Reading-order position of the match (page, line, offset). */
  position: [number, number, number];
};

/**
 * A candidate that passed literal validation (04 §10 `ValidatedCandidate`). Only
 * `validateCandidate` below can construct one, so there is no path from a model string to
 * `extractions` that skips the validator (07 §17).
 */
export class ValidatedCandidate {
  readonly evidenceId!: string;
  readonly parseResultId!: string;
  readonly fieldType!: EntityType;
  readonly rawValue!: string;
  readonly normalized!: Normalized;
  readonly lineIds!: string[];
  readonly matchOffsets!: ValidatedFields['matchOffsets'];
  readonly method!: 'RULE' | 'LLM';
  readonly confidence!: number;
  readonly confidenceBasis!: ConfidenceBasis;
  readonly confidenceBand!: ConfidenceBand;
  readonly snippet!: string;
  readonly sourceLabel!: string | null;
  readonly attributes!: Record<string, unknown>;
  readonly position!: [number, number, number];

  constructor(key: symbol, fields: ValidatedFields) {
    if (key !== VALIDATOR) {
      throw new Error('ValidatedCandidate is created only by the literal validator');
    }
    Object.assign(this, fields);
    Object.freeze(this);
  }
}

export type ValidationContext = {
  caseId: string;
  evidenceId: string;
  /** The item's lines, loaded with `case_id = run.case_id AND evidence_id = item` (06 §6.3). */
  lines: ReadonlyMap<string, SourceLineRecord>;
};

export type ValidationResult =
  { ok: true; value: ValidatedCandidate } | { ok: false; reason: RejectReason };

/** The trust boundary (07 §17; 06 §6.3), for rule and model candidates alike. */
export function validateCandidate(
  candidate: ExtractionCandidate,
  context: ValidationContext,
): ValidationResult {
  // 1. Ownership: every referenced line belongs to this evidence item and this case.
  const ids = [...new Set(candidate.lineIds)];
  if (ids.length === 0 || candidate.evidenceId !== context.evidenceId) {
    return { ok: false, reason: 'FOREIGN_LINE' };
  }
  const lines: SourceLineRecord[] = [];
  for (const id of ids) {
    const line = context.lines.get(id);
    if (!line || line.caseId !== context.caseId || line.evidenceId !== candidate.evidenceId) {
      return { ok: false, reason: 'FOREIGN_LINE' };
    }
    lines.push(line);
  }
  if (new Set(lines.map((l) => l.parseResultId)).size !== 1) {
    return { ok: false, reason: 'FOREIGN_LINE' };
  }
  lines.sort(byReadingOrder);

  // 2. Haystack: the referenced redacted lines joined with a single space.
  const texts = lines.map((l) => l.text.normalize('NFC'));
  const starts: number[] = [];
  let haystack = '';
  for (const text of texts) {
    if (haystack) haystack += ' ';
    starts.push(haystack.length);
    haystack += text;
  }

  // 3–4. Comparison form (NFC, collapsed whitespace, trimmed; case-folded for some types).
  const fold = CASE_FOLDED.has(candidate.fieldType);
  const hay = comparisonForm(haystack, fold);
  const needle = comparisonForm(candidate.value.normalize('NFC'), fold).text;
  if (!needle) return { ok: false, reason: 'NOT_LITERAL' };
  const occurrences: number[] = [];
  for (let i = hay.text.indexOf(needle); i >= 0; i = hay.text.indexOf(needle, i + 1)) {
    occurrences.push(i);
  }
  if (occurrences.length === 0) return { ok: false, reason: 'NOT_LITERAL' };
  const wanted = candidate.at === undefined ? undefined : starts[0]! + candidate.at;
  const index = occurrences.find((i) => hay.start[i] === wanted) ?? occurrences[0]!;
  const spanStart = hay.start[index]!;
  const spanEnd = hay.end[index + needle.length - 1]!;

  // 5. Redaction guard: sensitive values can never become extractions.
  for (const token of haystack.matchAll(REDACTION_TOKEN)) {
    if (token.index < spanEnd && spanStart < token.index + token[0].length) {
      return { ok: false, reason: 'REDACTED_SPAN' };
    }
  }

  // 6. Format, on the matched source span (07 §17 step 7: raw = the span, not the candidate).
  const rawValue = haystack.slice(spanStart, spanEnd);
  const first = lines.findIndex((_, i) => spanStart < starts[i]! + texts[i]!.length);
  const before = texts[first]!.slice(0, spanStart - starts[first]!);
  let sourceLabel: string | null = null;
  // The format check sees the comparison form's spacing, like the literal match did.
  if (!isValidFormat(candidate.fieldType, rawValue.replace(/\s+/g, ' '))) {
    return { ok: false, reason: 'FORMAT' };
  }
  if (candidate.fieldType === 'TRANSACTION') {
    // Label-anchored only: unlabelled digit runs are not transactions (07 §16.1).
    const label = new RegExp(`${TRANSACTION_LABEL.source}\\.?\\s*[:.#]?\\s*$`, 'i').exec(before);
    if (!label) return { ok: false, reason: 'FORMAT' };
    sourceLabel = label[1]!;
  }
  if (candidate.fieldType === 'BANK_OR_WALLET' && !hasBankContext(before, rawValue)) {
    return { ok: false, reason: 'FORMAT' }; // GR-05: no dictionary guessing, no payee as bank
  }

  // 8. Normalise from raw_value only.
  const normalized = normalize(candidate.fieldType, rawValue);

  const provenance = lines
    .map((line, i) => ({ line, start: starts[i]!, end: starts[i]! + texts[i]!.length }))
    .filter((l) => l.start < spanEnd && spanStart < l.end);
  const matchOffsets = provenance.map((l) => ({
    lineId: l.line.id,
    start: Math.max(spanStart, l.start) - l.start,
    end: Math.min(spanEnd, l.end) - l.start,
  }));

  const sourceConfidence = Math.min(...provenance.map((l) => l.line.ocrConfidence ?? 1));
  const judged = candidate.origin === 'LLM' && candidate.fieldType === 'PERSON';
  const confidence = round3(
    judged
      ? Math.min(sourceConfidence, clamp(candidate.judgementConfidence ?? 0.5), 0.84)
      : sourceConfidence,
  );

  const personContext = candidate.attributes?.context;
  const attributes: Record<string, unknown> = {
    ...(normalized.attributes ?? {}),
    ...(candidate.fieldType === 'PERSON' && personContext && PERSON_CONTEXTS.has(personContext)
      ? { context: personContext }
      : {}),
  };

  const firstLine = provenance[0]!;
  return {
    ok: true,
    value: new ValidatedCandidate(VALIDATOR, {
      evidenceId: candidate.evidenceId,
      parseResultId: lines[0]!.parseResultId,
      fieldType: candidate.fieldType,
      rawValue,
      normalized,
      lineIds: provenance.map((l) => l.line.id),
      matchOffsets,
      method: candidate.origin,
      confidence,
      confidenceBasis: judged ? 'MODEL_JUDGEMENT' : 'SOURCE_VALIDATION',
      confidenceBand: confidenceBand(confidence),
      snippet: snippet(texts[lines.indexOf(firstLine.line)]!, matchOffsets[0]!),
      sourceLabel,
      attributes,
      position: [firstLine.line.pageNumber, firstLine.line.lineNumber, matchOffsets[0]!.start],
    }),
  };
}

/** `Bank:` / `Bank name:` / `Wallet:` label, or "debited from <Name> Bank" (07 §16.1). */
function hasBankContext(before: string, raw: string): boolean {
  if (/(?:\bbank(?:\s+name)?|\bwallet)\s*:\s*$/i.test(before)) return true;
  return /\bdebited\s+from\s+$/i.test(before) && /\sBank$/.test(raw);
}

/** Comparison form with a map back to source offsets (UTF-16 indices). */
function comparisonForm(text: string, fold: boolean) {
  let out = '';
  const start: number[] = [];
  const end: number[] = [];
  let pendingSpace = -1;
  let index = 0;
  for (const cp of text) {
    if (/\s/u.test(cp)) {
      if (pendingSpace < 0) pendingSpace = index;
    } else {
      if (pendingSpace >= 0 && out.length > 0) {
        out += ' ';
        start.push(pendingSpace);
        end.push(pendingSpace + 1);
      }
      pendingSpace = -1;
      const unit = fold ? cp.toLowerCase() : cp;
      for (let k = 0; k < unit.length; k += 1) {
        out += unit[k];
        start.push(index);
        end.push(index + cp.length);
      }
    }
    index += cp.length;
  }
  return { text: out, start, end };
}

function snippet(lineText: string, match: { start: number; end: number }): string {
  if (lineText.length <= SNIPPET_MAX) return lineText;
  const room = Math.max(0, SNIPPET_MAX - (match.end - match.start));
  let from = Math.max(0, match.start - Math.floor(room / 2));
  from = Math.min(from, lineText.length - SNIPPET_MAX);
  return lineText.slice(from, from + SNIPPET_MAX);
}

const clamp = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const round3 = (n: number) => Math.round(n * 1000) / 1000;
