/**
 * Temporal fragments (07 §16.3). Each fragment is one DATETIME extraction: date-only, time-only
 * or a date+time written in one span. Nothing is combined across spans and no date is assumed
 * for a time; IST (+05:30) is assumed for source times without a zone (spec §14.2).
 */

export type TemporalFragment =
  | { kind: 'DATE'; year: number; month: number; day: number }
  | { kind: 'TIME'; hour: number; minute: number; approximate: boolean }
  | {
      kind: 'DATETIME';
      year: number;
      month: number;
      day: number;
      hour: number;
      minute: number;
      approximate: boolean;
    };

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const MONTH_NAMES = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join('|');
const WEEKDAY = '(?:(?:Mon|Tues?|Wed(?:nes)?|Thu(?:rs)?|Fri|Sat(?:ur)?|Sun)(?:day)?\\.?,?\\s+)';
const NAMED_DATE = `${WEEKDAY}?\\d{1,2}\\s+(?:${MONTH_NAMES})\\.?,?\\s+\\d{4}`;
const NUMERIC_DATE = '\\d{1,2}[-/]\\d{1,2}[-/](?:\\d{4}|\\d{2})';
const ISO_DATE = '\\d{4}-\\d{2}-\\d{2}';
const DATE = `(?:${NAMED_DATE}|${ISO_DATE}|${NUMERIC_DATE})`;
const CUE = '(?:approximately|approx\\.?|around|about|roughly|~)\\s*';
/** `12:03 PM`, `12:03pm`, `12:03 p.m.` — a dot only in the dotted form (not a sentence end). */
const MERIDIEM = '\\s*(?:[AaPp]\\.\\s?[Mm]\\.|[AaPp][Mm])(?![A-Za-z])';
const TIME = `\\d{1,2}:\\d{2}(?:${MERIDIEM})?`;

/** Longest forms first: date+time, then date, then time (07 §16.2: longest span wins). */
export const TEMPORAL_PATTERN = new RegExp(
  `(?<![\\w:/-])(?:${DATE}(?:,\\s*|\\s+)(?:at\\s+)?(?:${CUE})?${TIME}|${DATE}|(?:${CUE})?${TIME})(?![\\w:]|[-/]\\d)`,
  'gi',
);

const validDate = (year: number, month: number, day: number) => {
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
};

function parseDate(text: string): { year: number; month: number; day: number } | null {
  let m = /^(?:\S+?,?\s+)?(\d{1,2})\s+([A-Za-z]+)\.?,?\s+(\d{4})$/.exec(text);
  if (m) {
    const month = MONTHS[m[2]!.toLowerCase()];
    const result = { year: Number(m[3]), month: month ?? 0, day: Number(m[1]) };
    return month && validDate(result.year, result.month, result.day) ? result : null;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (m) {
    const result = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
    return validDate(result.year, result.month, result.day) ? result : null;
  }
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4}|\d{2})$/.exec(text);
  if (m) {
    // Day-first (Indian convention); two-digit years 00–69 → 20YY, 70–99 → 19YY.
    const yy = Number(m[3]);
    const year = m[3]!.length === 2 ? (yy <= 69 ? 2000 + yy : 1900 + yy) : yy;
    const result = { year, month: Number(m[2]), day: Number(m[1]) };
    return validDate(result.year, result.month, result.day) ? result : null;
  }
  return null;
}

function parseTime(text: string): { hour: number; minute: number; approximate: boolean } | null {
  const m = new RegExp(
    `^(${CUE})?(\\d{1,2}):(\\d{2})(?:\\s*([AaPp])(?:\\.\\s?[Mm]\\.|[Mm]))?$`,
    'i',
  ).exec(text);
  if (!m) return null;
  let hour = Number(m[2]);
  const minute = Number(m[3]);
  if (minute > 59) return null;
  if (m[4]) {
    if (hour < 1 || hour > 12) return null;
    const pm = m[4].toLowerCase() === 'p';
    hour = (hour % 12) + (pm ? 12 : 0);
  } else if (hour > 23) {
    return null;
  }
  return { hour, minute, approximate: Boolean(m[1]) };
}

/** Parses one whole fragment (the matched span); null when it is not a valid date or time. */
export function parseTemporal(raw: string): TemporalFragment | null {
  const text = raw.trim().replace(/\s+/g, ' ');
  const combined = new RegExp(`^(${DATE})(?:,\\s*|\\s+)(?:at\\s+)?((?:${CUE})?${TIME})$`, 'i').exec(
    text,
  );
  if (combined) {
    const date = parseDate(combined[1]!);
    const time = parseTime(combined[2]!);
    return date && time ? { kind: 'DATETIME', ...date, ...time } : null;
  }
  const date = new RegExp(`^${DATE}$`, 'i').test(text) ? parseDate(text) : null;
  if (date) return { kind: 'DATE', ...date };
  const time = parseTime(text);
  return time ? { kind: 'TIME', ...time } : null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * 07 §15 DATETIME formats: full `YYYY-MM-DDTHH:MM+05:30`, date-only `YYYY-MM-DD`, time-only
 * `THH:MM`. `utc` is set only for a full date+time.
 */
export function normalizeTemporal(fragment: TemporalFragment): {
  text: string;
  utc: Date | null;
  precision: 'EXACT' | 'APPROXIMATE';
} {
  if (fragment.kind === 'DATE') {
    return {
      text: `${fragment.year}-${pad(fragment.month)}-${pad(fragment.day)}`,
      utc: null,
      precision: 'EXACT',
    };
  }
  const precision = fragment.approximate ? 'APPROXIMATE' : 'EXACT';
  if (fragment.kind === 'TIME') {
    return { text: `T${pad(fragment.hour)}:${pad(fragment.minute)}`, utc: null, precision };
  }
  const local = `${fragment.year}-${pad(fragment.month)}-${pad(fragment.day)}T${pad(fragment.hour)}:${pad(fragment.minute)}`;
  return { text: `${local}+05:30`, utc: new Date(`${local}:00+05:30`), precision };
}
