import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { ApiError, rateLimited } from '../common/api-error';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env';
import { PrismaService } from '../database/prisma.service';
import { UsersService } from '../users/users.service';
import { AUTH_LIMITS } from './auth.constants';
import { generateSignInCode, hashesEqual, hmac } from './auth.crypto';
import { EMAIL_TRANSPORT, EmailTransport } from './email/email-transport';
import { RateLimiter } from '../common/rate-limiter';
import { SessionService } from './session.service';

export const REQUEST_CODE_MESSAGE =
  'If this email can be used, we sent a 6-digit code. It expires in 10 minutes.';

type ClientContext = { ip: string; requestId: string };

type LatestChallenge = {
  id: string;
  code_hash: string;
  expires_at: Date;
  attempt_count: number;
  max_attempts: number;
  consumed_at: Date | null;
};

type VerifyOutcome =
  | { kind: 'signed-in'; user: { id: string; email: string }; token: string }
  | { kind: 'invalid'; attemptsRemaining: number }
  | { kind: 'expired' };

const invalidCode = (attemptsRemaining: number) =>
  new ApiError(422, 'INVALID_CODE', "That code isn't right. Check it and try again.", {
    details: { attemptsRemaining },
  });

const codeExpired = () =>
  new ApiError(
    422,
    'CODE_EXPIRED',
    "This code has expired or can't be used any more. Request a new code.",
  );

/** Email-OTP sign-in (OD-04, 09 §6). Owns `otp_challenges`. */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly users: UsersService,
    private readonly sessions: SessionService,
    private readonly limiter: RateLimiter,
    @Inject(EMAIL_TRANSPORT) private readonly email: EmailTransport,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Issues a code for any syntactically valid email. The response never depends on whether an
   * account exists: users are created only on successful verification, so no lookup happens.
   */
  async requestCode(email: string, client: ClientContext): Promise<void> {
    const fingerprint = hmac(this.config.authSecret, 'fingerprint', client.ip);
    const retryAfter = await this.requestCodeRetryAfter(email, fingerprint);
    if (retryAfter !== null) {
      await this.audit.record(this.prisma, {
        action: 'AUTH_CODE_REQUESTED',
        outcome: 'DENIED',
        requestId: client.requestId,
        metadata: { code: 'RATE_LIMITED' },
      });
      throw rateLimited(retryAfter, 'Please wait before requesting another code.');
    }

    // A newer code supersedes older ones: verification only ever checks the latest challenge.
    const code = generateSignInCode();
    const challengeId = await this.prisma.$transaction(async (tx) => {
      const challenge = await tx.otpChallenge.create({
        data: {
          email,
          codeHash: hmac(this.config.authSecret, 'otp', code),
          expiresAt: new Date(Date.now() + AUTH_LIMITS.codeTtlMs),
          maxAttempts: AUTH_LIMITS.maxAttemptsPerCode,
          requesterFingerprint: fingerprint,
        },
        select: { id: true },
      });
      await this.audit.record(tx, {
        action: 'AUTH_CODE_REQUESTED',
        outcome: 'SUCCEEDED',
        targetType: 'otp_challenge',
        targetId: challenge.id,
        requestId: client.requestId,
      });
      return challenge.id;
    });

    // The email is sent after commit; a send failure is a follow-up FAILED entry (03 §19.4).
    try {
      await this.email.sendSignInCode(email, code);
    } catch {
      await this.audit.record(this.prisma, {
        action: 'AUTH_CODE_REQUESTED',
        outcome: 'FAILED',
        targetType: 'otp_challenge',
        targetId: challengeId,
        requestId: client.requestId,
        metadata: { code: 'PROVIDER_ERROR' },
      });
      throw new ApiError(502, 'PROVIDER_ERROR', "We couldn't send the code. Please try again.");
    }
  }

  /** Verifies the latest code for the email and starts a new session. */
  async verifyCode(
    email: string,
    code: string,
    client: ClientContext,
  ): Promise<{ user: { id: string; email: string }; token: string }> {
    const fingerprint = hmac(this.config.authSecret, 'fingerprint', client.ip);
    const { limit, windowMs } = AUTH_LIMITS.verifyCodePerFingerprint;
    const retryAfter = this.limiter.consume(`verify:${fingerprint}`, limit, windowMs);
    if (retryAfter !== null) {
      await this.audit.record(this.prisma, {
        action: 'AUTH_SIGN_IN_FAILED',
        outcome: 'DENIED',
        requestId: client.requestId,
        metadata: { code: 'RATE_LIMITED' },
      });
      throw rateLimited(retryAfter);
    }

    // Failed attempts must commit (attempt count + audit), so outcomes are returned, not thrown.
    const outcome = await this.prisma.$transaction(async (tx) =>
      this.verifyInTransaction(tx, email, code, client.requestId),
    );
    if (outcome.kind === 'invalid') throw invalidCode(outcome.attemptsRemaining);
    if (outcome.kind === 'expired') throw codeExpired();
    return { user: outcome.user, token: outcome.token };
  }

  /** Revokes the current session only. */
  async logout(userId: string, sessionId: string, requestId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.sessions.revoke(tx, sessionId);
      await this.audit.record(tx, {
        action: 'AUTH_SIGNED_OUT',
        outcome: 'SUCCEEDED',
        actorUserId: userId,
        targetType: 'session',
        targetId: sessionId,
        requestId,
      });
    });
  }

  private async verifyInTransaction(
    tx: Prisma.TransactionClient,
    email: string,
    code: string,
    requestId: string,
  ): Promise<VerifyOutcome> {
    // Locks the latest challenge so concurrent attempts are counted one at a time.
    const [challenge] = await tx.$queryRaw<LatestChallenge[]>`
      SELECT id, code_hash, expires_at, attempt_count, max_attempts, consumed_at
      FROM otp_challenges
      WHERE email = ${email}
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE`;

    const fail = async (reason: string) =>
      this.audit.record(tx, {
        action: 'AUTH_SIGN_IN_FAILED',
        outcome: 'FAILED',
        targetType: challenge ? 'otp_challenge' : undefined,
        targetId: challenge?.id,
        requestId,
        metadata: { code: reason },
      });

    if (
      !challenge ||
      challenge.consumed_at !== null ||
      challenge.expires_at <= new Date() ||
      challenge.attempt_count >= challenge.max_attempts
    ) {
      await fail('CODE_EXPIRED');
      return { kind: 'expired' };
    }

    if (!hashesEqual(hmac(this.config.authSecret, 'otp', code), challenge.code_hash)) {
      const attempts = challenge.attempt_count + 1;
      await tx.otpChallenge.update({
        where: { id: challenge.id },
        data: { attemptCount: attempts },
      });
      const attemptsRemaining = challenge.max_attempts - attempts;
      if (attemptsRemaining > 0) {
        await fail('INVALID_CODE');
        return { kind: 'invalid', attemptsRemaining };
      }
      await fail('ATTEMPTS_EXHAUSTED');
      return { kind: 'expired' };
    }

    await tx.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
    const user = await this.users.recordSignIn(tx, email);
    const session = await this.sessions.create(tx, user.id);
    await this.audit.record(tx, {
      action: 'AUTH_SIGNED_IN',
      outcome: 'SUCCEEDED',
      actorUserId: user.id,
      targetType: 'session',
      targetId: session.id,
      requestId,
    });
    return { kind: 'signed-in', user, token: session.token };
  }

  /** request-code limits: 5/hour per email and 20/hour per client fingerprint (09 §18). */
  private async requestCodeRetryAfter(email: string, fingerprint: string): Promise<number | null> {
    const checks = [
      { where: { email }, ...AUTH_LIMITS.requestCodePerEmail },
      { where: { requesterFingerprint: fingerprint }, ...AUTH_LIMITS.requestCodePerFingerprint },
    ];
    const now = Date.now();
    let retryAfter: number | null = null;
    for (const { where, limit, windowMs } of checks) {
      const since = new Date(now - windowMs);
      const recent = await this.prisma.otpChallenge.findMany({
        where: { ...where, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { createdAt: true },
      });
      if (recent.length >= limit) {
        const oldestCounted = recent[recent.length - 1]!.createdAt.getTime();
        const seconds = Math.max(1, Math.ceil((oldestCounted + windowMs - now) / 1000));
        retryAfter = Math.max(retryAfter ?? 0, seconds);
      }
    }
    return retryAfter;
  }
}
