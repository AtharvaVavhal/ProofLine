import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/** Owns the `users` table (04 §5.2). */
@Injectable()
export class UsersService {
  /** A user row is created on the first successful verification (09 §6). */
  async recordSignIn(
    db: Prisma.TransactionClient,
    email: string,
  ): Promise<{ id: string; email: string }> {
    const now = new Date();
    return db.user.upsert({
      where: { email },
      create: { email, lastLoginAt: now },
      update: { lastLoginAt: now },
      select: { id: true, email: true },
    });
  }
}
