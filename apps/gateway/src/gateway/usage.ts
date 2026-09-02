import type { Kysely } from 'kysely';
import type { DB, RequestStatus } from '../db/types.js';
import type { AuthContext } from '../auth/apiKeys.js';

/**
 * Usage ledger writes.
 *
 * INVARIANT: every request that passes authentication produces exactly one row,
 * success or failure. A failed request still consumed gateway capacity and may
 * still have cost money upstream. Recording only successes makes the ledger
 * disagree with the provider invoice, which defeats the product.
 */
export interface UsageRecord {
  ctx: AuthContext;
  provider: string;
  model: string;
  status: RequestStatus;
  statusCode: number;
  latencyMs: number;
  upstreamMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: string | null;
  costKnown: boolean;
  cacheHit: boolean;
  streamed: boolean;
  retryCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  idempotencyKey: string | null;
}

export async function recordUsage(db: Kysely<DB>, r: UsageRecord): Promise<string> {
  const total =
    r.promptTokens === null && r.completionTokens === null
      ? null
      : (r.promptTokens ?? 0) + (r.completionTokens ?? 0);

  const row = await db
    .insertInto('requests')
    .values({
      org_id: r.ctx.orgId,
      project_id: r.ctx.projectId,
      api_key_id: r.ctx.apiKeyId,
      provider: r.provider,
      model: r.model,
      status: r.status,
      status_code: r.statusCode,
      latency_ms: r.latencyMs,
      upstream_ms: r.upstreamMs,
      prompt_tokens: r.promptTokens,
      completion_tokens: r.completionTokens,
      total_tokens: total,
      cost_usd: r.costUsd,
      cost_known: r.costKnown,
      cache_hit: r.cacheHit,
      streamed: r.streamed,
      retry_count: r.retryCount,
      error_code: r.errorCode,
      error_message: r.errorMessage,
      idempotency_key: r.idempotencyKey,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return row.id;
}

/**
 * Idempotency lookup.
 *
 * WHY: a client that times out and retries must not be billed twice for one
 * logical request. The partial unique index on (org_id, idempotency_key) makes
 * the double-insert impossible at the database level; this read makes the retry
 * cheap by short-circuiting before the upstream call.
 *
 * Scoped to org_id: two tenants may legitimately use the same key string, and
 * one must never see the other's replayed result.
 */
export async function findByIdempotencyKey(
  db: Kysely<DB>, orgId: string, key: string,
) {
  return db
    .selectFrom('requests')
    .selectAll()
    .where('org_id', '=', orgId)
    .where('idempotency_key', '=', key)
    .executeTakeFirst();
}
