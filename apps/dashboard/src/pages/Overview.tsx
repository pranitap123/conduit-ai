import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Bucket, type ModelRow, type Overview as OverviewData } from '../lib/api';
import { formatCost, formatCount, formatMs, formatPercent } from '../lib/format';
import { ErrorState, Empty, Loading, Panel } from '../components/primitives';
import { Reading, ReadoutBand } from '../components/Readout';
import { RangePicker } from '../components/Shell';
import { LatencyChart, VolumeChart } from '../components/TrafficChart';

export function Overview() {
  const [hours, setHours] = useState(24);
  const [data, setData] = useState<{ o: OverviewData; t: Bucket[]; m: ModelRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([api.overview(hours), api.timeseries(hours), api.models(hours)])
      .then(([o, t, m]) => setData({ o, t, m }))
      .catch((e: Error) => setError(e.message));
  }, [hours]);

  useEffect(() => { setData(null); load(); }, [load]);

  // Poll rather than websocket: one small query every 15s is cheaper to run and
  // far cheaper to reason about than a socket, and 15s is well inside the
  // resolution anyone reads a cost dashboard at. Noted in ADR-009.
  useEffect(() => {
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

  if (error !== null) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] font-semibold tracking-tight">Overview</h1>
        <RangePicker hours={hours} onChange={setHours} />
      </div>

      {data === null ? <Loading rows={4} /> : (
        <>
          <ReadoutBand>
            <Reading
              label="Requests" value={formatCount(data.o.requests)}
              note={data.o.requests === 0 ? 'No traffic yet' : `${formatCount(data.o.cacheHits)} from cache`}
            />
            <Reading
              label="Spend" value={formatCost(data.o.costUsd)} tone="cost"
              note={data.o.unpricedRequests > 0
                // Never present an understated total as complete.
                ? `${formatCount(data.o.unpricedRequests)} requests unpriced`
                : 'All requests priced'}
            />
            <Reading
              label="Tokens" value={formatCount(data.o.totalTokens)}
              note="Reported by provider"
            />
            <Reading
              label="Failures" value={formatPercent(data.o.requests === 0 ? 0 : data.o.errors / data.o.requests)}
              tone={data.o.errors > 0 ? 'error' : 'default'}
              note={`${formatCount(data.o.errors)} of ${formatCount(data.o.requests)}`}
            />
            <Reading
              label="Latency p95" value={formatMs(data.o.p95LatencyMs)}
              note={`Median ${formatMs(data.o.p50LatencyMs)}`}
            />
          </ReadoutBand>

          {data.o.requests === 0 ? (
            <Panel title="Traffic">
              <Empty
                title="Nothing has passed through the gateway yet"
                body="Create an API key, point a client at /v1/chat/completions, and requests will appear here within seconds."
                action={<Link to="/app/keys" className="text-[13px] text-accent underline underline-offset-2">Create an API key</Link>}
              />
            </Panel>
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <Panel title="Request volume">
                  <VolumeChart data={data.t} />
                  <p className="px-4 pb-3 text-[12px] text-ink-faint">
                    Served upstream, served from cache, and failed — stacked to the total.
                  </p>
                </Panel>
                <Panel title="Latency, 95th percentile">
                  <LatencyChart data={data.t} />
                  <p className="px-4 pb-3 text-[12px] text-ink-faint">
                    Gateway time including the upstream call. A mean would hide the slow tail.
                  </p>
                </Panel>
              </div>

              <Panel title="By model">
                <ModelTable rows={data.m} />
              </Panel>
            </>
          )}
        </>
      )}
    </div>
  );
}

function ModelTable({ rows }: { rows: ModelRow[] }) {
  if (rows.length === 0) {
    return <Empty title="No models used in this range" body="Widen the time range to see earlier traffic." />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <caption className="sr-only">Requests, tokens and spend grouped by model</caption>
        <thead>
          <tr className="text-ink-soft border-b border-rule-soft">
            <th scope="col" className="text-left font-medium px-4 py-2">Model</th>
            <th scope="col" className="text-left font-medium px-4 py-2">Provider</th>
            <th scope="col" className="text-right font-medium px-4 py-2">Requests</th>
            <th scope="col" className="text-right font-medium px-4 py-2">Tokens</th>
            <th scope="col" className="text-right font-medium px-4 py-2">Failures</th>
            <th scope="col" className="text-right font-medium px-4 py-2">Spend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.provider}/${r.model}`} className="border-b border-rule-soft last:border-0">
              <td className="px-4 py-2 font-medium">{r.model}</td>
              <td className="px-4 py-2 text-ink-soft">{r.provider}</td>
              <td className="px-4 py-2 text-right figure">{r.requests}</td>
              <td className="px-4 py-2 text-right figure">{formatCount(r.totalTokens)}</td>
              <td className={`px-4 py-2 text-right figure ${r.errorRate > 0 ? 'text-error' : 'text-ink-faint'}`}>
                {formatPercent(r.errorRate)}
              </td>
              <td className="px-4 py-2 text-right figure">
                {r.costKnown ? formatCost(r.costUsd) : (
                  <span className="text-ink-faint" title="No pricing configured for this model">Unpriced</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
