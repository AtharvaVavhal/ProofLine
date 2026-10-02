import { HttpException } from '@nestjs/common';

export type FieldError = { field: string; code: string };

/**
 * An error with a stable code from the 05 §5 catalogue. `message` must be safe to show to the
 * user: never evidence, values, SQL, provider errors or secrets.
 */
export class ApiError extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
    readonly extras: {
      fieldErrors?: FieldError[];
      details?: Record<string, string | number | boolean>;
      retryAfterSeconds?: number;
    } = {},
  ) {
    super(message, status);
  }
}

export const unauthenticated = () => new ApiError(401, 'UNAUTHENTICATED', 'Please sign in again.');

export const rateLimited = (
  retryAfterSeconds: number,
  message = 'Please wait before trying again.',
) => new ApiError(429, 'RATE_LIMITED', message, { retryAfterSeconds });
