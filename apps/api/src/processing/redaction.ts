import type { SensitiveKind } from '@prisma/client';

/** Recorded on every detection row (03 §9.6). Bump when the rules below change. */
export const DETECTOR_VERSION = 'redact-v1';

export const REDACTION_TOKENS: Record<SensitiveKind, string> = {
  OTP: '[REDACTED:OTP]',
  CARD_NUMBER: '[REDACTED:CARD]',
};

export type Detection = { kind: SensitiveKind; charStart: number; charEnd: number };

type Span = { kind: SensitiveKind; start: number; end: number };

const OTP_CUE = /\b(?:otp|one[ -]time password|verification code|security code|code is|pin is)\b/gi;
const CARD_CANDIDATE = /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g;
const ACCOUNT =
  /(?:\ba\/c(?:\s*no\.?)?|\baccount\s*(?:no|number)\.?|\bacct(?:\s*no\.?)?)\s*[:.#-]?\s*(\d{9,18})(?!\d)/gi;
const DIGIT_RUN = /(?<!\d)\d+(?:[ -]\d+)?(?!\d)/g;
/** Phone numbers (10–13 digits, optional +, single space/hyphen separators) are never OTPs. */
const PHONE = /(?<![\d+])\+?\d(?:[ -]?\d){9,12}(?!\d)/g;
const AMOUNT_PREFIX = /(?:₹|rs\.?|inr)\s*$/i;
const TXN_LABEL = /(?:utr|upi ref no|ref no|reference no|rrn|transaction id|txn id)\s*[:.#]?\s*$/i;
const CUE_DISTANCE = 30;

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

const overlaps = (a: Span, spans: Span[]) => spans.some((b) => a.start < b.end && b.start < a.end);

/**
 * Finds OTPs, full card numbers and unmasked account numbers in one line (07 §18.1):
 * - CARD: 13–19 digits (single space/hyphen separators allowed) passing Luhn;
 * - account: 9–18 digits right after an account cue, redacted as CARD_NUMBER-class;
 * - OTP: 4–8 digits (one space/hyphen allowed) within 30 characters of an OTP cue, excluding
 *   phone numbers, currency amounts, labelled transaction references and parts of dates/times.
 */
export function findSensitiveSpans(text: string): Span[] {
  const spans: Span[] = [];

  for (const match of text.matchAll(CARD_CANDIDATE)) {
    const digits = match[0].replace(/\D/g, '');
    if (luhn(digits))
      spans.push({ kind: 'CARD_NUMBER', start: match.index, end: match.index + match[0].length });
  }

  for (const match of text.matchAll(ACCOUNT)) {
    const start = match.index + match[0].length - match[1]!.length;
    const span: Span = { kind: 'CARD_NUMBER', start, end: start + match[1]!.length };
    if (!overlaps(span, spans)) spans.push(span);
  }

  const phones: Span[] = [...text.matchAll(PHONE)].map((m) => ({
    kind: 'OTP',
    start: m.index,
    end: m.index + m[0].length,
  }));
  const cues = [...text.matchAll(OTP_CUE)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
  }));
  if (cues.length > 0) {
    for (const match of text.matchAll(DIGIT_RUN)) {
      const start = match.index;
      const end = start + match[0].length;
      const digits = match[0].replace(/\D/g, '');
      if (digits.length < 4 || digits.length > 8) continue;
      const before = text.slice(0, start);
      const after = text.slice(end);
      if (AMOUNT_PREFIX.test(before.slice(-6)) || TXN_LABEL.test(before.slice(-24))) continue;
      if (/\d[-/:.]$/.test(before) || /^[-/:.,]\d/.test(after)) continue; // dates, times, decimals
      const nearCue = cues.some(
        (cue) =>
          (cue.end <= start && start - cue.end <= CUE_DISTANCE) ||
          (end <= cue.start && cue.start - end <= CUE_DISTANCE),
      );
      const span: Span = { kind: 'OTP', start, end };
      if (nearCue && !overlaps(span, spans) && !overlaps(span, phones)) spans.push(span);
    }
  }

  return spans.sort((a, b) => a.start - b.start);
}

/**
 * Masks the spans with fixed-length tokens, so the token never reveals the value's length
 * (07 §18.2). Returned offsets point at the tokens in the redacted text.
 */
export function redactLine(text: string): { text: string; detections: Detection[] } {
  const spans = findSensitiveSpans(text);
  let out = '';
  let cursor = 0;
  const detections: Detection[] = [];
  for (const span of spans) {
    out += text.slice(cursor, span.start);
    const token = REDACTION_TOKENS[span.kind];
    detections.push({ kind: span.kind, charStart: out.length, charEnd: out.length + token.length });
    out += token;
    cursor = span.end;
  }
  return { text: out + text.slice(cursor), detections };
}
