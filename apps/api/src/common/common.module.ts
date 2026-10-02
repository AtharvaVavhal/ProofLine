import { Global, Module } from '@nestjs/common';
import { RateLimiter } from './rate-limiter';
import { UserRateLimitGuard } from './user-rate-limit.guard';

@Global()
@Module({
  providers: [RateLimiter, UserRateLimitGuard],
  exports: [RateLimiter, UserRateLimitGuard],
})
export class CommonModule {}
