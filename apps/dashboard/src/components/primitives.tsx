import type { ReactNode } from 'react';

export function Button({
  children, onClick, variant = 'quiet', type = 'button', disabled = false,
}: {
  children: ReactNode; onClick?: () => void;
  variant?: 'primary' | 'quiet' | 'danger'; type?: 'button' | 'submit'; disabled?: boolean;
}) {
  const base = 'relative inline-flex items-center justify-center gap-2 px-5 h-11 text-[14px] font-medium border rounded-md transition-all duration-300 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 overflow-hidden group';
  const tone = {
    primary: 'bg-accent text-paper border-accent shadow-lg shadow-accent/20 hover:shadow-accent/40 hover:-translate-y-0.5',
    quiet: 'bg-surface text-ink border-rule hover:bg-surface-2 hover:border-rule-soft hover:-translate-y-0.5 shadow-sm',
    danger: 'bg-surface text-error border-rule hover:bg-error-soft hover:border-error hover:-translate-y-0.5 shadow-sm',
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${tone}`}>
      <span className="relative z-10 flex items-center gap-2">{children}</span>
      {variant === 'primary' && (
        <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
      )}
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
    <div className="flex flex-col gap-2 animate-in stagger-1">
      <label htmlFor={id} className="text-[14px] font-medium text-ink-soft transition-colors">{label}</label>
      <input
        id={id} type={type} value={value} placeholder={placeholder}
        autoComplete={autoComplete} required={required}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 px-3 bg-surface border border-rule rounded-md text-[15px] text-ink placeholder:text-ink-faint transition-all duration-300 focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--color-accent-soft)] hover:border-rule-soft"
      />
      {hint !== undefined && <p className="text-[13px] text-ink-faint">{hint}</p>}
    </div>
  );
}

export function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'info'; children: ReactNode }) {
  const cls = {
    ok: 'text-accent bg-accent-soft border-accent/20',
    warn: 'text-cost bg-cost-soft border-cost/20',
    bad: 'text-error bg-error-soft border-error/20',
    info: 'text-cache bg-cache-soft border-cache/20',
  }[tone];
  return <span className={`inline-flex items-center px-2.5 py-1 text-[13px] font-medium leading-4 rounded-full border transition-all duration-300 hover:scale-105 ${cls}`}>{children}</span>;
}

export function Panel({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="bg-surface border border-rule rounded-lg shadow-sm panel-hover animate-in">
      {title !== undefined && (
        <header className="flex items-center justify-between gap-3 px-6 h-14 py-3 border-b border-rule-soft bg-surface-2/30 backdrop-blur-sm rounded-t-lg">
          <h2 className="text-[15px] font-semibold text-ink tracking-tight">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-1">{children}</div>
    </section>
  );
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="p-6 flex flex-col gap-3 animate-in" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-4 bg-rule-soft rounded animate-pulse" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="px-6 py-16 text-center animate-in">
      <p className="text-[16px] font-semibold text-ink">{title}</p>
      <p className="mt-2 text-[14px] text-ink-soft max-w-sm mx-auto leading-relaxed">{body}</p>
      {action !== undefined && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="px-6 py-14 text-center animate-in" role="alert">
      <p className="text-[16px] font-medium text-error">{message}</p>
      {onRetry !== undefined && (
        <div className="mt-5 flex justify-center"><Button onClick={onRetry}>Try again</Button></div>
      )}
    </div>
  );
}