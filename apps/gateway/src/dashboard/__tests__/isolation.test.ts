import type { FastifyInstance } from 'fastify';
import type { Response as InjectResponse } from 'light-my-request';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { closeDb, db } from '../../db/client.js';
import { connectRedis, createRedis } from '../../lib/redis.js';
import { ProviderRegistry } from '../../providers/registry.js';
import { signSession } from '../sessions.js';
import { seedPricing } from '../../test/helpers.js';

/**
 * Cross-tenant access tests.
 *
 * Two fully separate orgs are created through the real signup endpoint, each
 * generates traffic through the real gateway, and then every dashboard route is
 * probed with the WRONG tenant's session cookie.
 */
const SECRET = 'test-secret-not-a-real-one';
const redis = createRedis();
let app: FastifyInstance;

interface Actor {
  cookie: string;
  orgId: string;
  apiKey: string;
  requestId: string;
  keyId: string;
}

beforeAll(async () => {
  await connectRedis(redis);
  await seedPricing('mock', 'mock-small', '3.00', '15.00');
  app = await buildApp({
    db, redis, registry: new ProviderRegistry(['mock']),
    rateLimitPerMinute: 1000, cacheTtlSeconds: 1, upstreamTimeoutMs: 3_000,
    authSecret: SECRET,
  });
});

afterAll(async () => {
  await app.close();
  if (redis.status === 'ready') await redis.quit();
  await closeDb();
});

async function makeActor(label: string): Promise<Actor> {
  const email = `${label}-${Math.random().toString(36).slice(2)}@example.com`;
  const signup = await app.inject({
    method: 'POST', url: '/api/auth/signup',
    payload: { email, password: 'a-long-enough-password', orgName: `${label} Inc` },
  });
  expect(signup.statusCode).toBe(201);
  const cookie = (signup.headers['set-cookie'] as string).split(';')[0]!;

  const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
  const orgId = JSON.parse(me.body).org.id as string;

  const keyRes = await app.inject({
    method: 'POST', url: '/api/keys', headers: { cookie }, payload: { name: 'k' },
  });
  const created = JSON.parse(keyRes.body) as { plaintext: string; id: string };

  await app.inject({
    method: 'POST', url: '/v1/chat/completions',
    headers: { authorization: `Bearer ${created.plaintext}` },
    payload: { model: 'mock-small', messages: [{ role: 'user', content: `${label} private prompt` }], temperature: 0 },
  });

  const list = await app.inject({ method: 'GET', url: '/api/requests', headers: { cookie } });
  const requestId = JSON.parse(list.body).data[0].id as string;

  return { cookie, orgId, apiKey: created.plaintext, requestId, keyId: created.id };
}

let alice: Actor;
let bob: Actor;

beforeAll(async () => {
  alice = await makeActor('alice');
  bob = await makeActor('bob');
});

const get = async (url: string, cookie?: string): Promise<InjectResponse> =>
  app.inject({ method: 'GET', url, ...(cookie === undefined ? {} : { headers: { cookie } }) });

describe('unauthenticated access', () => {
  it('refuses every dashboard route without a session', async () => {
    for (const url of ['/api/me', '/api/overview', '/api/timeseries', '/api/models',
      '/api/requests', '/api/keys', '/api/projects']) {
      expect((await get(url)).statusCode, url).toBe(401);
    }
  });

  it('refuses a forged session cookie', async () => {
    const forged = `tg_session=${alice.orgId}.${Date.now() + 100000}.deadbeef`;
    expect((await get('/api/overview', forged)).statusCode).toBe(401);
  });

  it('refuses an expired but correctly signed session', async () => {
    const past = signSession('some-user', SECRET, Date.now() - 24 * 60 * 60 * 1000 - 1000);
    expect((await get('/api/overview', `tg_session=${past}`)).statusCode).toBe(401);
  });

  it('refuses a session signed with a different secret', async () => {
    const wrong = signSession('some-user', 'attacker-secret');
    expect((await get('/api/overview', `tg_session=${wrong}`)).statusCode).toBe(401);
  });
});

describe('cross-tenant reads', () => {
  it('never returns another org\'s requests in the list', async () => {
    const res = await get('/api/requests', alice.cookie);
    const ids = (JSON.parse(res.body).data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(alice.requestId);
    expect(ids).not.toContain(bob.requestId);
  });

  it('returns 404 — not 403 — for another org\'s request by id', async () => {
    const res = await get(`/api/requests/${bob.requestId}`, alice.cookie);
    // 403 would confirm the id exists somewhere, which is itself a leak.
    expect(res.statusCode).toBe(404);
  });

  it('never returns another org\'s API keys', async () => {
    const res = await get('/api/keys', alice.cookie);
    const keys = JSON.parse(res.body) as Array<{ id: string }>;
    expect(keys.map((k) => k.id)).not.toContain(bob.keyId);
  });

  it('never returns another org\'s projects', async () => {
    const mine = JSON.parse((await get('/api/projects', alice.cookie)).body) as Array<{ id: string }>;
    const theirs = JSON.parse((await get('/api/projects', bob.cookie)).body) as Array<{ id: string }>;
    const overlap = mine.filter((p) => theirs.some((t) => t.id === p.id));
    expect(overlap).toHaveLength(0);
  });

  it('scopes aggregate analytics per org', async () => {
    const a = JSON.parse((await get('/api/overview', alice.cookie)).body);
    const b = JSON.parse((await get('/api/overview', bob.cookie)).body);
    expect(a.requests).toBeGreaterThan(0);
    expect(b.requests).toBeGreaterThan(0);

    const all = await db.selectFrom('requests').select(db.fn.countAll().as('n'))
      .executeTakeFirstOrThrow();
    // Neither org sees the global total.
    expect(a.requests).toBeLessThan(Number(all.n));
    expect(b.requests).toBeLessThan(Number(all.n));
  });

  it('scopes the model breakdown per org', async () => {
    const res = await get('/api/models', alice.cookie);
    const rows = JSON.parse(res.body) as Array<{ requests: number }>;
    const total = rows.reduce((n, r) => n + r.requests, 0);
    const aliceTotal = JSON.parse((await get('/api/overview', alice.cookie)).body).requests;
    expect(total).toBe(aliceTotal);
  });
});

describe('cross-tenant writes', () => {
  it('refuses to revoke another org\'s key and leaves it usable', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/keys/${bob.keyId}/revoke`, headers: { cookie: alice.cookie },
    });
    expect(res.statusCode).toBe(404);

    // Prove the attack had no effect: Bob's key still authenticates.
    const still = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${bob.apiKey}` },
      payload: { model: 'mock-small', messages: [{ role: 'user', content: 'still working' }] },
    });
    expect(still.statusCode).toBe(200);
  });

  it('lets an owner revoke their own key, after which it stops working', async () => {
    const victim = await makeActor('victim');
    const res = await app.inject({
      method: 'POST', url: `/api/keys/${victim.keyId}/revoke`, headers: { cookie: victim.cookie },
    });
    expect(res.statusCode).toBe(200);

    const after = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${victim.apiKey}` },
      payload: { model: 'mock-small', messages: [{ role: 'user', content: 'x' }] },
    });
    expect(after.statusCode).toBe(401);
  });
});

describe('secret handling', () => {
  it('returns the plaintext key exactly once, at creation', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/keys', headers: { cookie: alice.cookie },
      payload: { name: 'once' },
    });
    const plaintext = JSON.parse(created.body).plaintext as string;
    expect(plaintext.startsWith('tg_live_')).toBe(true);

    const listed = await get('/api/keys', alice.cookie);
    expect(listed.body).not.toContain(plaintext);
    expect(listed.body).not.toContain('key_hash');
    expect(listed.body).not.toContain('keyHash');
  });
});

describe('RBAC', () => {
  it('refuses key creation and revocation to a MEMBER', async () => {
    const member = await makeActor('member');
    await db.updateTable('memberships').set({ role: 'MEMBER' })
      .where('org_id', '=', member.orgId).execute();

    const create = await app.inject({
      method: 'POST', url: '/api/keys', headers: { cookie: member.cookie }, payload: { name: 'nope' },
    });
    expect(create.statusCode).toBe(403);

    const revoke = await app.inject({
      method: 'POST', url: `/api/keys/${member.keyId}/revoke`, headers: { cookie: member.cookie },
    });
    expect(revoke.statusCode).toBe(403);

    // Read access is unaffected.
    expect((await get('/api/overview', member.cookie)).statusCode).toBe(200);
  });
});
