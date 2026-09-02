# Architecture

## What this is
A proxy between applications and language-model providers. Applications send
OpenAI-format requests to Tollgate instead of the provider; Tollgate
authenticates them, enforces limits, serves what it can from cache, forwards the
rest, and records what each request cost.

The model is the payload. The infrastructure around it is the product.

## Request lifecycle

```
POST /v1/chat/completions
  │
  ├─ 1. authenticate    parse key → prefix lookup (indexed) → constant-time
  │                     hash compare → revoked? expired? → {orgId, projectId, keyId}
  │                     failure → 401, identical body for every reason
  │
  ├─ 2. validate        zod: model, messages, max_tokens, temperature, stream
  │                     failure → 400
  │
  ├─ 2b. idempotency    key present? → look up a stored response for this org
  │                     hit → return original bytes, no new ledger row, no charge
  │
  ├─ 3. rate limit      one atomic Redis EVALSHA, sliding-window counter,
  │                     subject = key:<apiKeyId>
  │                     refused → 429 + Retry-After, LEDGER ROW WRITTEN
  │
  ├─ 4. route           registry resolves model → provider, or 404 + ledger row
  │
  ├─ 5. cache           temperature 0 only, key = org:project:sha256(canonical)
  │                     hit → response + ledger row with cost known-zero
  │
  ├─ 6. upstream        AbortController: timeout AND client-disconnect cancel
  │                     ├─ non-streamed → await, cache, ledger, respond
  │                     └─ streamed → SSE passthrough; headers are committed on
  │                        the first byte, so a later failure emits an SSE error
  │                        event rather than an HTTP status
  │
  └─ 7. ledger          exactly one row, on every path above
```

**The invariant:** every request that authenticates produces exactly one
`requests` row. Successes, 429s, 404s, timeouts and provider failures all count.
A ledger that records only successes disagrees with the provider invoice, which
defeats the product.

## Components

| Path | Responsibility |
|---|---|
| `config/env.ts` | Fail-fast config. Missing var crashes before the port opens |
| `db/` | Kysely client, typed schema, forward-only SQL migrator |
| `auth/` | API key generation, hashing, verification; scrypt passwords |
| `providers/` | Provider interface, mock, OpenAI-compatible adapter, registry |
| `limits/` | Redis sliding-window limiter (Lua) |
| `cache/` | Tenant-scoped response cache |
| `billing/` | Exact-decimal cost engine, versioned pricing lookup |
| `gateway/` | The proxy route, usage ledger writes, idempotent replay |
| `dashboard/` | Session auth, RBAC, tenant-scoped analytics queries |
| `demo/` | Synthetic traffic generator |
| `routes/static.ts` | Serves the built dashboard in production |

Modular monolith, one process. ADR-001 explains why, and what it costs.

## Data model
Seven tables. `organizations → projects → api_keys → requests`, plus `users`,
`memberships` and `model_pricing`. `org_id` is denormalised onto `requests` so
the tenant predicate sits on the table being queried. Money is `NUMERIC(20,10)`.
NULL usage is distinct from zero usage. ADR-002.

## Where state lives
- **Postgres** — the ledger, tenancy, pricing. The only durable store.
- **Redis** — rate-limit counters and the response cache. Both are derived: a
  full Redis flush costs a cold cache and a reset limit window, nothing more.
- **Process memory** — nothing that matters. Any instance can serve any request.

## Reading order
`gateway/routes.ts` first — it is the spine, and every other module is called
from it. Then `db/migrations/001_init.sql`, then the ADRs in numeric order.
