import { NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import { api, type Me } from '../lib/api';
import { Mark } from './Mark';

const NAV = [
  { to: '/app', label: 'Overview', end: true },
  { to: '/app/requests', label: 'Requests' },
  { to: '/app/keys', label: 'API keys' },
];

/**
 * Theme is resolved once, before first paint concerns: dark is the product
 * default, and a previous explicit choice always wins over it. Persisting to
 * localStorage rather than to the account keeps this a device preference, which
 * is what it actually is — the same operator wants dark on the wall display and
 * light on a laptop in sunlight.
 */
function initialTheme(): 'light' | 'dark' {
  const stored = localStorage.getItem('tg_theme');
  return stored === 'light' || stored === 'dark' ? stored : 'dark';
}

export function Shell({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(initialTheme);
  const [navOpen, setNavOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.me().then(setMe).catch(() => navigate('/login'));
  }, [navigate]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('tg_theme', theme);
  }, [theme]);

  const signOut = async (): Promise<void> => {
    await api.logout().catch(() => undefined);
    navigate('/login');
  };

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[208px_1fr]">
      <header className="lg:hidden flex items-center justify-between h-12 px-4 border-b border-rule bg-surface">
        <span className="flex items-center gap-2 text-ink"><Mark /><b className="text-[14px]">Tollgate</b></span>
        <button
          onClick={() => setNavOpen((v) => !v)}
          aria-expanded={navOpen}
          className="text-[13px] text-ink-soft px-2 h-8 border border-rule"
        >
          {navOpen ? 'Close' : 'Menu'}
        </button>
      </header>

      <nav
        className={`${navOpen ? 'block' : 'hidden'} lg:block border-b lg:border-b-0 lg:border-r border-rule bg-surface lg:sticky lg:top-0 lg:h-dvh`}
        aria-label="Sections"
      >
        <div className="hidden lg:flex items-center gap-2 h-14 px-4 text-ink border-b border-rule-soft">
          <Mark /><b className="text-[14px] tracking-tight">Tollgate</b>
        </div>

        <ul className="p-2 lg:pt-3">
          {NAV.map((n) => (
            <li key={n.to}>
              <NavLink
                to={n.to} end={n.end} onClick={() => setNavOpen(false)}
                /*
                 * The active row is marked by a solid accent rule on its leading
                 * edge, not by a filled pill. A rule reads as "you are here" on
                 * a list; a filled block reads as a button and competes with the
                 * real controls on the page.
                 */
                className={({ isActive }) =>
                  `relative block pl-3 pr-2.5 h-8 leading-8 text-[13px] transition-colors ${
                    isActive
                      ? 'text-ink font-medium bg-surface-2 before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[2px] before:bg-accent'
                      : 'text-ink-soft hover:text-ink hover:bg-surface-2'
                  }`}
              >
                {n.label}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="p-2 lg:absolute lg:bottom-0 lg:w-[208px] border-t border-rule-soft">
          <p className="px-2.5 py-2 t-section truncate">
            {me?.org.name ?? ' '}
          </p>
          <button
            onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
            className="block w-full text-left px-2.5 h-8 text-[13px] text-ink-soft hover:text-ink hover:bg-surface-2 transition-colors"
          >
            {theme === 'light' ? 'Dark theme' : 'Light theme'}
          </button>
          <button
            onClick={() => void signOut()}
            className="block w-full text-left px-2.5 h-8 text-[13px] text-ink-soft hover:text-ink hover:bg-surface-2 transition-colors"
          >
            Sign out
          </button>
        </div>
      </nav>

      <main className="min-w-0 p-4 sm:p-6 max-w-[1180px] w-full">{children}</main>
    </div>
  );
}

/** Range selector. Shared by every analytics screen so the vocabulary matches. */
export function RangePicker({ hours, onChange }: { hours: number; onChange: (h: number) => void }) {
  const options: Array<[number, string]> = [[1, '1h'], [6, '6h'], [24, '24h'], [168, '7d']];
  return (
    <div className="inline-flex border border-rule bg-surface" role="group" aria-label="Time range">
      {options.map(([h, label]) => (
        <button
          key={h} onClick={() => onChange(h)} aria-pressed={hours === h}
          className={`px-2.5 h-8 text-[13px] border-r border-rule-soft last:border-r-0 transition-colors ${
            hours === h ? 'bg-accent-soft text-accent font-medium' : 'text-ink-soft hover:text-ink'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}