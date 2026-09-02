# Tollgate

An LLM gateway: a proxy that sits between applications and model providers,
and handles the things you actually need in production — authentication,
per-tenant quotas, usage metering, cost accounting, caching, and failover.

The model is the payload. The infrastructure around it is the product.

**Status: in development. Not production-ready. See the table below for what is
actually implemented — this table is the source of truth, not the prose above.**

## Implementation status

| Capability | Status | Verified by |
|---|---|---|
| Fail-fast env config | Built | boots and throws on missing vars |
| Structured logging with secret redaction | Built | redact list in `lib/logger.ts` |
| Provider interface + mock provider | Built | 3 tests |
| SQL schema + forward-only migrator | Built | applied against Postgres 16 |
| API-key generation, hashing, verification | Built | 10 tests |
| API-key revocation / expiry | Built | covered in the same suite |
| Cost engine (exact decimal) | Built | 7 tests inc. float-drift proof |
| Versioned model pricing | Built | 2 tests |
| Redis sliding-window rate limiting | Built | 5 tests inc. 200-way concurrency |
| Tenant-isolated response cache | Built | 9 tests inc. cross-tenant leak |
| Gateway proxy `/v1/chat/completions` | Built | 14 lifecycle tests |
| Usage ledger (success + failure paths) | Built | same suite |
| SSE streaming | Built (untested end-to-end) | provider-level only |
| Health / readiness endpoints | Liveness built, readiness stubbed | — |
| Dashboard user auth (login) | Not started | — |
| Authorization / RBAC | Schema only (`memberships.role`) | — |
| Real provider adapter (OpenAI/Anthropic) | Not started | — |
| Idempotency replay short-circuit | Index + lookup built, not wired into route | — |
| Provider failover | Not started (V2) | — |
| Synthetic traffic generator | Not started | — |
| Dashboard UI | Not started | — |
| Request explorer UI | Not started | — |
| Docker image for the app | Not started (compose has Postgres + Redis only) | — |
| Deployment | Not started | — |
| OpenTelemetry | Not started (V2) | — |
| BullMQ background jobs | Not started (V2) | — |

**Test suite: 48 passing.** Run `npm test` against a live Postgres and Redis.

## Running it

```bash
cp .env.example .env
docker compose up -d          # Postgres + Redis
npm install
npm run migrate -w gateway    # apply SQL migrations
npm run dev
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

- [ADR-001: Modular monolith](docs/decisions/ADR-001-modular-monolith.md)
- [ADR-002: Usage ledger data model](docs/decisions/ADR-002-data-model.md)
- [ADR-003: API key storage](docs/decisions/ADR-003-api-key-storage.md)
- [ADR-004: Rate limiting](docs/decisions/ADR-004-rate-limiting.md)
- [ADR-005: Response cache](docs/decisions/ADR-005-response-cache.md)

## A note on how this was built

The initial implementation was written with AI assistance. The ADRs record the
decisions and the rejected alternatives so the reasoning is auditable rather
than implied. Nothing in this README claims a capability the status table does
not mark as built.
