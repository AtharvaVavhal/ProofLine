import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { unauthenticated } from '../common/api-error';
import type { AppRequest } from '../common/app-request';
import { IS_PUBLIC } from '../common/public.decorator';
import { clearSessionCookie, readSessionCookie } from './session-cookie';
import { SessionService } from './session.service';

/** Global guard: every route except @Public() ones needs a valid session, else 401 (05 §4.2). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const http = context.switchToHttp();
    const req = http.getRequest<AppRequest>();
    const token = readSessionCookie(req);
    const user = await this.sessions.resolve(token);
    if (!user) {
      // A stale cookie is cleared so the browser stops sending it.
      if (token !== undefined) clearSessionCookie(http.getResponse<Response>());
      throw unauthenticated();
    }
    req.user = user;
    return true;
  }
}
