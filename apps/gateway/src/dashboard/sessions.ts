import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Stateless signed session tokens for the dashboard.
 *
 * WHY not a JWT library: we need exactly one claim (user id) and one expiry.
 * A JWT brings an algorithm field that an attacker can try to set to "none",
 * a spec surface we do not use, and a dependency. This is HMAC-SHA256 over
 * `userId.expiry`, which has no algorithm negotiation to confuse.
 *
 * WHY not server-side sessions in Redis: revocation would be instant, which is
 * genuinely better. Rejected for V1 because a Redis outage would then log
 * everyone out of the dashboard, and the dashboard is how you find out Redis is
 * down. Short expiry is the compromise. Noted in ADR-007.
 */
const TTL_MS = 12 * 60 * 60 * 1000;

export function signSession(userId: string, secret: string, now = Date.now()): string {
  const expiry = now + TTL_MS;
  const payload = `${userId}.${expiry}`;
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySession(
  token: string, secret: string, now = Date.now(),
): { userId: string } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, expiryRaw, sig] = parts as [string, string, string];

  const expected = createHmac('sha256', secret)
    .update(`${userId}.${expiryRaw}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  // Length check first: timingSafeEqual throws on mismatched lengths.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const expiry = Number(expiryRaw);
  if (!Number.isFinite(expiry) || expiry <= now) return null;
  return { userId };
}

export function newCsrfToken(): string {
  return randomBytes(24).toString('base64url');
}
