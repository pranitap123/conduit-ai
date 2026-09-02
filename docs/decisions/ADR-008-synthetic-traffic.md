# ADR-008: Synthetic traffic drives the real gateway

**Status:** Accepted — 2026-09-02

## Problem
A deployed dashboard with no traffic is an empty dashboard, and an empty
dashboard demonstrates nothing. This is the single largest presentation risk for
a developer-tool portfolio project.

## Decision
`src/demo/traffic.ts` sends real HTTP requests to the running gateway with a
real API key. Those requests pass through authentication, rate limiting,
caching, the provider and the ledger like any other traffic.

**It does not insert rows into `requests`.** Every number on the dashboard was
produced by the code being demonstrated. A cache hit on the dashboard is a hit
the cache actually served. A `RATE_LIMITED` row exists because the limiter
actually refused a request.

## Rejected: seeding the database directly
Faster and simpler. Rejected because it makes the dashboard a lie: the numbers
would prove the seed script works, not the gateway. A reviewer who checks would
find the ledger populated by something other than the request path, and every
other claim in the repo becomes suspect.

## Rejected: hardcoded numbers in the frontend
Same objection, worse.

## What is genuinely synthetic, and labelled as such
1. **The mock provider's responses.** It is a mock; that is its purpose.
2. **Mock model pricing** (`0.15`/`0.60` and `3.00`/`15.00` per Mtok). Invented,
   because the models are invented. **No real provider pricing ships in this
   repo** — an operator configures those from the provider's own pricing page.
   A wrong number committed here would silently produce a wrong bill.
3. **The prompt pool** — six realistic prompts, repeated so temperature-0
   requests genuinely collide in the cache.

## Traffic mix
Weighted to exercise every state the dashboard can render: successes, a
retryable 503, a permanent 400, an unpriced model, streamed requests, and enough
concurrency to trip the rate limiter. About a third of requests use
temperature 0 so cache-hit rate is meaningful rather than zero.

Mock latency is randomised around a per-model base so p50 and p95 differ; a
constant latency would make the percentile chart a flat line and hide whether
the percentile query is even correct.
