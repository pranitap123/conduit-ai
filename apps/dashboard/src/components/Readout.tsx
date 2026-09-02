import type { ReactNode } from 'react';

/**
 * The overview readout band — the one place this design spends its boldness.
 *
 * Figures sit on a single hairline-ruled band rather than in separate shadowed
 * cards, because they are readings from one instrument and should be compared
 * across, not scanned as unrelated tiles. Values are tabular mono so digits
 * align vertically between refreshes and the number does not shimmy.
 *
 * Six columns at desktop: requests, spend, tokens, cache, failures, latency.
 * Three at tablet and two on a phone, so a reading is never narrower than the
 * longest figure it has to hold.
 */
export function ReadoutBand({ children }: { children: ReactNode }) {
  return (
    <div className="bg-surface border border-rule grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-y lg:divide-y-0 divide-rule-soft">
      {children}
    </div>
  );
}

export function Reading({
  label, value, unit, note, tone = 'default',
}: {
  label: string; value: string; unit?: string; note?: string;
  tone?: 'default' | 'cost' | 'error' | 'cache';
}) {
  const valueTone = {
    default: 'text-ink', cost: 'text-cost', error: 'text-error', cache: 'text-cache',
  }[tone];
  return (
    <div className="px-4 py-4 min-w-0">
      {/*
       * The label is set small, tracked out and in the faintest ink so that the
       * figure below is unambiguously the thing being read. Hierarchy here is
       * carried by colour and tracking, not by making the label smaller still.
       */}
      <p className="t-section truncate">{label}</p>
      <p className={`figure mt-2 text-[27px] leading-none font-medium tracking-tight ${valueTone}`}>
        {value}
        {unit !== undefined && <span className="ml-1 text-[13px] text-ink-faint font-normal">{unit}</span>}
      </p>
      <p className="mt-2 t-meta truncate h-4">{note ?? ''}</p>
    </div>
  );
}