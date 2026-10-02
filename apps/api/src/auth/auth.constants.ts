import { SIGN_IN_CODE_TTL_SECONDS } from '@proofline/shared';

const HOUR_MS = 60 * 60 * 1000;

/** Values from 09 §6 (code, session) and 09 §18 (rate-limit defaults). */
export const AUTH_LIMITS = {
  codeTtlMs: SIGN_IN_CODE_TTL_SECONDS * 1000,
  /** Stored per challenge in otp_challenges.max_attempts (schema default 5). */
  maxAttemptsPerCode: 5,
  sessionTtlMs: 7 * 24 * HOUR_MS,
  /** last_seen_at is refreshed at most this often, to avoid a write on every request. */
  lastSeenRefreshMs: 60 * 1000,
  requestCodePerEmail: { limit: 5, windowMs: HOUR_MS },
  requestCodePerFingerprint: { limit: 20, windowMs: HOUR_MS },
  verifyCodePerFingerprint: { limit: 30, windowMs: HOUR_MS },
} as const;

export const SESSION_COOKIE = {
  name: 'proofline_session',
  /** The cookie is only needed by the API, which the browser reaches through /api (05 §1). */
  path: '/api',
} as const;
