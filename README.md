# Tollgate

An LLM gateway: a proxy that sits between applications and model providers,
handling authentication, per-tenant quotas, usage metering, exact cost
accounting, tenant-isolated caching, idempotent retries and streaming.

The model is the payload. The infrastructure around it is the product.

**Status: in development. Not production-ready. See the table below for what is
actually implemented — this table is the source of truth, not the prose above.**

## Implementation status

| Capability | Status | Verified by |
|---|---|---|
| Fail-fast env config | Built | boots; throws on missing vars |
| Structured logging with secret redaction | Built | redact list in `lib/logger.ts` |
| SQL schema + forward-only migrator | Built | 3 migrations applied to Postgres 16 |
| API-key generation, hashing, verification | Built | 10 tests |
| API-key revocation and expiry | Built | same suite + end-to-end |
| Cost engine (exact decimal) | Built | 7 tests inc. float-drift proof |
| Versioned model pricing | Built | 2 tests |
| Redis sliding-window rate limiting | Built | 5 tests inc. 200-way concurrency |
| Tenant-isolated response cache | Built | 9 tests inc. cross-tenant leak |
| Gateway proxy `/v1/chat/completions` | Built | 14 lifecycle tests |
| Usage ledger (success **and** failure paths) | Built | same suite |
| Idempotent replay + concurrent-insert race | Built | 5 tests |
| Mock provider with failure injection | Built | 3 tests |
| OpenAI-compatible adapter + SSE streaming | Built | 10 tests vs. a real HTTP server |
| Dashboard session auth (signup / login) | Built | 14 isolation tests |
| RBAC (OWNER / ADMIN / MEMBER) | Built | same suite |
| Cross-tenant isolation on every read and write | Built | same suite |
| Analytics API (overview, timeseries, by-model) | Built | same suite |
| Request explorer API + keyset pagination | Built | same suite |
| Synthetic traffic generator | Built | 900+ real requests through the gateway |
| Dashboard UI (overview, requests, keys, landing) | Built | manual; **no UI tests** |
| Docker image (multi-stage, non-root) | Built | `docker build` runs in CI |
| CI (typecheck, tests, builds, image) | Built | real Postgres + Redis services |
| Single-origin production serving | Built | booted and curl-verified |
| Deployment configuration (`fly.toml`) | Written | **never executed — no live URL** |
| Provider failover | Not started (V2) | — |
| OpenTelemetry tracing | Not started (V2) | — |
| BullMQ background jobs | Not started (V2) | — |
| Rate limiting on login and signup | Built | 1 test; fails open by design |
| Production secret validation (fail-fast) | Built | 23 tests inc. real process boot |
| PII redaction of prompt content | Not implemented; not claimed | — |
| Postgres row-level security | Not implemented (ADR-007 explains) | — |

**Test suite: 101 passing**, against a live Postgres and Redis. `npm test`.

## Running it

```bash
cp .env.example .env
docker compose up -d postgres redis
npm install
npm run migrate
npm run dev            # gateway on :3000
npm run dev:ui         # dashboard on :5173, proxied to the gateway
```

Fill the dashboard with real traffic — this sends actual HTTP through the
gateway, it does not insert rows:

```bash
npm run seed -- --count 400
# demo@tollgate.dev / demo-password-123
```

Or run the whole thing as one container:

```bash
docker compose --profile app up --build   # http://localhost:3000
```

```bash
curl localhost:3000/health
```

No API credentials are required. The mock provider keeps the whole system
runnable with an empty `.env`.

```bash
npm run typecheck
npm test
```

## Documentation

- [Architecture](docs/architecture.md) · [Security model](docs/security.md) · [Deployment](docs/deployment.md)
- [Postmortem 001: JSONB broke idempotent replay](docs/postmortems/001-jsonb-broke-idempotent-replay.md)

### Decision records
- [ADR-001: Modular monolith](docs/decisions/ADR-001-modular-monolith.md)
- [ADR-002: Usage ledger data model](docs/decisions/ADR-002-data-model.md)
- [ADR-003: API key storage](docs/decisions/ADR-003-api-key-storage.md)
- [ADR-004: Rate limiting](docs/decisions/ADR-004-rate-limiting.md)
- [ADR-005: Response cache](docs/decisions/ADR-005-response-cache.md)
- [ADR-006: Kysely over Prisma; hand-written provider adapter](docs/decisions/ADR-006-sql-layer-and-provider-adapter.md)
- [ADR-007: Dashboard auth, tenant isolation, RBAC](docs/decisions/ADR-007-dashboard-auth-and-isolation.md)
- [ADR-008: Synthetic traffic drives the real gateway](docs/decisions/ADR-008-synthetic-traffic.md)
- [ADR-009: Frontend architecture](docs/decisions/ADR-009-frontend-architecture.md)

## A note on how this was built

The initial implementation was written with AI assistance. The ADRs record the
decisions and the rejected alternatives so the reasoning is auditable rather
than implied. Nothing in this README claims a capability the status table does
not mark as built.
