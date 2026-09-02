# ADR-002: Usage ledger data model

**Status:** Accepted — 2026-09-02

## Money is NUMERIC(20,10), never a float
A 500-token request on a cheap model costs about $0.000015. IEEE-754 doubles
cannot represent those values exactly, and the error compounds when summed.
A dashboard that reports a monthly total disagreeing with the provider invoice
destroys the only reason this product exists.

`NUMERIC` is exact. node-postgres returns it as a **string**, and we leave it
that way — coercing to `number` on read would reintroduce the bug at the
boundary. Arithmetic uses decimal.js and rounds exactly once, at the end.

*Alternative rejected:* integer micro-dollars. Also exact and faster, but the
scale has to be chosen before you know the cheapest model you will ever price,
and every read needs a divide. NUMERIC pushes that problem into the database
where it belongs.

## `org_id` is denormalised onto `requests`
It is reachable via `project_id → projects.org_id`, so this is redundant.

*Why anyway:* every tenant-scoped read filters on org. Denormalising removes a
join from the hottest path, lets `(org_id, created_at DESC)` serve the request
explorer directly, and — the real reason — makes the isolation predicate a
column on the table you are already querying. An engineer writing a new query
cannot forget a filter that is right there.

*Cost:* the two can drift if a project is ever moved between orgs. Accepted:
projects are not movable, and if that changes it becomes a migration, not a
silent inconsistency.

## Failures are recorded, not just successes
A request that 429s consumed capacity. A request that fails after the provider
answered still cost money. `status` is an enum with six values so the ledger
distinguishes rate-limited from timed-out from upstream-failed.

## NULL usage is not zero usage
`prompt_tokens`, `completion_tokens` and `cost_usd` are nullable, and
`cost_known` is a separate boolean. Three distinct states must stay distinct:

| Situation | tokens | cost_usd | cost_known |
|---|---|---|---|
| Normal priced request | set | set | true |
| Cache hit — nothing bought | 0 | 0 | true |
| Provider reported no usage, or stream died early | NULL | NULL | false |
| Model has no pricing row configured | set | NULL | false |

Collapsing any of these into `0.00` makes an unknown cost look free.

## Deletion behaviour
- `projects`, `api_keys` → `ON DELETE CASCADE` from their parent. A deleted org
  should not leave orphaned keys that still authenticate.
- `requests.api_key_id` → `ON DELETE SET NULL`. **Never cascade.** Deleting a
  key must not delete the billing history that key generated.

## Idempotency uses a partial unique index
`CREATE UNIQUE INDEX ... WHERE idempotency_key IS NOT NULL`. A plain
`UNIQUE (org_id, idempotency_key)` would permit unlimited NULL rows anyway
(NULLs are distinct in Postgres) while still indexing every one of them.
Scoped to org because two tenants may legitimately choose the same key string.
