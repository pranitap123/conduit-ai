import { NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import { api, type Me } from '../lib/api';
import { Mark } from './Mark';

const NAV = [
  { to: '/app', label: 'Overview', end: true },
  { to: '/app/requests', label: 'Requests' },
  { to: '/app/keys', label: 'API keys' },
];

export function Shell({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [navOpen, setNavOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.me().then(setMe).catch(() => navigate('/login'));
  }, [navigate]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
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
        <ul className="p-2">
          {NAV.map((n) => (
            <li key={n.to}>
              <NavLink
                to={n.to} end={n.end} onClick={() => setNavOpen(false)}
                className={({ isActive }) =>
                  `block px-2.5 h-8 leading-8 text-[13px] ${isActive ? 'bg-accent-soft text-accent font-medium' : 'text-ink-soft hover:text-ink hover:bg-surface-2'}`}
              >
                {n.label}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="p-2 lg:absolute lg:bottom-0 lg:w-[208px] border-t border-rule-soft">
          <p className="px-2.5 py-2 text-[12px] text-ink-faint truncate">
            {me?.org.name ?? ' '}
          </p>
          <button
            onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
            className="block w-full text-left px-2.5 h-8 text-[13px] text-ink-soft hover:text-ink hover:bg-surface-2"
          >
            {theme === 'light' ? 'Dark theme' : 'Light theme'}
          </button>
          <button
            onClick={() => void signOut()}
            className="block w-full text-left px-2.5 h-8 text-[13px] text-ink-soft hover:text-ink hover:bg-surface-2"
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
          className={`px-2.5 h-8 text-[13px] border-r border-rule-soft last:border-r-0 ${
            hours === h ? 'bg-accent-soft text-accent font-medium' : 'text-ink-soft hover:text-ink'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
