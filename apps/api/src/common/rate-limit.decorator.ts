import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_BUCKET = Symbol('RATE_LIMIT_BUCKET');

export type RateLimitBucket = { name: string; limit: number; windowMs: number };

/** Puts a route in its own per-user bucket instead of the 600/hour default (09 §18). */
export const RateLimit = (bucket: RateLimitBucket) => SetMetadata(RATE_LIMIT_BUCKET, bucket);

const HOUR_MS = 60 * 60 * 1000;

export const EVIDENCE_UPLOAD_LIMIT: RateLimitBucket = {
  name: 'evidence-upload',
  limit: 120,
  windowMs: HOUR_MS,
};
