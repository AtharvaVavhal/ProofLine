import type { EntityType } from '@prisma/client';

/**
 * Generates the masked display value for an entity (07 §15, 03 §10.2).
 * Types that are already safe (URL, DOMAIN, AMOUNT, SMS header, PERSON, BANK_OR_WALLET,
 * ACCOUNT_HINT) return the canonical value itself.
 */
export function maskedValue(type: EntityType, canonical: string, raw?: string): string {
  switch (type) {
    case 'PHONE':
      return maskPhone(canonical);
    case 'UPI_ID':
      return maskUpi(canonical);
    case 'TRANSACTION':
      return maskTransaction(canonical);
    case 'EMAIL':
      return maskEmail(canonical);
    case 'MESSAGING_HANDLE':
      return maskHandle(canonical);
    // These types show the canonical value as-is (07 §15 masked-value table).
    case 'URL':
    case 'DOMAIN':
    case 'AMOUNT':
    case 'SMS_SENDER_HEADER':
    case 'PERSON':
    case 'BANK_OR_WALLET':
      return canonical;
    case 'ACCOUNT_HINT':
      return raw ?? `…${canonical}`;
    case 'DATETIME':
      // DATETIME extractions are not merged into entities (03 §10.2); this path should not run.
      return canonical;
  }
}

/** `+91 90XXX XX001` — keep `+91`, the first 2 and the last 3 digits (07 §15). */
function maskPhone(canonical: string): string {
  const m = /^\+91(\d{2})(\d{5})(\d{3})$/.exec(canonical);
  if (m) return `+91 ${m[1]}XXX XX${m[3]}`;
  // International: keep first 3 and last 3 digits.
  const intl = /^\+(\d{3})(\d+)(\d{3})$/.exec(canonical);
  if (intl && intl[2]!.length > 0) return `+${intl[1]}${'X'.repeat(intl[2]!.length)}${intl[3]}`;
  return canonical;
}

/** `kyc.r***@demoupi` — first 5 + `***` + `@psp` (07 §15). */
function maskUpi(canonical: string): string {
  const at = canonical.indexOf('@');
  if (at < 0) return canonical;
  const handle = canonical.slice(0, at);
  const psp = canonical.slice(at);
  const visible = handle.slice(0, Math.min(5, handle.length));
  return `${visible}***${psp}`;
}

/** `6270…8532` — first 4 + `…` + last 4 (07 §15). */
function maskTransaction(canonical: string): string {
  return `${canonical.slice(0, 4)}…${canonical.slice(-4)}`;
}

/** `s***@domain` — first character + `***` + `@domain` (07 §15). */
function maskEmail(canonical: string): string {
  const at = canonical.indexOf('@');
  if (at < 1) return canonical;
  return `${canonical[0]}***${canonical.slice(at)}`;
}

/** For messaging handles: first 3 + `***` (partial masking). */
function maskHandle(canonical: string): string {
  return `${canonical.slice(0, Math.min(3, Math.max(1, canonical.length - 1)))}***`;
}
