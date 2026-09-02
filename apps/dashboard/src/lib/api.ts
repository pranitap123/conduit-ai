/**
 * All server access goes through this module.
 *
 * `credentials: 'include'` on every call because the session lives in an
 * HttpOnly cookie — JavaScript cannot read or attach it manually, which is the
 * point: an XSS bug cannot exfiltrate it.
 */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
    ...init,
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message !== undefined) message = body.error.message;
    } catch { /* non-JSON error body; keep the generic message */ }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export interface Me { email: string; org: { id: string; name: string }; role: string }

export interface Overview {
  requests: number; errors: number; cacheHits: number; totalTokens: number;
  costUsd: string; unpricedRequests: number; p50LatencyMs: number; p95LatencyMs: number;
}

export interface Bucket {
  bucket: string; requests: number; errors: number;
  cacheHits: number; costUsd: string; p95LatencyMs: number;
}

export interface ModelRow {
  provider: string; model: string; requests: number;
  totalTokens: number; costUsd: string; costKnown: boolean; errorRate: number;
}

export interface RequestRow {
  id: string; created_at: string; provider: string; model: string;
  status: string; status_code: number; latency_ms: number; upstream_ms: number | null;
  prompt_tokens: number | null; completion_tokens: number | null; total_tokens: number | null;
  cost_usd: string | null; cost_known: boolean; cache_hit: boolean; streamed: boolean;
  retry_count: number; error_code: string | null; project_name: string | null;
}

export interface RequestDetail extends RequestRow {
  error_message: string | null; idempotency_key: string | null;
  api_key_name: string | null; api_key_prefix: string | null;
}

export interface ApiKeyRow {
  id: string; name: string; prefix: string; last4: string; created_at: string;
  revoked_at: string | null; expires_at: string | null; last_used_at: string | null;
  project_name: string;
}

export const api = {
  me: () => request<Me>('/api/me'),
  login: (email: string, password: string) =>
    request<{ ok: true }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  signup: (email: string, password: string, orgName: string) =>
    request<{ ok: true }>('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email, password, orgName }) }),
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),

  overview: (hours: number) => request<Overview>(`/api/overview?hours=${hours}`),
  timeseries: (hours: number) => request<Bucket[]>(`/api/timeseries?hours=${hours}`),
  models: (hours: number) => request<ModelRow[]>(`/api/models?hours=${hours}`),

  requests: (params: Record<string, string>) =>
    request<{ data: RequestRow[]; nextCursor: string | null }>(
      `/api/requests?${new URLSearchParams(params).toString()}`),
  request: (id: string) => request<RequestDetail>(`/api/requests/${id}`),

  keys: () => request<ApiKeyRow[]>('/api/keys'),
  createKey: (name: string) =>
    request<ApiKeyRow & { plaintext: string }>('/api/keys', { method: 'POST', body: JSON.stringify({ name }) }),
  revokeKey: (id: string) => request<{ ok: true }>(`/api/keys/${id}/revoke`, { method: 'POST' }),
};
