# Postmortem 001: JSONB silently broke idempotent replay

**Date:** 2026-09-02 · **Severity:** would have been high in production · **Caught by:** tests, before deploy

## What happened
`requests.response_body` was declared `JSONB` to store the original response for
idempotent replay. Two tests failed:

1. A retried request received a body that was semantically identical to the
   original but had its JSON keys in a different order.
2. Five concurrent retries of one key produced two distinct response strings —
   the insert winner returned its own in-memory object, the losers returned the
   round-tripped database copy.

## Root cause
`JSONB` is a **normalised** binary representation. Postgres decomposes the
document on write and reserialises it on read, which reorders object keys,
strips insignificant whitespace and collapses duplicate keys. `JSON` stores the
source text verbatim.

The idempotency contract is not "you get an equivalent response". It is "you get
the same response". A client that hashes response bodies, verifies a signature
over them, or diffs them across a retry would have seen the two as different.

## Why it was not obvious
Every reasonable instinct says "use JSONB, it is the better type". That is true
whenever you query *into* the document. We never do — this column is written
once and read back whole. The one advantage JSONB offers was irrelevant here,
and its one behavioural difference was fatal.

## Fix
Migration `003`: `ALTER COLUMN response_body TYPE JSON`. Forward-only, no data
loss, because the existing values were already valid JSON text.

## What would have caught this in production
Nothing we had. The failure is invisible to a human reading the response and
invisible to any test asserting on parsed objects rather than raw bytes. The
test that caught it compares `response.body` as a string, deliberately.

## Generalisation
When a column exists to reproduce bytes exactly — signatures, webhook payloads,
audit copies, idempotent replays — a normalising type is a bug. Ask whether the
column is *data you query* or *bytes you must return*.
