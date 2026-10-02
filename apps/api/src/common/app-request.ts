import type { Request } from 'express';

/** The signed-in principal attached by AuthGuard. Contains no secrets. */
export type AuthenticatedUser = { id: string; sessionId: string };

export type AppRequest = Request & { requestId: string; user?: AuthenticatedUser };
