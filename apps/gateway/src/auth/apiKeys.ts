import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '../db/types.js';

/**
 * API key generation, storage and verification. See ADR-003.
 *
 * Format:  tg_live_<44-char base64url secret>
 * Stored:  prefix (first 12 chars of the secret), SHA-256 of the whole key,
 *          last 4 chars for human recognition. Never the key itself.
 */

const KEY_PREFIX = 'tg_live_';
const SECRET_BYTES = 32; // 256 bits of entropy
const LOOKUP_PREFIX_LEN = 12;

export interface GeneratedKey {
  /** Returned to the caller exactly once, then unrecoverable. */
  plaintext: string;
  prefix: string;
  keyHash: string;
  last4: string;
}

export function generateApiKey(): GeneratedKey {
  // randomBytes, not Math.random: keys must be unguessable, and Math.random is
  // a deterministic PRNG whose state can be recovered from a few outputs.
  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  const plaintext = `${KEY_PREFIX}${secret}`;
  return {
    plaintext,
    prefix: secret.slice(0, LOOKUP_PREFIX_LEN),
    keyHash: hashApiKey(plaintext),
    last4: secret.slice(-4),
  };
}

/**
 * SHA-256, deliberately, NOT bcrypt or argon2.
 *
 * Slow password hashes exist to make guessing low-entropy human-chosen
 * passwords expensive. This key has 256 bits of entropy from a CSPRNG; there
 * is no dictionary to guess from, so a slow hash buys no security here. It
 * would however add tens of milliseconds to EVERY proxied request, on a
 * service whose entire value proposition is low added latency.
 *
 * The user password path uses scrypt, because those ARE low-entropy.
 */
export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

export function extractPrefix(plaintext: string): string | null {
  if (!plaintext.startsWith(KEY_PREFIX)) return null;
  const secret = plaintext.slice(KEY_PREFIX.length);
  if (secret.length < LOOKUP_PREFIX_LEN) return null;
  return secret.slice(0, LOOKUP_PREFIX_LEN);
}

/**
 * Constant-time comparison.
 *
 * Even though both sides are already hashes, a byte-by-byte `===` leaks how
 * many leading characters matched via timing. Free to avoid, so avoid it.
 */
export function verifyKeyHash(candidateHash: string, storedHash: string): boolean {
  const a = Buffer.from(candidateHash, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type AuthFailure =
  | 'MALFORMED'
  | 'NOT_FOUND'
  | 'REVOKED'
  | 'EXPIRED';

export interface AuthContext {
  apiKeyId: string;
  projectId: string;
  orgId: string;
}

/**
 * Authenticate a raw key against the database.
 *
 * WHY the prefix column exists: without it, verifying a key means loading every
 * hash and comparing, which is O(number of keys) per request. With it,
 * authentication is one indexed lookup plus one constant-time compare. The
 * prefix is not a secret and grants nothing on its own.
 *
 * Returns a discriminated result rather than throwing, so the caller decides
 * what the client is told. All four failures return 401 externally: telling a
 * caller "that key exists but is revoked" confirms the key is real.
 */
export async function authenticateApiKey(
  db: Kysely<DB>,
  plaintext: string,
  now: Date = new Date(),
): Promise<{ ok: true; ctx: AuthContext } | { ok: false; reason: AuthFailure }> {
  const prefix = extractPrefix(plaintext);
  if (prefix === null) return { ok: false, reason: 'MALFORMED' };

  const row = await db
    .selectFrom('api_keys')
    .innerJoin('projects', 'projects.id', 'api_keys.project_id')
    .select([
      'api_keys.id as apiKeyId',
      'api_keys.key_hash as keyHash',
      'api_keys.revoked_at as revokedAt',
      'api_keys.expires_at as expiresAt',
      'projects.id as projectId',
      'projects.org_id as orgId',
    ])
    .where('api_keys.prefix', '=', prefix)
    .executeTakeFirst();

  if (row === undefined) return { ok: false, reason: 'NOT_FOUND' };
  if (!verifyKeyHash(hashApiKey(plaintext), row.keyHash)) {
    return { ok: false, reason: 'NOT_FOUND' };
  }
  if (row.revokedAt !== null) return { ok: false, reason: 'REVOKED' };
  if (row.expiresAt !== null && new Date(row.expiresAt) <= now) {
    return { ok: false, reason: 'EXPIRED' };
  }

  return {
    ok: true,
    ctx: { apiKeyId: row.apiKeyId, projectId: row.projectId, orgId: row.orgId },
  };
}
