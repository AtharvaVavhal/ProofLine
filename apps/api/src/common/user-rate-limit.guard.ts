import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { rateLimited } from './api-error';
import type { AppRequest } from './app-request';
import { RateLimiter } from './rate-limiter';

/** 09 §18 default for routes without their own limit: 600 requests per hour per user. */
export const DEFAULT_PER_USER_LIMIT = { limit: 600, windowMs: 60 * 60 * 1000 } as const;

/** Applied with @UseGuards after the global AuthGuard has set req.user. */
@Injectable()
export class UserRateLimitGuard implements CanActivate {
  constructor(private readonly limiter: RateLimiter) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AppRequest>();
    if (!req.user) return true; // public routes are limited by their own rules
    const { limit, windowMs } = DEFAULT_PER_USER_LIMIT;
    const retryAfter = this.limiter.consume(`user:${req.user.id}`, limit, windowMs);
    if (retryAfter !== null) throw rateLimited(retryAfter);
    return true;
  }
}
