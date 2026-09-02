# Security model

What is actually implemented, and what is not. Anything absent from this
document is absent from the code.

## Threat: a stolen API key
Keys are 256 bits from `randomBytes`. Only a SHA-256 digest is stored; the
plaintext is shown once at creation and is unrecoverable afterwards. Comparison
is constant-time. Revocation takes effect on the next request. ADR-003 explains
why the digest is SHA-256 rather than argon2.

**Not implemented:** automatic rotation, scoped permissions per key, IP
allowlisting.

## Threat: one tenant reading another's data
Every dashboard query takes `orgId` as a required first parameter. The org comes
from the session cookie resolved against `memberships`, never from a URL or
body. Cross-tenant reads return 404, not 403. Key revocation enforces the tenant
inside the `UPDATE` statement rather than a prior `SELECT`. Cache keys are
namespaced by org before anything else. Fourteen tests cover this. ADR-005,
ADR-007.

**Not implemented:** Postgres row-level security. It would make the database
refuse cross-tenant reads even if the application were wrong, and is the
strongest available upgrade. ADR-007 says why it is deferred.

## Threat: a deployed placeholder signing secret
Session cookies are HMAC-signed with `AUTH_SECRET`. A publicly known value there
lets anyone forge a session for any user in any organization, and nothing about
the running system looks wrong.

Production startup rejects a secret that is missing, a known placeholder, under
32 characters, or built from fewer than 8 distinct characters. The process exits
non-zero before opening a port. The development fallback is itself on the
rejected list, so it cannot become a production secret by omission. No default
exists in `docker-compose.yml`, `fly.toml`, or `.env.example`. Error messages
never echo the rejected value, since startup errors reach logs and crash
reports.

**Known limitation:** the entropy check is a heuristic, not a measurement. A
32-character secret from a weak generator with 8 distinct characters passes.

## Threat: session theft
Session tokens are HMAC-SHA256 over `userId.expiry`, in an `HttpOnly`,
`SameSite=Lax` cookie, `Secure` in production. HttpOnly means an XSS bug cannot
read the cookie; SameSite=Lax is the CSRF defence for state-changing routes.

**Known limitation:** sessions are stateless, so a stolen token is valid until
it expires (12 hours). There is no revocation list.

## Threat: credential stuffing and user enumeration
Passwords use scrypt. Login runs the hash against a dummy value when the user
does not exist, so response timing does not reveal registered emails.

`/api/auth/login` and `/api/auth/signup` are rate limited to 10 attempts per
minute per client address, using the same Redis limiter as the gateway. Keyed on
IP rather than email: an attacker walking a leaked credential list varies the
email every attempt, so an email-keyed limit would never fire.

This limiter **fails open** — the opposite of the gateway's. A Redis outage must
not lock every user out of the console they would use to diagnose the outage.
The gateway path fails closed because there the downside is one unmetered
request, not a locked door.

**Known gap:** signup returns 409 for a taken email, which leaks whether an
address is registered. It cannot proceed otherwise.

**Known gap:** IP keying penalises everyone behind one NAT, and `trustProxy` is
enabled in production, so a spoofed `X-Forwarded-For` would defeat it if the app
were ever exposed without a proxy in front of it.

## Threat: resource exhaustion
1 MB body limit, 200-message and 200,000-character caps per request, upstream
timeout, per-key rate limiting evaluated atomically in Redis, connection pool
capped at 20. Query `limit` is clamped to 200 regardless of what is requested.

**Known gap:** if Redis is unreachable, the limiter throws and the request
becomes a 500. Whether the gateway should fail open or closed is an unmade
product decision, recorded in ADR-004 rather than defaulted silently.

## Threat: secrets in logs
Pino redacts `authorization`, `x-api-key`, `apiKey` and `providerApiKey`.
Upstream error bodies are read for the ledger but **never** forwarded to the
client — they can contain the provider account's own identifiers. There is a
test asserting the upstream message does not appear in the response.

## Threat: prompt content retention
The gateway does not store prompts or responses, with one exception: a request
carrying an `Idempotency-Key` stores its response so the retry can be replayed.
Those rows have no retention policy yet, which is a real gap for anyone handling
regulated data.

**Not implemented:** PII redaction of prompt content. Nothing in this repo
claims it.

## Threat: prompt injection
Out of scope by design. The gateway does not interpret prompt content; it
forwards bytes and counts tokens. Injection is a risk for the application on
either side of it, not for the meter in between.

## Transport and headers
`@fastify/helmet` sets the standard headers. CSP is disabled for the API and not
yet configured for the dashboard — a real gap for a page that renders
user-supplied strings, mitigated by React escaping all of them.
