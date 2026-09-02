-- JSONB normalises: it reorders object keys, strips whitespace and collapses
-- duplicate keys. That is exactly wrong for an idempotent replay, whose
-- contract is that a retry receives the SAME BYTES as the original response.
--
-- JSON stores the original text verbatim. We never query inside this column,
-- so we give up nothing by switching. See docs/postmortems/001.
ALTER TABLE requests
  ALTER COLUMN response_body TYPE JSON USING response_body::text::json;

COMMENT ON COLUMN requests.response_body IS
  'Verbatim response text for idempotent replay. JSON, not JSONB: byte fidelity matters, queryability does not.';
