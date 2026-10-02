import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ApiError, FieldError } from './api-error';
import type { AppRequest } from './app-request';

type Mapped = {
  status: number;
  code: string;
  message: string;
  fieldErrors?: FieldError[];
  details?: Record<string, string | number | boolean>;
  retryAfterSeconds?: number;
};

const GENERIC: Record<number, Omit<Mapped, 'status'>> = {
  400: { code: 'VALIDATION_FAILED', message: 'Check the request and try again.' },
  401: { code: 'UNAUTHENTICATED', message: 'Please sign in again.' },
  403: { code: 'ORIGIN_NOT_ALLOWED', message: "This request isn't allowed." },
  404: { code: 'NOT_FOUND', message: "This item isn't available." },
  429: { code: 'RATE_LIMITED', message: 'Please wait before trying again.' },
  503: {
    code: 'SERVICE_UNAVAILABLE',
    message: 'The service is temporarily unavailable. Please try again shortly.',
  },
};

const INTERNAL: Mapped = {
  status: 500,
  code: 'INTERNAL_ERROR',
  message: 'Something went wrong. Please try again.',
};

/** Body-parser errors (malformed JSON, oversized body) carry an HTTP status and a `type`. */
function isBodyParserError(error: unknown): error is { status: number; type: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { type?: unknown }).type === 'string' &&
    (error as { type: string }).type.startsWith('entity.')
  );
}

/**
 * Renders every error as the 05 §5 envelope. Unexpected errors are logged by class name and
 * request ID only: database driver messages can contain row values (Phase 1 note 5).
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<AppRequest>();
    const res = http.getResponse<Response>();
    const mapped = this.map(exception, req.requestId);

    if (mapped.retryAfterSeconds !== undefined) {
      res.setHeader('Retry-After', String(mapped.retryAfterSeconds));
    }
    res.status(mapped.status).json({
      error: {
        code: mapped.code,
        message: mapped.message,
        requestId: req.requestId,
        ...(mapped.fieldErrors ? { fieldErrors: mapped.fieldErrors } : {}),
        ...(mapped.details ? { details: mapped.details } : {}),
      },
    });
  }

  private map(exception: unknown, requestId: string): Mapped {
    if (exception instanceof ApiError) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        ...exception.extras,
      };
    }
    if (exception instanceof HttpException) {
      const generic = GENERIC[exception.getStatus()];
      if (generic) return { status: exception.getStatus(), ...generic };
    }
    if (isBodyParserError(exception) && exception.status >= 400 && exception.status < 500) {
      return { status: 400, ...GENERIC[400]! };
    }
    const name = exception instanceof Error ? exception.constructor.name : typeof exception;
    this.logger.error(`Unhandled ${name} (requestId=${requestId})`);
    return INTERNAL;
  }
}
