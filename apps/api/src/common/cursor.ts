import { ApiError } from './api-error';

/**
 * Opaque keyset cursor (05 §26): the last row's timestamp as PostgreSQL renders it in UTC with
 * microseconds (JS Dates only hold milliseconds) plus its UUID as the tiebreak.
 */
export type Cursor = { at: string; id: string };

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** SQL expression rendering a timestamptz column in the cursor format. */
export const cursorTimestampSql = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.at, cursor.id])).toString('base64url');
}

export function decodeCursor(raw: string | undefined): Cursor | null {
  if (raw === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string' &&
      TIMESTAMP.test(parsed[0]) &&
      UUID.test(parsed[1])
    ) {
      return { at: parsed[0], id: parsed[1] };
    }
  } catch {
    // fall through to the validation error
  }
  throw new ApiError(400, 'VALIDATION_FAILED', 'Check the request and try again.', {
    fieldErrors: [{ field: 'cursor', code: 'INVALID' }],
  });
}

export function isUuid(value: string): boolean {
  return UUID.test(value);
}
