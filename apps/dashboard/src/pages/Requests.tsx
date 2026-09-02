import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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
      <div>
        <h1 className="t-page">Requests</h1>
        <p className="mt-1 t-meta">
          Every request the gateway has recorded. Select a row for its full telemetry.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1.5">
          <span className="t-label">Outcome</span>
          <select
            value={status} onChange={(e) => setStatus(e.target.value)}
            className="h-8 px-2 bg-surface border border-rule text-[13px] text-ink"
          >
            <option value="">Any outcome</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="t-label">Model</span>
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
              <Table rows={rows} selectedId={selected} onSelect={setSelected} />
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

function Table({ rows, selectedId, onSelect }: {
  rows: RequestRow[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <caption className="sr-only">Recent requests. Select a row to see its detail.</caption>
        <thead>
          <tr className="border-b border-rule-soft">
            <th scope="col" className="text-left t-section px-3 py-2.5">Time</th>
            <th scope="col" className="text-left t-section px-3 py-2.5">Outcome</th>
            <th scope="col" className="text-left t-section px-3 py-2.5">Model</th>
            <th scope="col" className="text-right t-section px-3 py-2.5 hidden sm:table-cell">Latency</th>
            <th scope="col" className="text-right t-section px-3 py-2.5 hidden md:table-cell">Tokens</th>
            <th scope="col" className="text-right t-section px-3 py-2.5">Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isSelected = r.id === selectedId;
            return (
              <tr
                key={r.id}
                onClick={() => onSelect(r.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(r.id); } }}
                tabIndex={0} role="button" aria-pressed={isSelected}
                data-request-row={r.id}
                /*
                 * The selected row keeps a leading accent rule while the drawer
                 * is open, so the reader never loses their place in a fifty-row
                 * table behind a panel that covers the right third of it.
                 */
                className={`relative border-b border-rule-soft last:border-0 cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-surface-2 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[2px] before:bg-accent'
                    : 'hover:bg-surface-2 focus:bg-surface-2'
                }`}
              >
                <td className="px-3 py-2 figure text-ink-soft whitespace-nowrap">{formatTime(r.created_at)}</td>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5">
                    <Pill tone={STATUS_TONE[r.status] ?? 'warn'}>{STATUS_LABEL[r.status] ?? r.status}</Pill>
                    {r.cache_hit && <Pill tone="info">Cached</Pill>}
                    {r.streamed && <Pill tone="info">Stream</Pill>}
                  </span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap figure text-[12.5px]">{r.model}</td>
                <td className="px-3 py-2 text-right figure hidden sm:table-cell">{formatMs(r.latency_ms)}</td>
                <td className="px-3 py-2 text-right figure hidden md:table-cell">
                  {r.total_tokens ?? <span className="text-ink-faint" title="Provider reported no usage">—</span>}
                </td>
                <td className="px-3 py-2 text-right figure">{formatCost(r.cost_usd, r.cost_known)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Request detail.
 *
 * Grouped into named sections rather than one flat list of fifteen rows,
 * because the questions people bring to this panel are grouped that way too:
 * "what was it", "was it slow", "what did it cost", "why did it behave like
 * that". A flat list makes every answer cost a full scan.
 *
 * Focus moves into the panel on open and returns to the originating row on
 * close, so a keyboard reader is not dropped at the top of the document each
 * time they inspect a request.
 */
function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<RequestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.request(id).then(setData).catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Move focus in on open; put it back where it came from on close. The row is
  // found by id rather than captured by reference because the list can be
  // re-fetched underneath an open drawer.
  useEffect(() => {
    panelRef.current?.focus();
    return () => {
      const row = document.querySelector<HTMLElement>(`[data-request-row="${id}"]`);
      row?.focus();
    };
  }, [id]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Request detail">
      <button className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close detail" />
      <div
        ref={panelRef} tabIndex={-1}
        className="relative w-full max-w-md bg-surface border-l border-rule overflow-y-auto slide-in drawer-lift outline-none"
      >
        <header className="sticky top-0 z-10 bg-surface flex items-center justify-between h-12 px-4 border-b border-rule">
          <h2 className="text-[14px] font-semibold tracking-tight">Request detail</h2>
          <Button onClick={onClose}>Close</Button>
        </header>

        {error !== null ? <ErrorState message={error} />
          : data === null ? <Loading rows={8} />
          : (
            <div className="text-[13px]">
              <Section title="Request">
                <Row label="Request ID"><CopyValue value={data.id} /></Row>
                <Row label="Time">{formatDateTime(data.created_at)}</Row>
                <Row label="Outcome">
                  <Pill tone={STATUS_TONE[data.status] ?? 'warn'}>{STATUS_LABEL[data.status] ?? data.status}</Pill>
                  <span className="ml-2 figure text-ink-soft">HTTP {data.status_code}</span>
                </Row>
              </Section>

              <Section title="Model">
                <Row label="Provider">{data.provider}</Row>
                <Row label="Model"><span className="figure text-[12.5px]">{data.model}</span></Row>
                <Row label="Project">{data.project_name ?? '—'}</Row>
                <Row label="API key">
                  {data.api_key_name ?? 'Deleted key'}
                  {data.api_key_prefix !== null && (
                    <span className="ml-2 figure text-[12px] text-ink-faint">tg_live_{data.api_key_prefix}…</span>
                  )}
                </Row>
              </Section>

              <Section title="Performance">
                <Row label="Total time"><span className="figure">{formatMs(data.latency_ms)}</span></Row>
                <Row label="Upstream time">
                  <span className="figure">
                    {data.upstream_ms === null ? '—' : formatMs(data.upstream_ms)}
                  </span>
                </Row>
                {data.upstream_ms !== null && (
                  <Row label="Gateway overhead">
                    <span className="figure">{formatMs(data.latency_ms - data.upstream_ms)}</span>
                    <span className="ml-2 t-meta">auth, limits, cache and recording</span>
                  </Row>
                )}
              </Section>

              <Section title="Usage & cost">
                <Row label="Prompt tokens"><Tokens n={data.prompt_tokens} /></Row>
                <Row label="Completion tokens"><Tokens n={data.completion_tokens} /></Row>
                <Row label="Total tokens"><Tokens n={data.total_tokens} /></Row>
                <Row label="Cost">
                  {data.cost_known
                    ? <span className="figure text-cost">{formatCost(data.cost_usd)}</span>
                    : <span className="text-ink-faint">Not known — no pricing configured, or the provider reported no usage</span>}
                </Row>
              </Section>

              <Section title="Behaviour">
                <Row label="Served from cache">
                  {data.cache_hit
                    ? <Pill tone="info">Hit</Pill>
                    : <span className="text-ink-soft">Miss</span>}
                </Row>
                <Row label="Streamed">{data.streamed ? 'Yes' : 'No'}</Row>
                <Row label="Retries">
                  <span className="figure">{data.retry_count}</span>
                  {data.retry_count > 0 && (
                    <span className="ml-2 t-meta">billed once</span>
                  )}
                </Row>
                {data.idempotency_key !== null && (
                  <Row label="Idempotency key"><CopyValue value={data.idempotency_key} /></Row>
                )}
              </Section>

              {data.error_code !== null && (
                <Section title="Error">
                  <Row label="Code"><span className="figure text-error">{data.error_code}</span></Row>
                  {data.error_message !== null && (
                    <Row label="Message">
                      <p className="text-[12.5px] text-ink-soft break-words">{data.error_message}</p>
                    </Row>
                  )}
                </Section>
              )}

              <p className="px-4 py-3 t-meta border-t border-rule-soft">
                Prompt and response bodies are not shown. The gateway does not retain them
                except where an idempotency key requires a replayable copy.
              </p>
            </div>
          )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-rule">
      <h3 className="t-section px-4 pt-4 pb-2">{title}</h3>
      <dl>{children}</dl>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-4 py-2 grid grid-cols-[128px_1fr] gap-3 items-baseline">
      <dt className="t-label">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/**
 * A technical identifier that is useful only if it can leave the screen. Copy
 * is the whole point of showing a request ID, so the value itself is the
 * button rather than hiding the action behind an icon at the end of a long
 * wrapping string.
 */
function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = (): void => {
    void navigator.clipboard.writeText(value).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      },
      () => undefined,  // clipboard blocked (insecure origin, denied permission)
    );
  };

  return (
    <button
      type="button" onClick={copy}
      className="group flex items-start gap-2 text-left w-full"
      aria-label={copied ? 'Copied to clipboard' : `Copy ${value}`}
    >
      <span className="figure text-[12px] break-all text-ink">{value}</span>
      <span className={`shrink-0 text-[11px] leading-4 ${copied ? 'text-accent' : 'text-ink-faint group-hover:text-ink-soft'}`}>
        {copied ? 'Copied' : 'Copy'}
      </span>
    </button>
  );
}

function Tokens({ n }: { n: number | null }) {
  return n === null
    ? <span className="text-ink-faint" title="The provider did not report usage">Not reported</span>
    : <span className="figure">{n}</span>;
}