import { Injectable } from '@nestjs/common';

/**
 * Sliding-window limiter held in process memory. The API and worker run as one process
 * (OD-15), so one instance sees every request. Used where no table records the attempts.
 */
@Injectable()
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  /** Records a hit and returns null if allowed, or the seconds until the next allowed hit. */
  consume(key: string, limit: number, windowMs: number, now = Date.now()): number | null {
    const recent = (this.hits.get(key) ?? []).filter((at) => at > now - windowMs);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      return Math.max(1, Math.ceil((recent[0]! + windowMs - now) / 1000));
    }
    recent.push(now);
    this.hits.set(key, recent);
    return null;
  }
}
