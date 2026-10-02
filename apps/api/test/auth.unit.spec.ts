import type { Request } from 'express';
import {
  SESSION_TOKEN_FORMAT,
  generateSessionToken,
  generateSignInCode,
  hashSessionToken,
  hashesEqual,
  hmac,
} from '../src/auth/auth.crypto';
import { RateLimiter } from '../src/common/rate-limiter';
import { readSessionCookie } from '../src/auth/session-cookie';
import { requestCodeSchema, verifyCodeSchema } from '@proofline/shared';

describe('sign-in code generation', () => {
  it('produces 6-digit codes from the full range', () => {
    const codes = Array.from({ length: 2000 }, generateSignInCode);
    expect(codes.every((c) => /^[0-9]{6}$/.test(c))).toBe(true);
    expect(new Set(codes).size).toBeGreaterThan(1990);
    const firstDigits = new Set(codes.map((c) => c[0]));
    expect(firstDigits.size).toBe(10); // leading zeros are possible
  });

  it('separates OTP and fingerprint HMAC domains and keys them by secret', () => {
    const secret = 's'.repeat(32);
    expect(hmac(secret, 'otp', '123456')).not.toBe(hmac(secret, 'fingerprint', '123456'));
    expect(hmac(secret, 'otp', '123456')).not.toBe(hmac('t'.repeat(32), 'otp', '123456'));
    expect(hmac(secret, 'otp', '123456')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('compares hashes in constant time and handles length mismatch', () => {
    const a = hmac('s'.repeat(32), 'otp', '1');
    expect(hashesEqual(a, a)).toBe(true);
    expect(hashesEqual(a, hmac('s'.repeat(32), 'otp', '2'))).toBe(false);
    expect(hashesEqual(a, 'abcd')).toBe(false);
  });
});

describe('session tokens', () => {
  it('are 256-bit base64url values stored only as SHA-256', () => {
    const token = generateSessionToken();
    expect(token).toMatch(SESSION_TOKEN_FORMAT);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(generateSessionToken()).not.toBe(token);
  });

  it('reads only the proofline_session cookie', () => {
    const req = (cookie?: string) => ({ headers: { cookie } }) as unknown as Request;
    expect(readSessionCookie(req())).toBeUndefined();
    expect(readSessionCookie(req('a=1; proofline_session=abc; b=2'))).toBe('abc');
    expect(readSessionCookie(req('xproofline_session=abc'))).toBeUndefined();
  });
});

describe('RateLimiter', () => {
  it('allows up to the limit in the window and reports the wait', () => {
    const limiter = new RateLimiter();
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i += 1) expect(limiter.consume('k', 3, 60_000, t0 + i)).toBeNull();
    expect(limiter.consume('k', 3, 60_000, t0 + 10)).toBe(60);
    expect(limiter.consume('k', 3, 60_000, t0 + 60_001)).toBeNull();
    expect(limiter.consume('other', 3, 60_000, t0)).toBeNull();
  });
});

describe('shared auth schemas', () => {
  it('normalises email and rejects unknown fields', () => {
    expect(requestCodeSchema.parse({ email: '  A@B.Example ' })).toEqual({ email: 'a@b.example' });
    expect(requestCodeSchema.safeParse({ email: 'a@b.example', extra: 1 }).success).toBe(false);
    expect(verifyCodeSchema.safeParse({ email: 'a@b.example', code: '012345' }).success).toBe(true);
    expect(verifyCodeSchema.safeParse({ email: 'a@b.example', code: '12345' }).success).toBe(false);
  });
});
