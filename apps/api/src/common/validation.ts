import type { z } from 'zod';
import { ApiError, FieldError } from './api-error';

/** Parses a request body or query with a shared zod schema; unknown fields are rejected (05 §28). */
export function parseInput<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body ?? {});
  if (result.success) return result.data;
  const fieldErrors: FieldError[] = result.error.issues.flatMap((issue) =>
    issue.code === 'unrecognized_keys'
      ? issue.keys.map((key) => ({ field: key, code: 'UNKNOWN_FIELD' }))
      : [{ field: issue.path.join('.') || 'body', code: 'INVALID' }],
  );
  throw new ApiError(400, 'VALIDATION_FAILED', 'Check the highlighted fields and try again.', {
    fieldErrors,
  });
}
