import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** A uniformly random 6-digit code from the CSPRNG (09 §6). */
export function generateSignInCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/**
 * HMAC-SHA-256 with the server secret. A plain hash of a 6-digit space could be brute-forced
 * if the database leaked (09 §6). The purpose prefix separates code and fingerprint domains.
 */
export function hmac(secret: string, purpose: 'otp' | 'fingerprint', value: string): string {
  return createHmac('sha256', secret).update(`${purpose}:${value}`).digest('hex');
}

export function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** 256-bit opaque session token; only its SHA-256 is stored (sessions.token_hash). */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export const SESSION_TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
