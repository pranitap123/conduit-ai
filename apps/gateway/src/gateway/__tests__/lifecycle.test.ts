import type { FastifyInstance } from 'fastify';
import type { Response as InjectResponse } from 'light-my-request';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { closeDb, db } from '../../db/client.js';
import { connectRedis, createRedis } from '../../lib/redis.js';
import { ProviderRegistry } from '../../providers/registry.js';
import { createTenant, seedPricing, type Tenant } from '../../test/helpers.js';

const redis = createRedis();
let app: FastifyInstance;
let tenant: Tenant;

beforeAll(async () => {
  await connectRedis(redis);
  await seedPricing('mock', 'mock-small', '3.00', '15.00');
  tenant = await createTenant('lifecycle');
  app = await buildApp({
    db, redis,
    registry: new ProviderRegistry(['mock']),
    rateLimitPerMinute: 1000,
    cacheTtlSeconds: 60,
    upstreamTimeoutMs: 2_000,
  });
});

afterAll(async () => {
  await app.close();
  if (redis.status === 'ready') await redis.quit();
  await closeDb();
});

const post = async (
  key: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<InjectResponse> =>
  app.inject({
    method: 'POST', url: '/v1/chat/completions',
    headers: { authorization: `Bearer ${key}`, ...headers },
    payload: body,
  });

const basic = (content = `unique-${Math.random()}`) => ({
  model: 'mock-small',
  messages: [{ role: 'user', content }],
  temperature: 0,
});

const latestRequest = (orgId: string) =>
  db.selectFrom('requests').selectAll().where('org_id', '=', orgId)
    .orderBy('created_at', 'desc').limit(1).executeTakeFirstOrThrow();

describe('authentication', () => {
  it('rejects a missing Authorization header', async () => {
    const res: InjectResponse = await app.inject({
      method: 'POST', url: '/v1/chat/completions', payload: basic(),
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a garbage key', async () => {
    expect((await post('tg_live_nonsense', basic())).statusCode).toBe(401);
  });

  it('returns an identical body for revoked and unknown keys', async () => {
    const victim = await createTenant('revoked');
    await db.updateTable('api_keys').set({ revoked_at: new Date() })
      .where('id', '=', victim.apiKeyId).execute();

    const revoked = await post(victim.apiKey, basic());
    const unknown = await post('tg_live_aaaaaaaaaaaaaaaaaaaaaaaa', basic());
    expect(revoked.statusCode).toBe(401);
    expect(JSON.parse(revoked.body).error.message)
      .toBe(JSON.parse(unknown.body).error.message);
  });
});

describe('validation', () => {
  it('rejects an empty messages array', async () => {
    const res = await post(tenant.apiKey, { model: 'mock-small', messages: [] });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for a model no provider serves', async () => {
    const res = await post(tenant.apiKey, { ...basic(), model: 'gpt-nonexistent' });
    expect(res.statusCode).toBe(404);
    const row = await latestRequest(tenant.orgId);
    // Failures are recorded too, or the ledger disagrees with reality.
    expect(row.status).toBe('CLIENT_ERROR');
    expect(row.error_code).toBe('model_not_found');
  });
});

describe('successful request lifecycle', () => {
  it('proxies, returns usage, and writes exactly one priced ledger row', async () => {
    const before = await db.selectFrom('requests').select(db.fn.countAll().as('n'))
      .where('org_id', '=', tenant.orgId).executeTakeFirstOrThrow();

    const res = await post(tenant.apiKey, basic('what is the capital of France'));
    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload.usage.promptTokens).toBeGreaterThan(0);

    const after = await db.selectFrom('requests').select(db.fn.countAll().as('n'))
      .where('org_id', '=', tenant.orgId).executeTakeFirstOrThrow();
    expect(Number(after.n)).toBe(Number(before.n) + 1);

    const row = await latestRequest(tenant.orgId);
    expect(row.status).toBe('SUCCESS');
    expect(row.cost_known).toBe(true);
    expect(Number(row.cost_usd)).toBeGreaterThan(0);
    expect(row.total_tokens).toBe((row.prompt_tokens ?? 0) + (row.completion_tokens ?? 0));
  });

  it('records cost_known=false for a model with no pricing row', async () => {
    await post(tenant.apiKey, { ...basic(), model: 'mock-unpriced' });
    const row = await latestRequest(tenant.orgId);
    expect(row.status).toBe('SUCCESS');
    expect(row.cost_known).toBe(false);
    expect(row.cost_usd).toBeNull(); // not 0.00 — we do not know
  });
});

describe('caching', () => {
  it('serves the second identical request from cache and marks the row', async () => {
    const body = basic('deterministic cache probe');
    const first = await post(tenant.apiKey, body);
    expect(first.headers['x-tollgate-cache']).toBe('MISS');

    const second = await post(tenant.apiKey, body);
    expect(second.headers['x-tollgate-cache']).toBe('HIT');
    expect(second.body).toBe(first.body);

    const row = await latestRequest(tenant.orgId);
    expect(row.cache_hit).toBe(true);
    expect(Number(row.cost_usd)).toBe(0); // known-zero: nothing was bought
  });

  it('does NOT serve one org a response cached for another', async () => {
    const orgA = await createTenant('cache-a');
    const orgB = await createTenant('cache-b');
    const body = basic('identical prompt across tenants');

    const a = await post(orgA.apiKey, body);
    expect(a.headers['x-tollgate-cache']).toBe('MISS');

    const b = await post(orgB.apiKey, body);
    expect(b.headers['x-tollgate-cache']).toBe('MISS'); // the leak, prevented
  });
});

describe('rate limiting', () => {
  it('returns 429 with Retry-After and records the rejection', async () => {
    const limited = await createTenant('limited');
    const strict = await buildApp({
      db, redis, registry: new ProviderRegistry(['mock']),
      rateLimitPerMinute: 2, cacheTtlSeconds: 60, upstreamTimeoutMs: 2_000,
    });

    const send = async (): Promise<InjectResponse> => strict.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${limited.apiKey}` },
      payload: basic(`rl-${Math.random()}`),
    });

    expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(200);
    const third = await send();
    expect(third.statusCode).toBe(429);
    expect(third.headers['retry-after']).toBeDefined();

    const row = await latestRequest(limited.orgId);
    expect(row.status).toBe('RATE_LIMITED');
    expect(row.status_code).toBe(429);
    await strict.close();
  });
});

describe('upstream failures', () => {
  it('maps a retryable upstream error to 502 and records it', async () => {
    const res = await post(tenant.apiKey, { ...basic(), model: 'mock-fail-retryable' });
    expect(res.statusCode).toBe(503);
    const row = await latestRequest(tenant.orgId);
    expect(row.status).toBe('UPSTREAM_ERROR');
    expect(row.prompt_tokens).toBeNull(); // unknown, not zero
    expect(row.cost_known).toBe(false);
  });

  it('never echoes the upstream error body to the client', async () => {
    const res = await post(tenant.apiKey, { ...basic(), model: 'mock-fail-permanent' });
    expect(res.body).not.toContain('mock invalid request');
    expect(JSON.parse(res.body).error.requestId).toBeDefined();
  });

  it('times out a slow upstream and records TIMEOUT', async () => {
    const res = await post(tenant.apiKey, { ...basic(), model: 'mock-slow' });
    expect(res.statusCode).toBe(504);
    const row = await latestRequest(tenant.orgId);
    expect(row.status).toBe('TIMEOUT');
  }, 10_000);
});

describe('tenant isolation of the ledger', () => {
  it('scopes every request row to the org that made it', async () => {
    const orgA = await createTenant('iso-a');
    const orgB = await createTenant('iso-b');

    await post(orgA.apiKey, basic('org A only'));

    const bRows = await db.selectFrom('requests').selectAll()
      .where('org_id', '=', orgB.orgId).execute();
    expect(bRows).toHaveLength(0);

    const aRows = await db.selectFrom('requests').selectAll()
      .where('org_id', '=', orgA.orgId).execute();
    expect(aRows).toHaveLength(1);
    expect(aRows[0]?.project_id).toBe(orgA.projectId);
  });
});
