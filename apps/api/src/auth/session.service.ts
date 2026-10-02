import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { AuthenticatedUser } from '../common/app-request';
import { AUTH_LIMITS } from './auth.constants';
import { SESSION_TOKEN_FORMAT, generateSessionToken, hashSessionToken } from './auth.crypto';

/** Owns the `sessions` table (04 §5.2). */
@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every sign-in creates a new session (rotation, 09 §6). Returns the raw token for the cookie. */
  async create(
    db: Prisma.TransactionClient,
    userId: string,
  ): Promise<{ id: string; token: string }> {
    const token = generateSessionToken();
    const session = await db.session.create({
      data: {
        userId,
        tokenHash: hashSessionToken(token),
        expiresAt: new Date(Date.now() + AUTH_LIMITS.sessionTtlMs),
      },
      select: { id: true },
    });
    return { id: session.id, token };
  }

  /**
   * Resolves a cookie token to its user. Missing, malformed, unknown, expired, revoked and
   * disabled-user sessions are all the same outcome: null.
   */
  async resolve(token: string | undefined): Promise<AuthenticatedUser | null> {
    if (!token || !SESSION_TOKEN_FORMAT.test(token)) return null;
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        revokedAt: true,
        lastSeenAt: true,
        user: { select: { authStatus: true } },
      },
    });
    const now = new Date();
    if (
      !session ||
      session.revokedAt !== null ||
      session.expiresAt <= now ||
      session.user.authStatus !== 'ACTIVE'
    ) {
      return null;
    }
    if (
      !session.lastSeenAt ||
      now.getTime() - session.lastSeenAt.getTime() > AUTH_LIMITS.lastSeenRefreshMs
    ) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
    }
    return { id: session.userId, sessionId: session.id };
  }

  /** Logout revokes only the current session. Returns false if it was already revoked. */
  async revoke(db: Prisma.TransactionClient, sessionId: string): Promise<boolean> {
    const { count } = await db.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count === 1;
  }
}
