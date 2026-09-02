# ADR-006: Kysely over Prisma; hand-written OpenAI adapter over the SDK

**Status:** Accepted — 2026-09-02 · Supersedes the stack note in the original plan

## Part 1 — Kysely + node-postgres, not Prisma

**Decision.** Typed SQL via Kysely, hand-written forward-only `.sql` migrations,
`pg` for the driver.

**Why.** This product's read path is analytical: cost by model, p95 latency by
provider, request volume bucketed over time. Prisma's aggregation API does not
express window functions, `FILTER` clauses or time bucketing, so most dashboard
queries would land in `$queryRaw` anyway — the ORM would be carrying weight only
on the trivial writes.

Money is the second reason. `NUMERIC` must be read as a **string** to preserve
precision (ADR-002). Prisma's `Decimal` wrapper is workable but adds a type that
has to be marshalled at every boundary; with Kysely the string flows straight to
decimal.js where the arithmetic actually happens.

**Rejected: Prisma.** Better ergonomics for CRUD, excellent migration tooling,
and a much larger community — genuinely the safer default for most projects. It
loses here on aggregation expressiveness and on adding an abstraction over the
part of the system we most need to reason about precisely.

*Disclosure:* Prisma 6's engine binaries were also unreachable from the build
environment, and Prisma 8 was a release candidate with a restructured CLI. That
constraint prompted the review; the reasons above are why the decision stands.
The SQL schema translates directly if this is ever reversed.

**Rejected: raw `pg` with template strings.** No type safety between the schema
and the query, and column renames become runtime errors.

**Rejected: TypeORM / Sequelize.** Heavier decorator-based abstraction, weaker
TypeScript inference.

**Cost accepted.** No generated client, so `src/db/types.ts` is maintained by
hand alongside each migration. Drift is possible. Mitigated by the fact that
every table is exercised by an integration test against a real database.

## Part 2 — Hand-written OpenAI adapter, not the official SDK

**Decision.** `fetch` against the `/v1/chat/completions` wire format.

**Why.**
1. That format is a de-facto standard. Groq, Together, Fireworks, vLLM, Ollama
   and LiteLLM all speak it, so one adapter plus a `baseUrl` covers many
   providers — which is what makes the registry's failover story real in V2.
2. **The SDK retries internally.** Its retries would be invisible to our ledger,
   and a gateway whose entire purpose is accurate accounting cannot have an
   upstream call it did not record. Retry policy has to be ours.
3. Streaming needs manual SSE frame handling regardless, because a socket read
   can split a frame in half. The adapter test writes `"Hel"` and `"lo"` in two
   separate writes to prove reassembly works.

**Rejected: the official `openai` package.** Better maintained, handles edge
cases we have not met yet. Rejected for the retry-visibility reason above, which
is not negotiable for this product.

**Cost accepted.** We track the wire format ourselves. It is stable, and the
subset we use (messages, max_tokens, temperature, stream, stream_options) has
not changed in a long time.

## Part 3 — Where retryability is classified

In the adapter, not the gateway. Only the adapter knows this provider's dialect
of failure — that 429 and 5xx are transient while 400/401/403/404 can never
succeed. The gateway reads a boolean. Adding a provider that signals overload
with a non-standard code touches one file.
