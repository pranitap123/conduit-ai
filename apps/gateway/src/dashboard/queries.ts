import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '../db/types.js';

/**
 * Every function here takes `orgId` as its FIRST argument and applies it as a
 * WHERE clause. There is no query in this file that can be called without a
 * tenant. That is the isolation model: not a middleware someone can forget to
 * register, but a parameter the type system requires.
 */

export interface Overview {
  requests: number;
  errors: number;
  cacheHits: number;
  totalTokens: number;
  costUsd: string;
  unpricedRequests: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
}

export async function overview(
  db: Kysely<DB>, orgId: string, sinceHours = 24,
): Promise<Overview> {
  const since = new Date(Date.now() - sinceHours * 3_600_000);

  const row = await db
    .selectFrom('requests')
    .where('org_id', '=', orgId)
    .where('created_at', '>=', since)
    .select([
      sql<string>`count(*)`.as('requests'),
      sql<string>`count(*) filter (where status <> 'SUCCESS')`.as('errors'),
      sql<string>`count(*) filter (where cache_hit)`.as('cache_hits'),
      // COALESCE only at the aggregate level: a NULL token count contributes
      // nothing to the sum rather than turning the whole sum into NULL.
      sql<string>`coalesce(sum(total_tokens), 0)`.as('total_tokens'),
      sql<string>`coalesce(sum(cost_usd) filter (where cost_known), 0)`.as('cost_usd'),
      // Surfaced separately so the UI can say "plus N unpriced" instead of
      // presenting an understated total as if it were complete.
      sql<string>`count(*) filter (where not cost_known)`.as('unpriced'),
      sql<string>`coalesce(percentile_disc(0.5) within group (order by latency_ms), 0)`.as('p50'),
      sql<string>`coalesce(percentile_disc(0.95) within group (order by latency_ms), 0)`.as('p95'),
    ])
    .executeTakeFirstOrThrow();

  return {
    requests: Number(row.requests),
    errors: Number(row.errors),
    cacheHits: Number(row.cache_hits),
    totalTokens: Number(row.total_tokens),
    costUsd: String(row.cost_usd),
    unpricedRequests: Number(row.unpriced),
    p50LatencyMs: Number(row.p50),
    p95LatencyMs: Number(row.p95),
  };
}

export interface TimeBucket {
  bucket: string;
  requests: number;
  errors: number;
  cacheHits: number;
  costUsd: string;
  p95LatencyMs: number;
}

export async function timeseries(
  db: Kysely<DB>, orgId: string, sinceHours = 24,
): Promise<TimeBucket[]> {
  const since = new Date(Date.now() - sinceHours * 3_600_000);
  const bucketMinutes = sinceHours <= 6 ? 5 : sinceHours <= 48 ? 60 : 360;

  // generate_series produces empty buckets too. Without it a quiet hour simply
  // vanishes from the chart, which makes an outage look like low traffic.
  const rows = await sql<{
    bucket: Date; requests: string; errors: string;
    cache_hits: string; cost_usd: string; p95: string;
  }>`
    with buckets as (
      select generate_series(
        date_bin(${`${bucketMinutes} minutes`}::interval, ${since}::timestamptz, 'epoch'),
        date_bin(${`${bucketMinutes} minutes`}::interval, now(), 'epoch'),
        ${`${bucketMinutes} minutes`}::interval
      ) as bucket
    )
    select
      b.bucket,
      count(r.id)                                              as requests,
      count(r.id) filter (where r.status <> 'SUCCESS')          as errors,
      count(r.id) filter (where r.cache_hit)                    as cache_hits,
      coalesce(sum(r.cost_usd) filter (where r.cost_known), 0)  as cost_usd,
      coalesce(
        percentile_disc(0.95) within group (order by r.latency_ms), 0
      )                                                         as p95
    from buckets b
    left join requests r
      on r.org_id = ${orgId}
     and r.created_at >= b.bucket
     and r.created_at <  b.bucket + ${`${bucketMinutes} minutes`}::interval
    group by b.bucket
    order by b.bucket
  `.execute(db);

  return rows.rows.map((r) => ({
    bucket: new Date(r.bucket).toISOString(),
    requests: Number(r.requests),
    errors: Number(r.errors),
    cacheHits: Number(r.cache_hits),
    costUsd: String(r.cost_usd),
    p95LatencyMs: Number(r.p95),
  }));
}

export interface ModelBreakdown {
  provider: string;
  model: string;
  requests: number;
  totalTokens: number;
  costUsd: string;
  costKnown: boolean;
  errorRate: number;
}

export async function byModel(
  db: Kysely<DB>, orgId: string, sinceHours = 24,
): Promise<ModelBreakdown[]> {
  const since = new Date(Date.now() - sinceHours * 3_600_000);
  const rows = await db
    .selectFrom('requests')
    .where('org_id', '=', orgId)
    .where('created_at', '>=', since)
    .groupBy(['provider', 'model'])
    .select([
      'provider', 'model',
      sql<string>`count(*)`.as('requests'),
      sql<string>`coalesce(sum(total_tokens), 0)`.as('total_tokens'),
      sql<string>`coalesce(sum(cost_usd) filter (where cost_known), 0)`.as('cost_usd'),
      sql<boolean>`bool_and(cost_known)`.as('all_priced'),
      sql<string>`count(*) filter (where status <> 'SUCCESS')`.as('errors'),
    ])
    .orderBy(sql`count(*)`, 'desc')
    .execute();

  return rows.map((r) => ({
    provider: r.provider,
    model: r.model,
    requests: Number(r.requests),
    totalTokens: Number(r.total_tokens),
    costUsd: String(r.cost_usd),
    costKnown: r.all_priced === true,
    errorRate: Number(r.requests) === 0 ? 0 : Number(r.errors) / Number(r.requests),
  }));
}

export interface RequestFilters {
  status?: string;
  model?: string;
  provider?: string;
  cacheHit?: boolean;
  projectId?: string;
  limit: number;
  /** Keyset cursor: ISO timestamp of the last row on the previous page. */
  before?: string;
}

export async function listRequests(
  db: Kysely<DB>, orgId: string, f: RequestFilters,
) {
  let q = db
    .selectFrom('requests')
    .leftJoin('projects', 'projects.id', 'requests.project_id')
    .where('requests.org_id', '=', orgId)
    .select([
      'requests.id', 'requests.created_at', 'requests.provider', 'requests.model',
      'requests.status', 'requests.status_code', 'requests.latency_ms',
      'requests.upstream_ms', 'requests.prompt_tokens', 'requests.completion_tokens',
      'requests.total_tokens', 'requests.cost_usd', 'requests.cost_known',
      'requests.cache_hit', 'requests.streamed', 'requests.retry_count',
      'requests.error_code', 'requests.project_id', 'projects.name as project_name',
    ])
    // Keyset pagination, not OFFSET: OFFSET makes the database walk and discard
    // every skipped row, so page 500 costs 500 pages of work. This uses the
    // (org_id, created_at DESC) index directly and is O(page size) at any depth.
    .orderBy('requests.created_at', 'desc')
    .limit(Math.min(f.limit, 200));

  if (f.before !== undefined) q = q.where('requests.created_at', '<', new Date(f.before));
  if (f.status !== undefined) q = q.where('requests.status', '=', f.status as never);
  if (f.model !== undefined) q = q.where('requests.model', '=', f.model);
  if (f.provider !== undefined) q = q.where('requests.provider', '=', f.provider);
  if (f.cacheHit !== undefined) q = q.where('requests.cache_hit', '=', f.cacheHit);
  if (f.projectId !== undefined) q = q.where('requests.project_id', '=', f.projectId);

  return q.execute();
}

export async function getRequest(db: Kysely<DB>, orgId: string, id: string) {
  return db
    .selectFrom('requests')
    .leftJoin('projects', 'projects.id', 'requests.project_id')
    .leftJoin('api_keys', 'api_keys.id', 'requests.api_key_id')
    .where('requests.org_id', '=', orgId)   // tenant predicate, always
    .where('requests.id', '=', id)
    .select([
      'requests.id', 'requests.created_at', 'requests.provider', 'requests.model',
      'requests.status', 'requests.status_code', 'requests.latency_ms',
      'requests.upstream_ms', 'requests.prompt_tokens', 'requests.completion_tokens',
      'requests.total_tokens', 'requests.cost_usd', 'requests.cost_known',
      'requests.cache_hit', 'requests.streamed', 'requests.retry_count',
      'requests.error_code', 'requests.error_message', 'requests.idempotency_key',
      'projects.name as project_name',
      'api_keys.name as api_key_name', 'api_keys.prefix as api_key_prefix',
    ])
    .executeTakeFirst();
}
