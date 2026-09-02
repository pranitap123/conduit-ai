import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectRedis, createRedis } from '../../lib/redis.js';
import { RateLimiter } from '../rateLimiter.js';

const redis = createRedis();
const limiter = new RateLimiter(redis);

beforeAll(async () => { await connectRedis(redis); });
afterAll(async () => { if (redis.status === 'ready') await redis.quit(); });

const subject = () => `test:${randomUUID()}`;

describe('RateLimiter', () => {
  it('admits up to the limit and refuses the next request', async () => {
    const s = subject();
    for (let i = 0; i < 5; i += 1) {
      expect((await limiter.check(s, 5, 60_000)).allowed).toBe(true);
    }
    const denied = await limiter.check(s, 5, 60_000);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('is atomic under concurrency — the core reason for the Lua script', async () => {
    const s = subject();
    const LIMIT = 20;
    const CONCURRENT = 200;

    // Fired simultaneously. A read-modify-write limiter over-admits here.
    const results = await Promise.all(
      Array.from({ length: CONCURRENT }, () => limiter.check(s, LIMIT, 60_000)),
    );

    const admitted = results.filter((r) => r.allowed).length;
    expect(admitted).toBe(LIMIT);
    expect(results.length - admitted).toBe(CONCURRENT - LIMIT);
  });

  it('isolates subjects from one another', async () => {
    const a = subject();
    const b = subject();
    await limiter.check(a, 1, 60_000);
    expect((await limiter.check(a, 1, 60_000)).allowed).toBe(false);
    expect((await limiter.check(b, 1, 60_000)).allowed).toBe(true);
  });

  it('honours a cost greater than one, so token quotas reuse the same limiter', async () => {
    const s = subject();
    expect((await limiter.check(s, 100, 60_000, 90)).allowed).toBe(true);
    expect((await limiter.check(s, 100, 60_000, 20)).allowed).toBe(false);
    expect((await limiter.check(s, 100, 60_000, 10)).allowed).toBe(true);
  });

  it('does not allow a full quota either side of a window boundary', async () => {
    const s = subject();
    const windowMs = 60_000;
    // Land at the very end of a window.
    const boundary = (Math.floor(Date.now() / windowMs) + 1) * windowMs;

    for (let i = 0; i < 10; i += 1) {
      expect((await limiter.check(s, 10, windowMs, 1, boundary - 50)).allowed).toBe(true);
    }
    // One millisecond into the next window a FIXED window would reset to zero
    // and admit 10 more. The sliding counter still counts the previous window.
    const justAfter = await limiter.check(s, 10, windowMs, 1, boundary + 1);
    expect(justAfter.allowed).toBe(false);
  });
});
