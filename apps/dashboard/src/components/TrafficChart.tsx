import {
  Area, AreaChart, Bar, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { Bucket } from '../lib/api';
import { formatCount, formatMs } from '../lib/format';

/**
 * Two charts, each answering one question. Nothing here exists to fill space.
 *
 * Volume: "how much traffic, and how much of it failed or was served from
 * cache" — stacked, because the parts sum to the total and the comparison that
 * matters is proportion.
 *
 * Latency: "how slow is the slow tail" — p95 only. A mean would hide it.
 */
const axis = { stroke: 'var(--color-rule)', fontSize: 11, tickLine: false };

function label(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="h-[180px] px-2 pb-2">{children}</div>;
}

export function VolumeChart({ data }: { data: Bucket[] }) {
  const shaped = data.map((b) => ({
    t: label(b.bucket),
    served: Math.max(b.requests - b.errors - b.cacheHits, 0),
    cached: b.cacheHits,
    failed: b.errors,
  }));
  return (
    <Frame>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={shaped} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <XAxis dataKey="t" {...axis} interval="preserveStartEnd" minTickGap={40} />
          <YAxis {...axis} width={38} tickFormatter={formatCount} />
          <Tooltip content={<Readout unit="requests" />} cursor={{ fill: 'var(--color-rule-soft)' }} />
          <Bar dataKey="served" stackId="a" fill="var(--color-accent)" name="Served upstream" />
          <Bar dataKey="cached" stackId="a" fill="var(--color-cache)" name="Served from cache" />
          <Bar dataKey="failed" stackId="a" fill="var(--color-error)" name="Failed" />
        </ComposedChart>
      </ResponsiveContainer>
    </Frame>
  );
}

export function LatencyChart({ data }: { data: Bucket[] }) {
  const shaped = data.map((b) => ({ t: label(b.bucket), p95: b.p95LatencyMs }));
  return (
    <Frame>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={shaped} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <XAxis dataKey="t" {...axis} interval="preserveStartEnd" minTickGap={40} />
          <YAxis {...axis} width={44} tickFormatter={(v: number) => formatMs(v)} />
          <Tooltip content={<Readout unit="ms" />} cursor={{ stroke: 'var(--color-rule)' }} />
          <Area
            type="monotone" dataKey="p95" name="95th percentile"
            stroke="var(--color-accent)" strokeWidth={1.5}
            fill="var(--color-accent-soft)" isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </Frame>
  );
}

interface TooltipPayload { name?: string; value?: number; color?: string }

function Readout({ active, payload, label: at, unit }: {
  active?: boolean; payload?: TooltipPayload[]; label?: string; unit: string;
}) {
  if (active !== true || payload === undefined || payload.length === 0) return null;
  return (
    <div className="bg-surface border border-rule px-2.5 py-2 text-[12px] shadow-sm">
      <p className="text-ink-soft mb-1">{at}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 inline-block" style={{ background: p.color }} aria-hidden="true" />
          <span className="text-ink-soft">{p.name}</span>
          <span className="figure text-ink ml-auto">{p.value} {unit === 'ms' ? 'ms' : ''}</span>
        </p>
      ))}
    </div>
  );
}
