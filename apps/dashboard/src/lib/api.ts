async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const apiBase = import.meta.env.VITE_API_URL || '/api';  // ← ADD THIS LINE
  const url = `${apiBase}${path}`;  // ← CHANGE THIS LINE (was just `path`)
  
  const res = await fetch(url, {
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