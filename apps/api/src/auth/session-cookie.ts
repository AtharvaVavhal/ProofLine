import type { CookieOptions, Request, Response } from 'express';
import { AUTH_LIMITS, SESSION_COOKIE } from './auth.constants';

/** httpOnly, Secure, SameSite=Lax (05 §4.1). JavaScript never reads the token. */
const OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: SESSION_COOKIE.path,
};

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE.name, token, { ...OPTIONS, maxAge: AUTH_LIMITS.sessionTtlMs });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE.name, OPTIONS);
}

/** Reads the session cookie from the raw header (no cookie-parser dependency). */
export function readSessionCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === SESSION_COOKIE.name) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}
