import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env';
import { ApiError } from './api-error';
import type { AppRequest } from './app-request';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** CSRF defence: mutating requests must come from the web origin (05 §4.2, 09 §18). */
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AppRequest>();
    if (SAFE_METHODS.has(req.method) || req.headers.origin === this.config.webOrigin) {
      return true;
    }
    throw new ApiError(403, 'ORIGIN_NOT_ALLOWED', "This request isn't allowed.");
  }
}
