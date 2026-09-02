# ADR-005: Tenant-isolated response cache

**Status:** Accepted — 2026-09-02

## The threat this exists to prevent
Two tenants send an identical prompt. If the cache key is derived only from the
request body, tenant B receives a response generated for tenant A. That is a
cross-tenant data leak disguised as a performance win, and it is the most
dangerous bug this component can have.

## Key composition
`cache:v1:<org_id>:<project_id>:<sha256(canonical request)>`

`org_id` is the **first** component and is not optional — `cacheKey()` cannot be
called without a scope. Isolation is structural, not a filter someone might
forget. Project is included too, so a shared prompt in different projects of the
same org stays separate.

`v1` is a namespace version: changing what a cached entry contains means bumping
it, which invalidates everything without a migration or a flush.

## Determinism
`JSON.stringify` of the raw request object is **not** deterministic — property
order follows insertion order, so two structurally identical requests built in
different orders hash differently. Every field is serialised explicitly, in a
fixed order. There is a test for exactly this.

## What is cacheable
Only `temperature === 0`. A caller who asked for variety and receives identical
bytes every time has had their product silently broken by our optimisation.

## Streaming is not cached in V1
Reassembling a stream to cache it means buffering the whole response, which
defeats the point of streaming, and replaying it convincingly means storing
chunk boundaries and timing. Deferred, and the header says `BYPASS` rather than
`MISS` so the dashboard does not report a misleading miss rate.

## TTL and invalidation
TTL is configurable, default 300s — short enough that a model or prompt change
does not serve stale answers for long. `invalidateOrg()` uses `SCAN`, never
`KEYS`: `KEYS` blocks Redis's single thread for the whole scan, which would
stall every other tenant's rate-limit check at the same time.

## Cost accounting for a hit
A hit records `cost_usd = 0` with `cost_known = true`. Nothing was bought, and
that is genuinely different from not knowing what something cost.
