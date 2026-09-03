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
  tenant = await createTenant('idem');
  app = await buildApp({
    db, redis, registry: new ProviderRegistry(['mock']),
    rateLimitPerMinute: 1000, cacheTtlSeconds: 1, upstreamTimeoutMs: 3_000,
  });
});

afterAll(async () => {
  await app.close();
  if (redis.status === 'ready') await redis.quit();
  await closeDb();
});

const post = async (
  key: string, content: string, idem?: string,
): Promise<InjectResponse> => app.inject({
  method: 'POST', url: '/v1/chat/completions',
  headers: {
    authorization: `Bearer ${key}`,
    ...(idem === undefined ? {} : { 'idempotency-key': idem }),
  },
  payload: {
    model: 'mock-small',
    messages: [{ role: 'user', content }],
    temperature: 0.5, // non-deterministic, so the CACHE cannot explain results
  },
});

const countFor = async (orgId: string, idem: string): Promise<number> => {
  const r = await db.selectFrom('requests').select(db.fn.countAll().as('n'))
    .where('org_id', '=', orgId).where('idempotency_key', '=', idem)
    .executeTakeFirstOrThrow();
  return Number(r.n);
};

describe('idempotent replay', () => {
  it('bills a retried request exactly once and returns identical bytes', async () => {
    const idem = `retry-${Math.random()}`;
    const first = await post(tenant.apiKey, 'charge me once', idem);
    expect(first.statusCode).toBe(200);
    expect(first.headers['x-conduit-idempotent-replay']).toBeUndefined();

    const second = await post(tenant.apiKey, 'charge me once', idem);
    expect(second.statusCode).toBe(200);
    expect(second.headers['x-conduit-idempotent-replay']).toBe('true');
    expect(second.body).toBe(first.body);

    expect(await countFor(tenant.orgId, idem)).toBe(1);
  });

  it('replays even when the retried body differs — the key is the identity', async () => {
    const idem = `differing-${Math.random()}`;
    const first = await post(tenant.apiKey, 'original prompt', idem);
    const second = await post(tenant.apiKey, 'COMPLETELY different prompt', idem);
    expect(second.body).toBe(first.body);
    expect(await countFor(tenant.orgId, idem)).toBe(1);
  });

  it('scopes keys to the org — one tenant cannot replay another\'s response', async () => {
    const shared = `shared-key-${Math.random()}`;
    const orgA = await createTenant('idem-a');
    const orgB = await createTenant('idem-b');

    const a = await post(orgA.apiKey, 'org A private prompt', shared);
    const b = await post(orgB.apiKey, 'org B prompt', shared);

    expect(b.headers['x-conduit-idempotent-replay']).toBeUndefined();
    expect(await countFor(orgA.orgId, shared)).toBe(1);
    expect(await countFor(orgB.orgId, shared)).toBe(1);
    expect(a.statusCode).toBe(200);
  });

  it('admits exactly one row when concurrent retries race the unique index', async () => {
    const idem = `race-${Math.random()}`;
    // All five miss the replay read, all five call upstream, all five try to
    // insert. The partial unique index lets one win; the losers must replay,
    // not 500.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => post(tenant.apiKey, 'concurrent retry', idem)),
    );

    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(await countFor(tenant.orgId, idem)).toBe(1);
    const bodies = new Set(results.map((r) => r.body));
    expect(bodies.size).toBe(1); // every caller saw the same bytes
  });

  it('does not replay requests sent without a key', async () => {
    const before = await db.selectFrom('requests').select(db.fn.countAll().as('n'))
      .where('org_id', '=', tenant.orgId).executeTakeFirstOrThrow();
    await post(tenant.apiKey, 'no key A');
    await post(tenant.apiKey, 'no key B');
    const after = await db.selectFrom('requests').select(db.fn.countAll().as('n'))
      .where('org_id', '=', tenant.orgId).executeTakeFirstOrThrow();
    expect(Number(after.n)).toBe(Number(before.n) + 2);
  });
});