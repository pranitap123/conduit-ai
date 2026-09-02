# ADR-001: Modular monolith, not microservices

**Status:** Accepted — 2026-09-02

## Context
The gateway has several concerns that could each be a service: request
proxying, usage metering, rate limiting, analytics rollups, the dashboard API.
Splitting them is the reflexive "scalable" answer.

## Decision
One deployable Node process, internally split by module (`providers/`,
`billing/`, `gateway/`, `dashboard/`), with a second process later for
background work only if measurement justifies it.

## Consequences
**Gained.** One process to deploy, one log stream to correlate, one
transaction boundary. Recording a request and incrementing its usage counter
can be a single database transaction — as separate services that becomes a
distributed-transaction problem with no upside at this volume.

**Given up.** Modules cannot scale independently. If proxying becomes CPU-bound
while analytics stays idle, the whole process scales together. Accepted: the
proxy is I/O-bound (it waits on upstream providers), so this is unlikely to
bind first.

**Reversal cost.** Low, if module boundaries stay clean: no module reaches into
another's tables, and cross-module calls go through an exported function rather
than a shared import of internals. That discipline is what keeps extraction
cheap later.

## Alternatives rejected
- *Microservices from day one.* Adds network failure, versioning and
  distributed tracing to a system with one developer and no traffic. Cost is
  immediate; benefit is hypothetical.
- *Serverless functions.* Cold starts on a latency-sensitive proxy, and
  connection pooling to Postgres becomes a real problem.
