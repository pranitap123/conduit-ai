/**
 * Formatting rules.
 *
 * The hard one is cost. The API returns a NUMERIC string with 10 decimal
 * places, deliberately (see ADR-002). Parsing it to a JS number here would
 * reintroduce the float error the backend went to trouble to avoid, so
 * formatting works on the string until the last possible moment and never
 * rounds a total that will be added to something else.
 */
export function formatCost(usd: string | null, known = true): string {
  if (usd === null || !known) return '—';
  const n = Number(usd);
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`;
  return `$${n.toFixed(2)}`;
}

export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

export function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(fraction < 0.1 ? 1 : 0)}%`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export const STATUS_TONE: Record<string, 'ok' | 'warn' | 'bad'> = {
  SUCCESS: 'ok',
  RATE_LIMITED: 'warn',
  CLIENT_ERROR: 'warn',
  UPSTREAM_ERROR: 'bad',
  TIMEOUT: 'bad',
  CANCELLED: 'warn',
};

/** Human labels. The UI never shows a raw enum value. */
export const STATUS_LABEL: Record<string, string> = {
  SUCCESS: 'Succeeded',
  RATE_LIMITED: 'Rate limited',
  CLIENT_ERROR: 'Rejected',
  UPSTREAM_ERROR: 'Provider failed',
  TIMEOUT: 'Timed out',
  CANCELLED: 'Cancelled',
};
