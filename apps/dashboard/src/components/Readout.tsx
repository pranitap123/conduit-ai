import type { ReactNode } from 'react';

/**
 * The overview readout band — the one place this design spends its boldness.
 *
 * Figures sit on a single hairline-ruled band rather than in separate shadowed
 * cards, because they are readings from one instrument and should be compared
 * across, not scanned as unrelated tiles. Values are tabular mono so digits
 * align vertically between refreshes and the number does not shimmy.
 */
export function ReadoutBand({ children }: { children: ReactNode }) {
  return (
    <div className="bg-surface border border-rule grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-x divide-y lg:divide-y-0 divide-rule-soft">
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
      <p className="text-[12px] text-ink-soft truncate">{label}</p>
      <p className={`figure mt-1.5 text-[26px] leading-none font-medium ${valueTone}`}>
        {value}
        {unit !== undefined && <span className="ml-1 text-[13px] text-ink-faint font-normal">{unit}</span>}
      </p>
      <p className="mt-1.5 text-[12px] text-ink-faint truncate h-4">{note ?? ''}</p>
    </div>
  );
}
