import type { Redis } from 'ioredis';

/**
 * Sliding-window-counter rate limiter, evaluated atomically in Redis. ADR-004.
 *
 * WHY NOT a naive GET / compare / SET: between the read and the write, another
 * concurrent request reads the same value. Under load both are admitted and the
 * limit is exceeded. This is the classic read-modify-write race, and on a
 * multi-instance deployment it happens constantly.
 *
 * WHY NOT a fixed window: a caller can send the full quota at 11:59:59 and the
 * full quota again at 12:00:00, passing 2x the limit in one second.
 *
 * WHY NOT a strict sorted-set sliding log: it is exact, but stores one member
 * per request, so memory grows with traffic. Overkill for an API quota.
 *
 * The counter approximation: weight the previous window's count by how much of
 * it still overlaps the trailing window. Bounded error, O(1) memory, two
 * integer keys per subject.
 */
const SCRIPT = `
local current_key = KEYS[1]
local previous_key = KEYS[2]
local limit        = tonumber(ARGV[1])
local window_ms    = tonumber(ARGV[2])
local now_ms       = tonumber(ARGV[3])
local cost         = tonumber(ARGV[4])

local elapsed  = now_ms % window_ms
local previous = tonumber(redis.call('GET', previous_key) or '0')
local current  = tonumber(redis.call('GET', current_key) or '0')

-- Fraction of the previous window still inside the trailing window.
local weight    = (window_ms - elapsed) / window_ms
local estimated = (previous * weight) + current

if estimated + cost > limit then
  local retry_after = math.ceil((window_ms - elapsed) / 1000)
  return {0, math.floor(estimated), retry_after}
end

local updated = redis.call('INCRBY', current_key, cost)
-- Two windows of TTL so the counter survives long enough to be the "previous"
-- window on the next tick, then expires on its own. No cleanup job needed.
redis.call('PEXPIRE', current_key, window_ms * 2)
return {1, math.floor(estimated + cost), 0}
`;

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
  retryAfterSeconds: number;
}

export class RateLimiter {
  private scriptSha: string | null = null;

  constructor(private readonly redis: Redis) {}

  /**
   * `cost` lets one call reserve more than one unit, which is how a
   * token-based quota reuses the same limiter as a request-count quota.
   */
  async check(
    subject: string,
    limit: number,
    windowMs: number,
    cost = 1,
    now: number = Date.now(),
  ): Promise<RateLimitResult> {
    const windowId = Math.floor(now / windowMs);
    const currentKey = `rl:${subject}:${windowId}`;
    const previousKey = `rl:${subject}:${windowId - 1}`;

    // EVALSHA first, EVAL as fallback: the script is shipped to Redis once
    // instead of on every request.
    this.scriptSha ??= await this.redis.script('LOAD', SCRIPT) as string;

    let raw: [number, number, number];
    try {
      raw = (await this.redis.evalsha(
        this.scriptSha, 2, currentKey, previousKey,
        String(limit), String(windowMs), String(now), String(cost),
      )) as [number, number, number];
    } catch (err) {
      // Redis restarts flush the script cache. Reload and retry once.
      if (err instanceof Error && err.message.includes('NOSCRIPT')) {
        this.scriptSha = (await this.redis.script('LOAD', SCRIPT)) as string;
        raw = (await this.redis.evalsha(
          this.scriptSha, 2, currentKey, previousKey,
          String(limit), String(windowMs), String(now), String(cost),
        )) as [number, number, number];
      } else {
        throw err;
      }
    }

    const [allowed, used, retryAfter] = raw;
    return {
      allowed: allowed === 1,
      limit,
      used,
      remaining: Math.max(0, limit - used),
      retryAfterSeconds: retryAfter,
    };
  }
}
