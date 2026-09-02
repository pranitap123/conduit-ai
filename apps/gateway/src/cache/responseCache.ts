import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { CompletionRequest, CompletionResult } from '../providers/types.js';

/**
 * Tenant-isolated response cache. See ADR-005.
 *
 * THE THREAT: two tenants send an identical prompt. If the cache key is derived
 * only from the request body, tenant B receives a response generated for tenant
 * A. That is a cross-tenant data leak dressed up as a performance win, and it
 * is the single most dangerous bug this component can have.
 *
 * THE DEFENCE: org_id is the FIRST component of the key and is not optional.
 * `cacheKey` cannot be called without one, and the key is namespaced by project
 * too, so a shared prompt in different projects stays separate.
 */

const NAMESPACE = 'cache:v1';

export interface CacheScope {
  orgId: string;
  projectId: string;
}

/**
 * Deterministic: identical scope + identical request must produce an identical
 * key across processes and restarts. JSON.stringify of the raw object is NOT
 * deterministic (key order follows insertion), so every field is serialised
 * explicitly, in a fixed order.
 */
export function cacheKey(scope: CacheScope, req: CompletionRequest): string {
  const canonical = JSON.stringify([
    req.model,
    req.messages.map((m) => [m.role, m.content]),
    req.maxTokens ?? null,
    req.temperature ?? null,
  ]);
  const digest = createHash('sha256').update(canonical).digest('hex');
  return `${NAMESPACE}:${scope.orgId}:${scope.projectId}:${digest}`;
}

/**
 * Only deterministic requests are cacheable. temperature > 0 means the caller
 * asked for variety; returning the same bytes every time would silently break
 * their product. Streaming responses are not cached in V1 — see ADR-005.
 */
export function isCacheable(req: CompletionRequest): boolean {
  return (req.temperature ?? 0) === 0;
}

export class ResponseCache {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number,
  ) {}

  async get(scope: CacheScope, req: CompletionRequest): Promise<CompletionResult | null> {
    if (!isCacheable(req)) return null;
    const raw = await this.redis.get(cacheKey(scope, req));
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as CompletionResult;
    } catch {
      // A corrupt entry must never take down a request. Treat it as a miss.
      return null;
    }
  }

  async set(scope: CacheScope, req: CompletionRequest, result: CompletionResult): Promise<void> {
    if (!isCacheable(req)) return;
    await this.redis.set(
      cacheKey(scope, req),
      JSON.stringify(result),
      'EX',
      this.ttlSeconds,
    );
  }

  /** Invalidate everything for one org, e.g. on offboarding. */
  async invalidateOrg(orgId: string): Promise<number> {
    // SCAN, not KEYS: KEYS blocks the single-threaded Redis event loop for the
    // whole scan, which stalls every other tenant's rate-limit check.
    let cursor = '0';
    let deleted = 0;
    do {
      const [next, keys] = await this.redis.scan(
        cursor, 'MATCH', `${NAMESPACE}:${orgId}:*`, 'COUNT', 200,
      );
      cursor = next;
      if (keys.length > 0) deleted += await this.redis.del(...keys);
    } while (cursor !== '0');
    return deleted;
  }
}
