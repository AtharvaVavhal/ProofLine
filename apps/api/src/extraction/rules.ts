import type { EntityType } from '@prisma/client';
import { ExtractionCandidate, SourceLineRecord } from './candidates';
import {
  ACCOUNT_HINT_PATTERN,
  AMOUNT_PATTERN,
  BARE_HOST_PATTERN,
  EMAIL_PATTERN,
  HANDLE_PATTERN,
  PHONE_PATTERN,
  SMS_SENDER_PATTERN,
  TRANSACTION_PATTERN,
  UPI_PATTERN,
  URL_PATTERN,
  hasKnownTld,
  hostSpan,
  stripUrlTail,
} from './normalize';
import { TEMPORAL_PATTERN } from './temporal';

/**
 * A name after a label: a word of letters (any script) and . ' & -, then up to four more words
 * that start with a capital, so a following sentence is not swallowed [IMPL].
 */
const NAME = /[\p{L}][\p{L}\p{M}.'&-]*(?:[ ]\p{Lu}[\p{L}\p{M}.'&-]*){0,4}/uy;

const PERSON_LABELS: [RegExp, string][] = [
  [/\bPaid by\s*:\s*/gi, 'payer'],
  [/\bPaid to\s*:\s*/gi, 'payee_display_name'],
  [/\bName\s*:\s*/gi, 'other'],
];
const BANK_LABEL = /\b(?:Bank(?:\s+name)?|Wallet)\s*:\s*/gi;
const DEBITED_FROM_BANK = /\b[Dd]ebited\s+from\s+((?:[A-Z][A-Za-z&.'-]*\s+){1,4}Bank)\b/g;

/**
 * Deterministic candidate rules (07 §16.1, §16.3) over one item's **redacted** lines. Each match
 * becomes a candidate whose value is the matched span; the validator decides what is kept.
 * Free-text names and unlabelled banks are never produced here (GR-05).
 */
export function ruleCandidates(lines: SourceLineRecord[]): ExtractionCandidate[] {
  const out: ExtractionCandidate[] = [];
  for (const line of lines) {
    const text = line.text.normalize('NFC');
    const add = (
      fieldType: EntityType,
      value: string,
      at: number,
      attributes?: Record<string, string>,
    ) =>
      out.push({
        origin: 'RULE',
        evidenceId: line.evidenceId,
        fieldType,
        value,
        lineIds: [line.id],
        at,
        ...(attributes ? { attributes } : {}),
      });

    for (const m of text.matchAll(PHONE_PATTERN)) add('PHONE', m[0], m.index);

    for (const pattern of [URL_PATTERN, BARE_HOST_PATTERN]) {
      for (const m of text.matchAll(pattern)) {
        const url = stripUrlTail(m[0]);
        if (pattern === BARE_HOST_PATTERN && !hasKnownTld(m[1]!)) continue;
        add('URL', url, m.index);
        const host = hostSpan(url);
        if (host) add('DOMAIN', url.slice(host.start, host.end), m.index + host.start);
      }
    }

    for (const m of text.matchAll(EMAIL_PATTERN)) add('EMAIL', m[0], m.index);
    for (const m of text.matchAll(UPI_PATTERN)) add('UPI_ID', m[0], m.index);
    for (const m of text.matchAll(AMOUNT_PATTERN)) add('AMOUNT', m[0], m.index);
    for (const m of text.matchAll(HANDLE_PATTERN)) add('MESSAGING_HANDLE', m[0], m.index);

    for (const m of text.matchAll(TRANSACTION_PATTERN)) {
      const value = m[2]!;
      if (/\d/.test(value)) add('TRANSACTION', value, m.index + m[0].length - value.length);
    }

    for (const m of text.matchAll(ACCOUNT_HINT_PATTERN)) {
      const value = m[1] ?? m[0];
      add('ACCOUNT_HINT', value, m[1] ? m.index + m[0].length - value.length : m.index);
    }

    const trimmed = text.trim();
    if (SMS_SENDER_PATTERN.test(trimmed)) add('SMS_SENDER_HEADER', trimmed, text.indexOf(trimmed));

    for (const m of text.matchAll(TEMPORAL_PATTERN)) add('DATETIME', m[0], m.index);

    for (const [label, context] of PERSON_LABELS) {
      for (const m of text.matchAll(label)) {
        const name = nameAt(text, m.index + m[0].length);
        if (name) add('PERSON', name.value, name.at, { context });
      }
    }
    if (line.locationKind === 'EMAIL_HEADER' && line.headerName?.toLowerCase() === 'from') {
      const display = /^\s*"?([^"<]*?)"?\s*</.exec(text);
      const value = display?.[1]?.trim();
      if (value) add('PERSON', value, text.indexOf(value), { context: 'other' });
    }

    for (const m of text.matchAll(BANK_LABEL)) {
      const name = nameAt(text, m.index + m[0].length);
      if (name) add('BANK_OR_WALLET', name.value, name.at);
    }
    for (const m of text.matchAll(DEBITED_FROM_BANK)) {
      add('BANK_OR_WALLET', m[1]!, m.index + m[0].length - m[1]!.length);
    }
  }
  return out;
}

function nameAt(text: string, at: number): { value: string; at: number } | null {
  NAME.lastIndex = at;
  const m = NAME.exec(text);
  if (!m) return null;
  const value = m[0].replace(/[.'&-]+$/, '').trimEnd();
  return value ? { value, at } : null;
}
