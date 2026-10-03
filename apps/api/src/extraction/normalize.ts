import { domainToASCII, domainToUnicode } from 'node:url';
import { parse as parseDomain } from 'tldts';
import type { EntityType, NormalizationStatus } from '@prisma/client';
import { normalizeTemporal, parseTemporal } from './temporal';

/**
 * Per-type format checks and normalisation (07 §15, §16.1). Normalisation is a deterministic
 * function of `raw_value` only: it never adds characters or digits that are not in the source
 * and never changes `raw_value` or the source lines.
 */

export const PHONE_PATTERN =
  /(?<![\w+])(?:(?:\+91|91)[ -]?|0)?[6-9]\d{4}[ -]?\d{5}(?!\d)|(?<![\w+])\+(?!91)\d{8,15}(?!\d)/g;
export const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/gi;
export const BARE_HOST_PATTERN =
  /(?<![\w.@/:-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,24}))(?![\w@-])(?::\d{2,5})?(?:\/[^\s<>"'`]*)?/gi;
export const EMAIL_PATTERN =
  /(?<![\w.%+-])[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?![\w-])/g;
export const UPI_PATTERN =
  /(?<![\w.-])[A-Za-z0-9._-]{2,}@[A-Za-z][A-Za-z0-9]{1,}(?![A-Za-z0-9@-])(?!\.[A-Za-z0-9])/g;
export const AMOUNT_PATTERN =
  /(?<![A-Za-z0-9])(?:₹|Rs\.?|INR)\s?(?:\d{1,3}(?:,\d{2})*,\d{3}|\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?(?!\d)(?!,\d)/gi;
export const TRANSACTION_LABEL =
  /\b(UTR|UPI Ref No|Ref No|Reference No|RRN|Transaction ID|Txn ID)\b/;
export const TRANSACTION_PATTERN = new RegExp(
  `${TRANSACTION_LABEL.source}\\.?\\s*[:.#]?\\s*([A-Z0-9]{8,22})(?![A-Z0-9])`,
  'gi',
);
export const ACCOUNT_HINT_PATTERN =
  /\b(?:A\/c|Acct|account)(?:\s+(?:ending\s+in|ending|no\.?|number))?\s*[:.#-]?\s*([Xx*]{2,}\d{3,4})(?!\d)|\bending\s+(?:in\s+)?(\d{4})(?!\d)/gi;
export const SMS_SENDER_PATTERN = /^[A-Z]{2}-[A-Z0-9]{3,9}$/;
export const HANDLE_PATTERN =
  /(?<![\w.@/-])@[A-Za-z0-9_][A-Za-z0-9_.]{2,31}(?<!\.)(?![\w@])|\bt\.me\/[A-Za-z0-9_]{3,32}(?!\w)/g;

/** Trailing characters stripped from URL candidates (07 §16.1). */
export const stripUrlTail = (url: string) => url.replace(/[.,;:!?)\]}>'"]+$/, '');

const anchored = (pattern: RegExp) =>
  new RegExp(`^(?:${pattern.source})$`, pattern.flags.replace('g', ''));

/** URL tracking parameters removed for the canonical key (07 §15). */
const TRACKING = /^(utm_.*|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|ref_src)$/i;

export const hasKnownTld = (host: string) => {
  const labels = host.toLowerCase().split('.');
  const parsed = parseDomain(host);
  return (
    labels.length >= 2 &&
    (['example', 'test'].includes(labels[labels.length - 1]!) || parsed.isIcann === true)
  );
};

export type Normalized = {
  status: NormalizationStatus;
  value: string | null;
  amountMinor?: bigint;
  currency?: string;
  datetime?: Date;
  precision?: 'EXACT' | 'APPROXIMATE';
  attributes?: Record<string, unknown>;
};

const notNormalized: Normalized = { status: 'NOT_NORMALIZED', value: null };

/** Whether `raw` (a whole matched span) has the format of its type (07 §17 step 6). */
export function isValidFormat(type: EntityType, raw: string): boolean {
  switch (type) {
    case 'PHONE':
      return /^(?:(?:\+91|91|0)?[6-9]\d{9}|\+\d{8,15})$/.test(raw.replace(/[\s\-().]/g, ''));
    case 'URL':
      return parseUrl(raw) !== null && stripUrlTail(raw) === raw;
    case 'DOMAIN':
      return (
        /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/i.test(domainToASCII(raw)) &&
        hasKnownTld(raw)
      );
    case 'EMAIL':
      return anchored(EMAIL_PATTERN).test(raw);
    case 'UPI_ID':
      return /^[A-Za-z0-9._-]{2,}@[A-Za-z][A-Za-z0-9]{1,}$/.test(trimUpi(raw));
    case 'TRANSACTION':
      return /^[A-Za-z0-9]{8,22}$/.test(raw.replace(/\s+/g, '')) && /\d/.test(raw);
    case 'AMOUNT':
      return anchored(AMOUNT_PATTERN).test(raw);
    case 'ACCOUNT_HINT':
      return /^[Xx*]{2,}\d{3,4}$/.test(raw) || /^ending\s+(?:in\s+)?\d{4}$/i.test(raw);
    case 'SMS_SENDER_HEADER':
      return SMS_SENDER_PATTERN.test(raw);
    case 'MESSAGING_HANDLE':
      return anchored(HANDLE_PATTERN).test(raw);
    case 'PERSON':
    case 'BANK_OR_WALLET':
      // A name: letters (any script), spaces and . ' & -; no digits, at most 80 characters.
      return /^[\p{L}][\p{L}\p{M} .'&-]{0,79}$/u.test(raw.trim().replace(/\s+/g, ' '));
    case 'DATETIME':
      return parseTemporal(raw) !== null;
  }
}

const trimUpi = (raw: string) => raw.replace(/^[^\w]+|[^\w]+$/g, '');

/** 07 §15. Invalid values stay unmerged even when called outside the extraction validator. */
export function normalize(type: EntityType, raw: string): Normalized {
  if (!isValidFormat(type, type === 'SMS_SENDER_HEADER' ? raw.toUpperCase() : raw))
    return notNormalized;
  switch (type) {
    case 'PHONE': {
      const digits = raw.replace(/[\s\-().]/g, '');
      const mobile = /^(?:\+91|91|0)?([6-9]\d{9})$/.exec(digits);
      if (mobile) return { status: 'NORMALIZED', value: `+91${mobile[1]}` };
      const intl = /^\+(\d{8,15})$/.exec(digits);
      return intl ? { status: 'NORMALIZED', value: `+${intl[1]}` } : notNormalized;
    }
    case 'URL': {
      const url = parseUrl(raw);
      if (!url) return notNormalized;
      for (const key of [...url.searchParams.keys()]) {
        if (TRACKING.test(key)) url.searchParams.delete(key);
      }
      url.hash = '';
      // A single trailing slash is removed unless the path is the root.
      if (url.pathname !== '/' && url.pathname.endsWith('/')) {
        url.pathname = url.pathname.slice(0, -1);
      }
      return { status: 'NORMALIZED', value: url.toString() };
    }
    case 'DOMAIN': {
      const ascii = domainToASCII(raw.toLowerCase());
      if (!ascii) return notNormalized;
      const unicode = domainToUnicode(ascii);
      return {
        status: 'NORMALIZED',
        value: unicode,
        ...(unicode !== ascii ? { attributes: { punycode: ascii } } : {}),
      };
    }
    case 'UPI_ID':
      return { status: 'NORMALIZED', value: trimUpi(raw).toLowerCase() };
    case 'EMAIL':
      return { status: 'NORMALIZED', value: raw.toLowerCase() };
    case 'TRANSACTION':
      return { status: 'NORMALIZED', value: raw.replace(/\s+/g, '').toUpperCase() };
    case 'AMOUNT': {
      const m = /^(?:₹|Rs\.?|INR)\s?([\d,]+)(?:\.(\d{2}))?$/i.exec(raw);
      if (!m) return notNormalized;
      const rupees = m[1]!.replace(/,/g, '');
      const paise = m[2] ?? '00';
      const amountMinor = BigInt(rupees) * 100n + BigInt(paise);
      return {
        status: 'NORMALIZED',
        value: `INR ${BigInt(rupees).toString()}.${paise}`,
        amountMinor,
        currency: 'INR',
      };
    }
    case 'ACCOUNT_HINT': {
      const digits = /(\d{3,4})$/.exec(raw);
      return digits ? { status: 'NORMALIZED', value: digits[1]! } : notNormalized;
    }
    case 'SMS_SENDER_HEADER':
      return { status: 'NORMALIZED', value: raw.toUpperCase() };
    case 'MESSAGING_HANDLE':
      return { status: 'NORMALIZED', value: raw.replace(/^@|^t\.me\//i, '').toLowerCase() };
    case 'PERSON':
    case 'BANK_OR_WALLET':
      return { status: 'NORMALIZED', value: raw.trim().replace(/\s+/g, ' ') };
    case 'DATETIME': {
      const fragment = parseTemporal(raw);
      if (!fragment) return notNormalized;
      const out = normalizeTemporal(fragment);
      return {
        status: 'NORMALIZED',
        value: out.text,
        ...(out.utc ? { datetime: out.utc, precision: out.precision } : {}),
        attributes: { fragment: fragment.kind, precision: out.precision },
      };
    }
  }
}

/** Parses a URL candidate; a bare host gets `https://` for parsing only (07 §15). */
function parseUrl(raw: string): URL | null {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    const host = url.hostname;
    if (!/^https?:\/\//i.test(raw) && !hasKnownTld(host)) return null;
    if (!hasKnownTld(host) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
    return url;
  } catch {
    return null;
  }
}

/** The host substring of a URL as printed in the source, for the derived DOMAIN candidate. */
export function hostSpan(rawUrl: string): { start: number; end: number } | null {
  const m = /^(?:https?:\/\/)?([^/?#:\s]+)/i.exec(rawUrl);
  if (!m) return null;
  const host = m[1]!;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || !hasKnownTld(host)) return null;
  const start = m[0].length - host.length;
  return { start, end: start + host.length };
}
