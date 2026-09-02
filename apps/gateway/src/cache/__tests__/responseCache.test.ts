import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectRedis, createRedis } from '../../lib/redis.js';
import { cacheKey, isCacheable, ResponseCache } from '../responseCache.js';
import type { CompletionRequest, CompletionResult } from '../../providers/types.js';

const redis = createRedis();
const cache = new ResponseCache(redis, 60);

beforeAll(async () => { await connectRedis(redis); });
afterAll(async () => { if (redis.status === 'ready') await redis.quit(); });

const req: CompletionRequest = {
  model: 'mock-small',
  messages: [{ role: 'user', content: 'what is the capital of France' }],
  temperature: 0,
};

const result: CompletionResult = {
  content: 'tenant A secret answer',
  model: 'mock-small',
  usage: { promptTokens: 10, completionTokens: 5 },
  finishReason: 'stop',
};

const scope = () => ({ orgId: randomUUID(), projectId: randomUUID() });

describe('cache key composition', () => {
  it('is deterministic for identical scope and request', () => {
    const s = scope();
    expect(cacheKey(s, req)).toBe(cacheKey(s, req));
  });

  it('is deterministic regardless of object key insertion order', () => {
    const s = scope();
    const a: CompletionRequest = { model: 'm', messages: [{ role: 'user', content: 'x' }], temperature: 0, maxTokens: 10 };
    const b: CompletionRequest = { maxTokens: 10, temperature: 0, messages: [{ role: 'user', content: 'x' }], model: 'm' };
    expect(cacheKey(s, a)).toBe(cacheKey(s, b));
  });

  it('changes when any part of the request changes', () => {
    const s = scope();
    const other: CompletionRequest = { ...req, messages: [{ role: 'user', content: 'different' }] };
    expect(cacheKey(s, other)).not.toBe(cacheKey(s, req));
    expect(cacheKey(s, { ...req, model: 'mock-large' })).not.toBe(cacheKey(s, req));
    expect(cacheKey(s, { ...req, maxTokens: 5 })).not.toBe(cacheKey(s, req));
  });

  it('puts the org id first so isolation is structural, not incidental', () => {
    const s = scope();
    expect(cacheKey(s, req).startsWith(`cache:v1:${s.orgId}:`)).toBe(true);
  });
});

describe('tenant isolation', () => {
  it('NEVER serves org A\'s cached response to org B for an identical prompt', async () => {
    const orgA = scope();
    const orgB = scope();

    await cache.set(orgA, req, result);

    expect(await cache.get(orgA, req)).toEqual(result);
    expect(await cache.get(orgB, req)).toBeNull(); // the leak this guards against
  });

  it('isolates projects inside the same org', async () => {
    const orgId = randomUUID();
    const p1 = { orgId, projectId: randomUUID() };
    const p2 = { orgId, projectId: randomUUID() };

    await cache.set(p1, req, result);
    expect(await cache.get(p1, req)).toEqual(result);
    expect(await cache.get(p2, req)).toBeNull();
  });
});

describe('cacheability', () => {
  it('refuses to cache non-deterministic requests', () => {
    expect(isCacheable({ ...req, temperature: 0.7 })).toBe(false);
    expect(isCacheable(req)).toBe(true);
  });

  it('does not write or read when the request is non-deterministic', async () => {
    const s = scope();
    const hot: CompletionRequest = { ...req, temperature: 0.9 };
    await cache.set(s, hot, result);
    expect(await cache.get(s, hot)).toBeNull();
  });
});

describe('invalidation', () => {
  it('clears one org without touching another', async () => {
    const orgA = scope();
    const orgB = scope();
    await cache.set(orgA, req, result);
    await cache.set(orgB, req, result);

    const deleted = await cache.invalidateOrg(orgA.orgId);
    expect(deleted).toBe(1);
    expect(await cache.get(orgA, req)).toBeNull();
    expect(await cache.get(orgB, req)).toEqual(result);
  });
});
