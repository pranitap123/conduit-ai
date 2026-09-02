# Tollgate

An LLM gateway: a proxy that sits between applications and model providers,
and handles the things you actually need in production — authentication,
per-tenant quotas, usage metering, cost accounting, caching, and failover.

The model is the payload. The infrastructure around it is the product.

**Status: in development. Not production-ready. See the table below for what is
actually implemented — this table is the source of truth, not the prose above.**

## Implementation status

| Capability | Status |
|---|---|
| Fail-fast env config | Built |
| Structured logging with secret redaction | Built |
| Provider interface + mock provider | Built |
| Health / readiness endpoints | Liveness built, readiness stubbed |
| Database schema | Not started |
| API-key authentication | Not started |
| Multi-tenancy + isolation tests | Not started |
| Request proxying | Not started |
| Usage ledger | Not started |
| Cost engine | Not started |
| Rate limiting (Redis) | Not started |
| Response caching | Not started |
| Streaming | Not started |
| Real provider adapters | Not started |
| Synthetic traffic generator | Not started |
| Dashboard | Not started |
| Deployment | Not started |

## Running it

```bash
cp .env.example .env
docker compose up -d      # Postgres + Redis
npm install
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
