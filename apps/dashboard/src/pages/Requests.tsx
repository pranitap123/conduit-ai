import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type RequestDetail, type RequestRow } from '../lib/api';
import { formatCost, formatDateTime, formatMs, formatTime, STATUS_LABEL } from '../lib/format';
import { Button, Empty, ErrorState, Loading, Panel, Pill } from '../components/primitives';

const STATUSES = ['SUCCESS', 'UPSTREAM_ERROR', 'CLIENT_ERROR', 'RATE_LIMITED', 'TIMEOUT', 'CANCELLED'];

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'bad'> = {
  SUCCESS: 'ok', RATE_LIMITED: 'warn', CLIENT_ERROR: 'warn',
  UPSTREAM_ERROR: 'bad', TIMEOUT: 'bad', CANCELLED: 'warn',
};

export function Requests() {
  const [rows, setRows] = useState<RequestRow[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [model, setModel] = useState('');
  const [cacheOnly, setCacheOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const params = useCallback((before?: string): Record<string, string> => ({
    limit: '50', ...(status ? { status } : {}), ...(model ? { model } : {}), ...(cacheOnly ? { cacheHit: 'true' } : {}), ...(before ? { before } : {}),
  }), [status, model, cacheOnly]);

  const load = useCallback(() => {
    setError(null); setRows(null);
    api.requests(params()).then((r) => { setRows(r.data); setCursor(r.nextCursor); }).catch((e: Error) => setError(e.message));
  }, [params]);

  useEffect(load, [load]);

  const loadMore = (): void => {
    if (!cursor) return;
    api.requests(params(cursor)).then((r) => { setRows((prev) => [...(prev ?? []), ...r.data]); setCursor(r.nextCursor); }).catch((e: Error) => setError(e.message));
  };

  return (
    <div className="flex flex-col gap-6 pb-20">
      <header className="animate-in">
        <h1 className="t-page text-ink">Request traces</h1>
        <p className="t-body text-ink-soft mt-1.5">Inspect production LLM traffic telemetry.</p>
      </header>

      <div className="flex flex-wrap items-end gap-3 animate-in stagger-1 p-5 bg-surface border border-rule">
        <div className="flex flex-col gap-2">
          <span className="t-label">Outcome</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 px-3 bg-surface border border-rule text-[14px] text-ink outline-none focus-visible:border-accent transition-colors">
            <option value="">Any outcome</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <span className="t-label">Model</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Filter by model…" className="h-10 px-3 bg-surface border border-rule text-[14px] text-ink placeholder:text-ink-faint outline-none focus-visible:border-accent transition-colors" />
        </div>
        <label className="flex items-center gap-2.5 h-10 px-3 bg-surface border border-rule text-[14px] text-ink cursor-pointer">
          <input type="checkbox" checked={cacheOnly} onChange={(e) => setCacheOnly(e.target.checked)} className="accent-accent" />
          Cache hits only
        </label>
        {(status || model || cacheOnly) && (
          <Button onClick={() => { setStatus(''); setModel(''); setCacheOnly(false); }}>Reset filters</Button>
        )}
      </div>

      <div className="animate-in stagger-2">
        <Panel>
          {error !== null ? <ErrorState message={error} onRetry={load} />
            : rows === null ? <Loading rows={6} />
            : rows.length === 0 ? <Empty title="No traffic matches these filters" body="Adjust or reset the filters above to explore more traces." />
            : (
              <>
                <Table rows={rows} selectedId={selected} onSelect={setSelected} />
                {cursor !== null && (
                  <div className="p-4 border-t border-rule-soft flex justify-center">
                    <Button onClick={loadMore}>Load older traces</Button>
                  </div>
                )}
              </>
            )}
        </Panel>
      </div>
      {selected !== null && <TraceInspector id={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Table({ rows, selectedId, onSelect }: { rows: RequestRow[]; selectedId: string | null; onSelect: (id: string) => void; }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[14px] border-collapse whitespace-nowrap">
        <thead>
          <tr className="border-b border-rule-soft">
            <th scope="col" className="t-section px-5 py-3">Time</th>
            <th scope="col" className="t-section px-5 py-3">Status</th>
            <th scope="col" className="t-section px-5 py-3">Model</th>
            <th scope="col" className="t-section px-5 py-3 text-right hidden sm:table-cell">Latency</th>
            <th scope="col" className="t-section px-5 py-3 text-right hidden md:table-cell">Tokens</th>
            <th scope="col" className="t-section px-5 py-3 text-right">Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isSelected = r.id === selectedId;
            return (
              <tr
                key={r.id} onClick={() => onSelect(r.id)} data-request-row={r.id} tabIndex={0}
                className={`border-b border-rule-soft last:border-0 cursor-pointer transition-colors duration-150 outline-none border-l-2 ${
                  isSelected ? 'bg-accent-soft border-l-accent' : 'hover:bg-surface-2 border-l-transparent'
                }`}
              >
                <td className="px-5 py-3.5 text-ink-soft figure">{formatTime(r.created_at)}</td>
                <td className="px-5 py-3.5">
                  <span className="inline-flex items-center gap-1.5">
                    <Pill tone={STATUS_TONE[r.status] ?? 'bad'}>{STATUS_LABEL[r.status] ?? r.status}</Pill>
                    {r.cache_hit && <Pill tone="info">Cached</Pill>}
                  </span>
                </td>
                <td className="px-5 py-3.5 font-medium text-ink figure">{r.model}</td>
                <td className="px-5 py-3.5 text-right hidden sm:table-cell text-ink-soft figure">{formatMs(r.latency_ms)}</td>
                <td className="px-5 py-3.5 text-right hidden md:table-cell text-ink-soft figure">{r.total_tokens ?? '—'}</td>
                <td className="px-5 py-3.5 text-right font-medium text-ink figure">{formatCost(r.cost_usd, r.cost_known)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TraceInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<RequestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => { api.request(id).then(setData).catch((e: Error) => setError(e.message)); }, [id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    panelRef.current?.focus();
    return () => { document.querySelector<HTMLElement>(`[data-request-row="${id}"]`)?.focus(); };
  }, [id]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Trace inspector">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div ref={panelRef} tabIndex={-1} className="relative w-full max-w-lg h-full bg-surface border-l border-rule drawer-enter overflow-y-auto outline-none flex flex-col">
        <header className="sticky top-0 z-10 bg-surface border-b border-rule px-6 py-5 flex items-center justify-between">
          <div>
            <h2 className="text-[17px] font-semibold text-ink">Trace inspector</h2>
            <p className="t-meta mt-1 figure">{id}</p>
          </div>
          <div className="shrink-0"><Button onClick={onClose}>Close</Button></div>
        </header>

        <div className="p-6 flex-1">
          {error !== null ? <ErrorState message={error} /> : data === null ? <Loading rows={8} /> : (
            <div className="flex flex-col gap-8">
              <Section title="Routing & status">
                <Row label="Outcome">
                  <Pill tone={STATUS_TONE[data.status] ?? 'bad'}>{STATUS_LABEL[data.status] ?? data.status} (HTTP {data.status_code})</Pill>
                </Row>
                <Row label="Timestamp"><span className="figure text-ink">{formatDateTime(data.created_at)}</span></Row>
                <Row label="Provider / model"><span className="figure text-ink">{data.provider} <span className="text-ink-faint mx-1.5">/</span> {data.model}</span></Row>
                <Row label="API key">{data.api_key_name ?? 'Deleted key'} {data.api_key_prefix !== null && <span className="figure text-ink-soft ml-2">(tg_live_{data.api_key_prefix}…)</span>}</Row>
              </Section>

              <Section title="Performance & latency">
                <Row label="Total gateway time"><span className="figure text-[17px] text-ink">{formatMs(data.latency_ms)}</span></Row>
                {data.upstream_ms !== null && (
                  <Row label="Upstream provider"><span className="figure text-ink-soft">{formatMs(data.upstream_ms)}</span></Row>
                )}
                {data.upstream_ms !== null && (
                  <Row label="Conduit overhead"><span className="figure text-accent font-medium">{formatMs(data.latency_ms - data.upstream_ms)}</span></Row>
                )}
              </Section>

              <Section title="Token economics">
                <Row label="Input tokens"><span className="figure text-ink">{data.prompt_tokens ?? '—'}</span></Row>
                <Row label="Output tokens"><span className="figure text-ink">{data.completion_tokens ?? '—'}</span></Row>
                <Row label="Total billed"><span className="figure text-cost font-semibold">{data.cost_known ? formatCost(data.cost_usd) : 'Unpriced'}</span></Row>
              </Section>

              <Section title="Gateway operations">
                <Row label="Cache state">{data.cache_hit ? <Pill tone="info">Hit</Pill> : 'Miss'}</Row>
                <Row label="Streaming">{data.streamed ? 'Yes' : 'No'}</Row>
                <Row label="Retry count">{data.retry_count} {data.retry_count > 0 && <span className="text-ink-soft ml-2">(billed once)</span>}</Row>
              </Section>

              {data.error_code !== null && (
                <div className="p-5 bg-error-soft border border-rule">
                  <h4 className="text-error font-semibold mb-2 text-[15px]">Upstream error {data.error_code}</h4>
                  <p className="text-[14px] text-ink-soft figure whitespace-pre-wrap">{data.error_message}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="t-label border-b border-rule-soft pb-2.5 mb-4">{title}</h3>
      <dl className="flex flex-col gap-3.5">{children}</dl>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-4 items-center">
      <dt className="text-[14px] text-ink-soft font-medium">{label}</dt>
      <dd className="text-[14px] min-w-0">{children}</dd>
    </div>
  );
}