import { afterAll, describe, expect, it } from 'vitest';
import { db, closeDb } from '../../db/client.js';
import {
  authenticateApiKey, extractPrefix, generateApiKey, hashApiKey, verifyKeyHash,
} from '../apiKeys.js';
import { createTenant } from '../../test/helpers.js';

afterAll(async () => { await closeDb(); });

describe('API key generation', () => {
  it('never returns the same key twice', () => {
    const keys = new Set(Array.from({ length: 500 }, () => generateApiKey().plaintext));
    expect(keys.size).toBe(500);
  });

  it('produces a prefix derivable from the plaintext', () => {
    const k = generateApiKey();
    expect(extractPrefix(k.plaintext)).toBe(k.prefix);
  });

  it('rejects malformed keys at parse time, before touching the database', () => {
    expect(extractPrefix('not-a-key')).toBeNull();
    expect(extractPrefix('tg_live_')).toBeNull();
  });

  it('hashes deterministically and compares in constant time', () => {
    const k = generateApiKey();
    expect(verifyKeyHash(hashApiKey(k.plaintext), k.keyHash)).toBe(true);
    expect(verifyKeyHash(hashApiKey('tg_live_wrong'), k.keyHash)).toBe(false);
  });
});

describe('authenticateApiKey', () => {
  it('resolves a valid key to its project and org', async () => {
    const t = await createTenant();
    const result = await authenticateApiKey(db, t.apiKey);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ctx.orgId).toBe(t.orgId);
      expect(result.ctx.projectId).toBe(t.projectId);
    }
  });

  it('rejects a key whose prefix exists but whose secret differs', async () => {
    const t = await createTenant();
    // Same prefix, different secret body: proves the prefix alone grants nothing.
    const prefix = extractPrefix(t.apiKey)!;
    const forged = `tg_live_${prefix}${'A'.repeat(32)}`;
    const result = await authenticateApiKey(db, forged);
    expect(result).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });

  it('rejects a revoked key', async () => {
    const t = await createTenant();
    await db.updateTable('api_keys').set({ revoked_at: new Date() })
      .where('id', '=', t.apiKeyId).execute();
    expect(await authenticateApiKey(db, t.apiKey)).toEqual({ ok: false, reason: 'REVOKED' });
  });

  it('rejects an expired key', async () => {
    const t = await createTenant();
    await db.updateTable('api_keys').set({ expires_at: new Date(Date.now() - 1000) })
      .where('id', '=', t.apiKeyId).execute();
    expect(await authenticateApiKey(db, t.apiKey)).toEqual({ ok: false, reason: 'EXPIRED' });
  });

  it('accepts a key whose expiry is still in the future', async () => {
    const t = await createTenant();
    await db.updateTable('api_keys').set({ expires_at: new Date(Date.now() + 60_000) })
      .where('id', '=', t.apiKeyId).execute();
    expect((await authenticateApiKey(db, t.apiKey)).ok).toBe(true);
  });

  it('does not leak whether an unknown prefix exists', async () => {
    const unknown = generateApiKey().plaintext;
    expect(await authenticateApiKey(db, unknown)).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });
});
