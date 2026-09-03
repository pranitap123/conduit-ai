import type { ReactNode } from 'react';

/**
 * Shared primitives. Deliberately few: this product is tables and figures, and
 * a large component kit would invite decoration the design does not want.
 */

export function Button({
  children, onClick, variant = 'quiet', type = 'button', disabled = false,
}: {
  children: ReactNode; onClick?: () => void;
  variant?: 'primary' | 'quiet' | 'danger'; type?: 'button' | 'submit'; disabled?: boolean;
}) {
  const base = 'inline-flex items-center justify-center gap-2 px-4 h-10 text-[14px] font-medium border transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed';
  const tone = {
    primary: 'bg-accent text-paper border-accent hover:opacity-90',
    quiet: 'bg-surface text-ink border-rule hover:bg-surface-2 hover:border-rule',
    danger: 'bg-surface text-error border-rule hover:bg-error-soft hover:border-error',
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${tone}`}>
      {children}
    </button>
  );
}

export function Field({
  label, value, onChange, type = 'text', placeholder, autoComplete, required, hint,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; autoComplete?: string; required?: boolean; hint?: string;
}) {
  const id = `f-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-[14px] font-medium text-ink-soft">{label}</label>
      <input
        id={id} type={type} value={value} placeholder={placeholder}
        autoComplete={autoComplete} required={required}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 px-3 bg-surface border border-rule text-[15px] text-ink placeholder:text-ink-faint transition-colors duration-150 focus-visible:border-accent"
      />
      {hint !== undefined && <p className="text-[13px] text-ink-faint">{hint}</p>}
    </div>
  );
}

/** Status pill. Colour never carries meaning alone — the label always says it. */
export function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'info'; children: ReactNode }) {
  const cls = {
    ok: 'text-accent bg-accent-soft',
    warn: 'text-cost bg-cost-soft',
    bad: 'text-error bg-error-soft',
    info: 'text-cache bg-cache-soft',
  }[tone];
  return <span className={`inline-flex items-center px-2 py-1 text-[13px] font-medium leading-4 ${cls}`}>{children}</span>;
}

export function Panel({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="bg-surface border border-rule">
      {title !== undefined && (
        <header className="flex items-center justify-between gap-3 px-5 h-13 py-3 border-b border-rule-soft">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/** Skeleton rather than a spinner: it holds the layout, so nothing jumps. */
export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="p-5 flex flex-col gap-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-4 bg-rule-soft animate-pulse" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

/** An empty screen is an invitation to act, so it always carries the action. */
export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="px-4 py-14 text-center">
      <p className="text-[16px] font-semibold text-ink">{title}</p>
      <p className="mt-2 text-[14px] text-ink-soft max-w-sm mx-auto leading-relaxed">{body}</p>
      {action !== undefined && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

/** Errors say what happened and how to fix it. They do not apologise. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="px-4 py-12 text-center" role="alert">
      <p className="text-[16px] font-medium text-error">{message}</p>
      {onRetry !== undefined && (
        <div className="mt-4 flex justify-center"><Button onClick={onRetry}>Try again</Button></div>
      )}
    </div>
  );
}