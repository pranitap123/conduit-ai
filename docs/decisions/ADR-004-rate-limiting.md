# ADR-004: Sliding-window-counter rate limiting in Redis Lua

**Status:** Accepted — 2026-09-02

## Decision
One `EVALSHA` per check. The Lua script reads the current and previous window
counters, weights the previous one by its remaining overlap, and increments
only if the estimate is under the limit — all inside Redis's single-threaded
execution, so it is atomic.

## Why not GET / compare / SET in the application
Between the read and the write, a concurrent request reads the same value. Both
are admitted; the limit is exceeded. This is the classic read-modify-write race,
and on more than one gateway instance it happens constantly rather than rarely.

`src/limits/__tests__/rateLimiter.test.ts` fires 200 simultaneous checks against
a limit of 20 and asserts exactly 20 are admitted. That test fails against a
non-atomic implementation.

## Why not a fixed window
A caller sends the full quota at 11:59:59 and the full quota again at 12:00:00,
passing 2× the limit within one second. There is a test for the boundary.

## Why not a sorted-set sliding log
Exact, but stores one Redis member per request, so memory grows with traffic and
old members need trimming. Correct answer for a small quota over a long window;
wrong trade for an API quota measured in hundreds per minute.

## Why not a token bucket
Genuinely close. A token bucket models burst allowance more naturally and is
what you want if callers legitimately spike. It needs two values (tokens and
last-refill timestamp) and floating-point refill arithmetic in Lua.

Chosen against for V1 because the sliding counter is simpler to reason about and
to explain, and because the burst behaviour we want ("roughly N per minute, no
cliff at the boundary") is exactly what it provides. If callers start reporting
that legitimate bursts are refused, this is the thing to change.

## Known approximation
The previous window is assumed uniformly distributed. If a caller front-loads
all traffic into the first second of a window, the estimate slightly overcounts
later. Bounded, and it errs toward refusing — the safe direction.

## Failure mode
`enableOfflineQueue: false`, so a Redis outage makes `check()` throw rather than
silently admitting everything. **Currently that surfaces as a 500.** Whether the
gateway should fail open (serve traffic, lose enforcement) or fail closed
(refuse traffic) is a product decision that is not yet made. Recorded here so it
is not mistaken for an oversight.

## Subject
Keyed on `key:<apiKeyId>` — the finest-grained subject the caller controls, so
one noisy key cannot exhaust its whole org's quota. Per-project and per-org
tiers reuse the same `check()` with a different subject and cost.
