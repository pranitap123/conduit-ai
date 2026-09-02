-- Idempotent replay needs the original response body, not just the ledger row.
-- Stored on the request itself rather than a side table: it has the same
-- lifetime, the same tenant scope, and the same retention policy.
ALTER TABLE requests ADD COLUMN response_body JSONB;

-- Only requests that used an idempotency key ever need their body kept. A
-- partial index keeps the replay lookup cheap without indexing every row.
COMMENT ON COLUMN requests.response_body IS
  'Populated only for successful non-streamed requests sent with an Idempotency-Key.';
