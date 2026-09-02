import { useCallback, useEffect, useState } from 'react';
import { api, type RequestDetail, type RequestRow } from '../lib/api';
import {
  formatCost, formatDateTime, formatMs, formatTime, STATUS_LABEL, STATUS_TONE,
} from '../lib/format';
import { Button, Empty, ErrorState, Loading, Panel, Pill } from '../components/primitives';

const STATUSES = ['SUCCESS', 'UPSTREAM_ERROR', 'CLIENT_ERROR', 'RATE_LIMITED', 'TIMEOUT', 'CANCELLED'];

export function Requests() {
  const [rows, setRows] = useState<RequestRow[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [model, setModel] = useState('');
  const [cacheOnly, setCacheOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const params = useCallback((before?: string): Record<string, string> => ({
    limit: '50',
    ...(status === '' ? {} : { status }),
    ...(model === '' ? {} : { model }),
    ...(cacheOnly ? { cacheHit: 'true' } : {}),
    ...(before === undefined ? {} : { before }),
  }), [status, model, cacheOnly]);

  const load = useCallback(() => {
    setError(null); setRows(null);
    api.requests(params())
      .then((r) => { setRows(r.data); setCursor(r.nextCursor); })
      .catch((e: Error) => setError(e.message));
  }, [params]);

  useEffect(load, [load]);

  // Keyset pagination: the cursor is the last row's timestamp, so page 50 costs
  // the same as page 1. OFFSET would make the database walk everything skipped.
  const loadMore = (): void => {
    if (cursor === null) return;
    api.requests(params(cursor))
      .then((r) => { setRows((prev) => [...(prev ?? []), ...r.data]); setCursor(r.nextCursor); })
      .catch((e: Error) => setError(e.message));
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[20px] font-semibold tracking-tight">Requests</h1>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] text-ink-soft">Outcome</span>
          <select
            value={status} onChange={(e) => setStatus(e.target.value)}
            className="h-8 px-2 bg-surface border border-rule text-[13px] text-ink"
          >
            <option value="">Any outcome</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] text-ink-soft">Model</span>
          <input
            value={model} onChange={(e) => setModel(e.target.value)} placeholder="Any model"
            className="h-8 px-2 bg-surface border border-rule text-[13px] text-ink placeholder:text-ink-faint"
          />
        </label>

        <label className="flex items-center gap-2 h-8 px-2 border border-rule bg-surface text-[13px] text-ink-soft cursor-pointer">
          <input type="checkbox" checked={cacheOnly} onChange={(e) => setCacheOnly(e.target.checked)} />
          Cache hits only
        </label>

        {(status !== '' || model !== '' || cacheOnly) && (
          <Button onClick={() => { setStatus(''); setModel(''); setCacheOnly(false); }}>
            Clear filters
          </Button>
        )}
      </div>

      <Panel>
        {error !== null ? <ErrorState message={error} onRetry={load} />
          : rows === null ? <Loading rows={6} />
          : rows.length === 0 ? (
            <Empty
              title="No requests match these filters"
              body="Clear the filters, or widen them, to see more traffic."
            />
          ) : (
            <>
              <Table rows={rows} onSelect={setSelected} />
              {cursor !== null && (
                <div className="p-3 border-t border-rule-soft flex justify-center">
                  <Button onClick={loadMore}>Load older requests</Button>
                </div>
              )}
            </>
          )}
      </Panel>

      {selected !== null && <Detail id={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Table({ rows, onSelect }: { rows: RequestRow[]; onSelect: (id: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <caption className="sr-only">Recent requests. Select a row to see its detail.</caption>
        <thead>
          <tr className="text-ink-soft border-b border-rule-soft">
            <th scope="col" className="text-left font-medium px-3 py-2">Time</th>
            <th scope="col" className="text-left font-medium px-3 py-2">Outcome</th>
            <th scope="col" className="text-left font-medium px-3 py-2">Model</th>
            <th scope="col" className="text-right font-medium px-3 py-2 hidden sm:table-cell">Latency</th>
            <th scope="col" className="text-right font-medium px-3 py-2 hidden md:table-cell">Tokens</th>
            <th scope="col" className="text-right font-medium px-3 py-2">Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              onClick={() => onSelect(r.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(r.id); } }}
              tabIndex={0} role="button"
              className="border-b border-rule-soft last:border-0 cursor-pointer hover:bg-surface-2 focus:bg-surface-2"
            >
              <td className="px-3 py-2 figure text-ink-soft whitespace-nowrap">{formatTime(r.created_at)}</td>
              <td className="px-3 py-2">
                <span className="flex items-center gap-1.5">
                  <Pill tone={STATUS_TONE[r.status] ?? 'warn'}>{STATUS_LABEL[r.status] ?? r.status}</Pill>
                  {r.cache_hit && <Pill tone="info">Cached</Pill>}
                  {r.streamed && <Pill tone="info">Stream</Pill>}
                </span>
              </td>
              <td className="px-3 py-2 whitespace-nowrap">{r.model}</td>
              <td className="px-3 py-2 text-right figure hidden sm:table-cell">{formatMs(r.latency_ms)}</td>
              <td className="px-3 py-2 text-right figure hidden md:table-cell">
                {r.total_tokens ?? <span className="text-ink-faint" title="Provider reported no usage">—</span>}
              </td>
              <td className="px-3 py-2 text-right figure">{formatCost(r.cost_usd, r.cost_known)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<RequestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.request(id).then(setData).catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Request detail">
      <button className="absolute inset-0 bg-ink/20" onClick={onClose} aria-label="Close detail" />
      <div className="relative w-full max-w-md bg-surface border-l border-rule overflow-y-auto enter">
        <header className="sticky top-0 bg-surface flex items-center justify-between h-12 px-4 border-b border-rule">
          <h2 className="text-[14px] font-semibold">Request detail</h2>
          <Button onClick={onClose}>Close</Button>
        </header>

        {error !== null ? <ErrorState message={error} />
          : data === null ? <Loading rows={8} />
          : (
            <dl className="text-[13px]">
              <Row label="Request ID"><span className="figure text-[12px] break-all">{data.id}</span></Row>
              <Row label="Time">{formatDateTime(data.created_at)}</Row>
              <Row label="Outcome">
                <Pill tone={STATUS_TONE[data.status] ?? 'warn'}>{STATUS_LABEL[data.status] ?? data.status}</Pill>
                <span className="ml-2 figure text-ink-soft">HTTP {data.status_code}</span>
              </Row>
              <Row label="Project">{data.project_name ?? '—'}</Row>
              <Row label="API key">
                {data.api_key_name ?? 'Deleted key'}
                {data.api_key_prefix !== null && (
                  <span className="ml-2 figure text-[12px] text-ink-faint">tg_live_{data.api_key_prefix}…</span>
                )}
              </Row>
              <Row label="Provider">{data.provider}</Row>
              <Row label="Model">{data.model}</Row>

              <Row label="Total time"><span className="figure">{formatMs(data.latency_ms)}</span></Row>
              <Row label="Upstream time">
                <span className="figure">
                  {data.upstream_ms === null ? '—' : formatMs(data.upstream_ms)}
                </span>
                {data.upstream_ms !== null && (
                  <span className="ml-2 text-[12px] text-ink-faint">
                    {formatMs(data.latency_ms - data.upstream_ms)} in the gateway
                  </span>
                )}
              </Row>

              <Row label="Prompt tokens"><Tokens n={data.prompt_tokens} /></Row>
              <Row label="Completion tokens"><Tokens n={data.completion_tokens} /></Row>
              <Row label="Cost">
                {data.cost_known
                  ? <span className="figure">{formatCost(data.cost_usd)}</span>
                  : <span className="text-ink-faint">Not known — no pricing configured, or the provider reported no usage</span>}
              </Row>

              <Row label="Served from cache">{data.cache_hit ? 'Yes' : 'No'}</Row>
              <Row label="Streamed">{data.streamed ? 'Yes' : 'No'}</Row>
              {data.idempotency_key !== null && (
                <Row label="Idempotency key"><span className="figure text-[12px] break-all">{data.idempotency_key}</span></Row>
              )}
              {data.error_code !== null && (
                <Row label="Error">
                  <span className="text-error">{data.error_code}</span>
                  {data.error_message !== null && (
                    <p className="mt-1 text-[12px] text-ink-soft break-words">{data.error_message}</p>
                  )}
                </Row>
              )}
              <div className="px-4 py-3 text-[12px] text-ink-faint border-t border-rule-soft">
                Prompt and response bodies are not shown. The gateway does not retain them
                except where an idempotency key requires a replayable copy.
              </div>
            </dl>
          )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-2.5 border-b border-rule-soft grid grid-cols-[130px_1fr] gap-3 items-baseline">
      <dt className="text-ink-soft text-[12px]">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Tokens({ n }: { n: number | null }) {
  return n === null
    ? <span className="text-ink-faint" title="The provider did not report usage">Not reported</span>
    : <span className="figure">{n}</span>;
}
