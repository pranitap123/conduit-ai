import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Bucket, type ModelRow, type Overview as OverviewData } from '../lib/api';
import { formatCost, formatCount, formatMs, formatPercent } from '../lib/format';
import { ErrorState, Empty, Loading, Panel } from '../components/primitives';
import { ReadoutBand, Reading } from '../components/Readout';
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
  useEffect(() => { const id = setInterval(load, 15_000); return () => clearInterval(id); }, [load]);

  if (error !== null) return <div className="mt-8"><ErrorState message={error} onRetry={load} /></div>;

  return (
    <div className="flex flex-col gap-10 pb-20">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-5 animate-in">
        <div>
          <h1 className="t-page text-ink">Overview</h1>
          <p className="t-body text-ink-soft mt-1.5">Real-time gateway telemetry and spend.</p>
        </div>
        <div className="shrink-0"><RangePicker hours={hours} onChange={setHours} /></div>
      </header>

      {data === null ? <div className="mt-4"><Loading rows={4} /></div> : (
        <>
          <div className="animate-in stagger-1">
            <ReadoutBand>
              <Reading label="Requests" value={formatCount(data.o.requests)}
                note={data.o.requests === 0 ? 'No traffic yet' : `${formatCount(data.o.cacheHits)} cached`} />
              <Reading label="Spend" value={formatCost(data.o.costUsd)} tone="cost"
                note={data.o.unpricedRequests > 0 ? `${formatCount(data.o.unpricedRequests)} unpriced` : 'All priced'} />
              <Reading label="Tokens" value={formatCount(data.o.totalTokens)} note="Reported by providers" />
              <Reading label="Cache hit rate" value={formatPercent(data.o.requests === 0 ? 0 : data.o.cacheHits / data.o.requests)} tone="cache"
                note={`${formatCount(data.o.cacheHits)} of ${formatCount(data.o.requests)}`} />
              <Reading label="Failure rate" value={formatPercent(data.o.requests === 0 ? 0 : data.o.errors / data.o.requests)}
                tone={data.o.errors > 0 ? 'error' : 'default'} note={`${formatCount(data.o.errors)} of ${formatCount(data.o.requests)}`} />
              <Reading label="p95 latency" value={formatMs(data.o.p95LatencyMs)} note={`Median ${formatMs(data.o.p50LatencyMs)}`} />
            </ReadoutBand>
          </div>

          {data.o.requests === 0 ? (
            <div className="animate-in stagger-2">
              <Panel>
                <Empty
                  title="Awaiting gateway traffic"
                  body="Create an API key and route your first /v1/chat/completions request to populate telemetry."
                  action={<Link to="/app/keys" className="text-[14px] font-medium text-accent hover:opacity-80 transition-opacity">Provision an API key →</Link>}
                />
              </Panel>
            </div>
          ) : (
            <div className="flex flex-col gap-8 animate-in stagger-2">
              <div className="grid lg:grid-cols-2 gap-6">
                <Panel title="Request volume">
                  <p className="px-5 pt-4 t-meta">Served upstream, served from cache, and failed.</p>
                  <VolumeChart data={data.t} />
                </Panel>
                <Panel title="Gateway latency (p95)">
                  <p className="px-5 pt-4 t-meta">Total round-trip time including the upstream provider.</p>
                  <LatencyChart data={data.t} />
                </Panel>
              </div>

              <Panel title="Traffic by model">
                <ModelTable rows={data.m} />
              </Panel>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ModelTable({ rows }: { rows: ModelRow[] }) {
  if (rows.length === 0) return <Empty title="No model data" body="Widen the time range." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[14px] border-collapse">
        <thead>
          <tr className="border-b border-rule-soft">
            <th scope="col" className="t-section px-5 py-3">Model</th>
            <th scope="col" className="t-section px-5 py-3 hidden sm:table-cell">Provider</th>
            <th scope="col" className="t-section px-5 py-3 text-right">Requests</th>
            <th scope="col" className="t-section px-5 py-3 text-right hidden md:table-cell">Tokens</th>
            <th scope="col" className="t-section px-5 py-3 text-right">Spend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.provider}/${r.model}`} className="border-b border-rule-soft last:border-0 hover:bg-surface-2 transition-colors duration-150">
              <td className="px-5 py-3.5 font-medium text-ink figure">{r.model}</td>
              <td className="px-5 py-3.5 text-ink-soft hidden sm:table-cell">{r.provider}</td>
              <td className="px-5 py-3.5 text-right figure text-ink">{r.requests}</td>
              <td className="px-5 py-3.5 text-right figure text-ink-soft hidden md:table-cell">{formatCount(r.totalTokens)}</td>
              <td className="px-5 py-3.5 text-right figure text-cost font-medium">
                {r.costKnown ? formatCost(r.costUsd) : <span className="text-ink-faint font-normal">Unpriced</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}