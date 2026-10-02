import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AppRequest, AuthenticatedUser } from '../common/app-request';

/** The principal set by AuthGuard. Only valid on routes that are not @Public(). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const user = context.switchToHttp().getRequest<AppRequest>().user;
    if (!user) throw new Error('CurrentUser used on a route without AuthGuard');
    return user;
  },
);
