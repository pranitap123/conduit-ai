-- Tollgate initial schema. Reasoning: docs/decisions/ADR-002.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------------ tenancy

CREATE TABLE organizations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE role AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- A user's access to an org is a row here and nowhere else, so every
-- authorization check has exactly one source of truth.
CREATE TABLE memberships (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role    role NOT NULL DEFAULT 'MEMBER',
  UNIQUE (user_id, org_id)
);
CREATE INDEX memberships_org_id_idx ON memberships (org_id);

CREATE TABLE projects (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Per-org, not global: two orgs may both have a project called "backend".
  UNIQUE (org_id, slug)
);

-- ----------------------------------------------------------------- api keys

-- The raw secret is never stored. ADR-003 explains why the digest is SHA-256
-- rather than bcrypt/argon2, and what prefix is actually for.
CREATE TABLE api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  -- Public, non-secret lookup handle. Unique + indexed so authentication is
  -- one indexed row read, never a scan-and-compare over every hash.
  prefix       TEXT NOT NULL UNIQUE,
  key_hash     TEXT NOT NULL UNIQUE,
  -- Shown in the UI so a human can recognise a key they can never see again.
  last4        TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  -- Written off the hot path; approximate by design.
  last_used_at TIMESTAMPTZ
);
CREATE INDEX api_keys_project_id_idx ON api_keys (project_id);

-- ------------------------------------------------------------------ traffic

CREATE TYPE request_status AS ENUM (
  'SUCCESS', 'UPSTREAM_ERROR', 'CLIENT_ERROR', 'RATE_LIMITED', 'TIMEOUT', 'CANCELLED'
);

-- Append-only usage ledger. One row per request that reached the gateway,
-- including failures: a failed request still consumed capacity, and a request
-- that failed after the provider answered still cost money upstream.
CREATE TABLE requests (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Denormalised from projects. Every tenant-scoped read filters on org_id, so
  -- carrying it here removes a join from the hottest path and makes the
  -- isolation predicate impossible to forget. ADR-002.
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- Nullable + SET NULL, never CASCADE: deleting a key must not delete the
  -- billing history that key generated.
  api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,

  provider    TEXT NOT NULL,
  model       TEXT NOT NULL,
  status      request_status NOT NULL,
  status_code INTEGER NOT NULL,

  latency_ms  INTEGER NOT NULL,
  upstream_ms INTEGER,

  -- NULL means "the provider did not report usage", which is NOT zero.
  -- Every aggregate over these columns must decide which it means.
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  total_tokens      INTEGER,

  -- NUMERIC, exact. Never a float: see ADR-002.
  cost_usd   NUMERIC(20, 10),
  -- FALSE when no pricing row matched, so the dashboard reports "unpriced"
  -- instead of silently reporting $0.00.
  cost_known BOOLEAN NOT NULL DEFAULT FALSE,

  cache_hit   BOOLEAN NOT NULL DEFAULT FALSE,
  streamed    BOOLEAN NOT NULL DEFAULT FALSE,
  retry_count INTEGER NOT NULL DEFAULT 0,

  error_code    TEXT,
  error_message TEXT,

  idempotency_key TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial unique index, not a plain UNIQUE (org_id, idempotency_key): NULLs are
-- distinct in Postgres, so a plain constraint would permit unlimited NULL rows
-- but also index them for nothing. This indexes only the rows that use the key.
CREATE UNIQUE INDEX requests_idempotency_idx
  ON requests (org_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- The request explorer's default view: one org, newest first.
CREATE INDEX requests_org_created_idx ON requests (org_id, created_at DESC);
CREATE INDEX requests_project_created_idx ON requests (project_id, created_at DESC);
-- "cost by model" / "errors by model" without a sequential scan.
CREATE INDEX requests_org_model_created_idx ON requests (org_id, model, created_at DESC);

-- ------------------------------------------------------------------ pricing

-- Pricing is data, not code: adding a model must not require a deploy.
-- Rows are versioned by effective_from so a historical request keeps the price
-- that applied when it ran.
CREATE TABLE model_pricing (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider               TEXT NOT NULL,
  model                  TEXT NOT NULL,
  -- USD per 1,000,000 tokens.
  input_price_per_mtok   NUMERIC(20, 10) NOT NULL,
  output_price_per_mtok  NUMERIC(20, 10) NOT NULL,
  effective_from         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, model, effective_from)
);
CREATE INDEX model_pricing_lookup_idx
  ON model_pricing (provider, model, effective_from DESC);
