# ADR-007: Dashboard sessions, tenant isolation and RBAC

**Status:** Accepted — 2026-09-02

## Isolation model: a required parameter, not a middleware

Every function in `src/dashboard/queries.ts` takes `orgId` as its **first
argument** and applies it as a `WHERE` clause. There is no query in that file
that can be called without a tenant.

*Rejected: a middleware that injects a tenant filter.* Works until someone adds
a route and forgets to register it, and the failure is silent — the query
returns more rows, not an error.

*Rejected: Postgres row-level security.* Genuinely the strongest option; the
database refuses cross-tenant reads even if the application is wrong. Rejected
for V1 because it requires `SET LOCAL` of a session variable on every pooled
connection, and a leaked or unreset variable is a subtle and dangerous failure.
This is the right V2 upgrade, and the tests already written would validate it.

**The org is never read from the URL or the request body.** It is resolved from
the session cookie to a `memberships` row on every request. If it came from a
path parameter, editing an id in the address bar would be a tenant escape.

## 404, not 403, for another tenant's resource
`403` confirms the id exists somewhere. `404` reveals nothing. Tested.

## Revocation is enforced in the UPDATE, not a prior SELECT
`UPDATE api_keys SET revoked_at = now() WHERE id = ? AND project_id IN (SELECT
id FROM projects WHERE org_id = ?)`. A read-then-write leaves a window between
the two statements; here the database enforces it in one atomic operation, and
`numUpdatedRows === 0` distinguishes "not yours" from "done" without a leak.

## Sessions: signed HMAC token in an HttpOnly cookie

`HMAC-SHA256(userId.expiry)`. 12-hour expiry.

*Rejected: JWT.* We need one claim and one expiry. A JWT adds an `alg` header
an attacker can try to set to `none`, plus a spec surface we do not use, plus a
dependency. Hand-rolled HMAC has no algorithm negotiation to confuse.

*Rejected: server-side sessions in Redis.* Revocation would be instant, which
is genuinely better. Rejected because a Redis outage would then sign everyone
out of the dashboard — and the dashboard is how you find out Redis is down.
Short expiry is the compromise.

**Known limitation:** a stolen token is valid until it expires. There is no
revocation list. Acceptable at this scale; documented rather than hidden.

## Cookie flags
- `HttpOnly` — JavaScript cannot read it, so an XSS bug cannot steal the session.
- `SameSite=Lax` — the browser will not attach it to cross-site POSTs, which is
  the CSRF defence for every state-changing route.
- `Secure` in production only, so local HTTP development still works.

CORS uses an origin **allowlist** with `credentials: true`. A wildcard origin
with credentials would let any website make authenticated requests as the user;
the browser blocks that combination, but the allowlist is the actual control.

## Login does not leak which emails are registered
Password verification runs against a dummy hash when the user does not exist, so
response timing is the same either way. **Signup does still leak**, returning
409 for a taken email — it cannot proceed otherwise. Recorded in
`docs/security.md` rather than pretended away.

## RBAC
Three roles on `memberships`. `MEMBER` is read-only; `ADMIN` and `OWNER` may
create and revoke keys. Checked in the route, not the query layer, because it is
an authorization decision about an action rather than a data scope.
