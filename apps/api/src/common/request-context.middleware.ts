import { randomBytes } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import type { AppRequest } from './app-request';

/**
 * Assigns the request ID (05 §3) and applies the response headers required by 09 §18 to every
 * API response.
 */
export function requestContext(req: AppRequest, res: Response, next: NextFunction): void {
  req.requestId = `req_${randomBytes(12).toString('hex')}`;
  res.setHeader('X-Request-Id', req.requestId);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
}
