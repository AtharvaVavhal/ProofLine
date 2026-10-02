import { z } from 'zod';

/** Sign-in codes are 6 digits and expire after 10 minutes (09 §6). */
export const SIGN_IN_CODE_LENGTH = 6;
export const SIGN_IN_CODE_TTL_SECONDS = 600;

/** Lower-cased and trimmed before validation, matching users.email (03 §4.2). */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const requestCodeSchema = z.strictObject({ email: emailSchema });
export type RequestCodeInput = z.infer<typeof requestCodeSchema>;

export const verifyCodeSchema = z.strictObject({
  email: emailSchema,
  code: z.string().regex(/^[0-9]{6}$/),
});
export type VerifyCodeInput = z.infer<typeof verifyCodeSchema>;

/** 202 body for POST /auth/request-code: identical for every email (no enumeration). */
export type RequestCodeResponse = { message: string };

/** 200 body for POST /auth/verify-code. The session token is only ever in the httpOnly cookie. */
export type VerifyCodeResponse = { user: { id: string; email: string } };
