# ADR-003: API key storage — SHA-256, plus a prefix column

**Status:** Accepted — 2026-09-02

## Format
`tg_live_<44-char base64url>` from 32 CSPRNG bytes (256 bits).
Stored: `prefix` (first 12 chars of the secret), `key_hash` (SHA-256 hex),
`last4`. The plaintext is returned once and is then unrecoverable.

## SHA-256, not bcrypt or argon2
This looks wrong and is the most likely thing to be challenged, so:

Slow password hashes exist to make **guessing** expensive. That matters when
the secret is drawn from a small, human-chosen distribution. This key is 256
random bits — there is no dictionary, and a brute-force search is infeasible
regardless of how fast the hash is. The slow hash buys nothing here.

It would however cost something real: argon2 tuned to any sensible work factor
adds tens of milliseconds to **every** proxied request, on a service whose
entire value proposition is adding minimal latency.

Dashboard user passwords use scrypt, because those genuinely are low-entropy.
Different threat, different tool.

*Alternative rejected:* HMAC-SHA256 with a server-side pepper. Slightly better —
a leaked database alone would not permit offline verification. Rejected for V1
because it adds a secret that must be rotated in lockstep with every stored
hash, and the marginal gain over 256 bits of entropy is small. Worth revisiting.

## Why a `prefix` column exists
Without it, verifying a key means loading every hash and comparing — O(number
of keys) per request. Because the hash is of the whole key, you cannot index a
lookup on it without knowing the key first (which you do — so actually you
*could* index `key_hash` directly, and we do).

The prefix earns its place for the second reason: it is the **displayable**
handle. The UI, the logs and the request explorer all need to identify a key a
human can recognise without ever holding the secret. Indexing it also gives a
cheap existence check before the constant-time compare.

The prefix is not a secret and grants nothing on its own — there is a test that
forges a key with a valid prefix and a wrong body, and it is rejected.

## Comparison is constant-time
Both sides are already digests, so the leak is small, but `timingSafeEqual` is
free. A `===` on hex strings short-circuits at the first differing character
and leaks the match length through timing.

## Failures are indistinguishable to the caller
Malformed, unknown, revoked and expired all return the same 401 body. Telling
a caller "that key is revoked" confirms the key is real, which helps only an
attacker. The specific reason goes to the logs.
