import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Mark } from './Mark';
import { api } from '../lib/api';

export function Shell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('conduit-theme') as 'dark' | 'light') || 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('conduit-theme', theme);
  }, [theme]);

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      /* session already gone; proceed to the login screen regardless */
    }
    navigate('/login');
  };

  const nav = [
    { name: 'Overview', path: '/app' },
    { name: 'Request traces', path: '/app/requests' },
    { name: 'API keys', path: '/app/keys' },
  ];

  return (
    <div className="min-h-dvh flex flex-col lg:flex-row bg-bg">
      <nav className="shrink-0 lg:w-64 border-b lg:border-b-0 lg:border-r border-rule bg-surface p-5 lg:p-6 flex flex-col justify-between">
        <div>
          <Link to="/app" className="flex items-center gap-2.5 text-ink mb-10 hover:opacity-80 transition-opacity">
            <Mark size={22} />
            <b className="text-[17px] tracking-tight font-semibold">Conduit</b>
          </Link>

          <div className="flex flex-col gap-0.5">
            <span className="t-label mb-2 px-2.5">Gateway</span>
            {nav.map((item) => {
              const active = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`px-2.5 py-2.5 text-[15px] font-medium border-l-2 transition-colors duration-150 ${
                    active
                      ? 'border-l-accent text-ink bg-surface-2'
                      : 'border-l-transparent text-ink-soft hover:text-ink hover:bg-surface-2'
                  }`}
                >
                  {item.name}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="mt-10 lg:mt-auto pt-5 border-t border-rule-soft flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            className="w-full text-left px-2.5 py-2.5 text-[14px] font-medium text-ink-soft hover:text-ink hover:bg-surface-2 transition-colors duration-150"
          >
            {theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          </button>
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="w-full text-left px-2.5 py-2.5 text-[14px] font-medium text-ink-soft hover:text-error hover:bg-error-soft transition-colors duration-150"
          >
            Log out
          </button>
        </div>
      </nav>

      <main className="flex-1 min-w-0 p-6 lg:p-10 overflow-y-auto">
        <div className="max-w-6xl mx-auto w-full animate-in">
          {children}
        </div>
      </main>
    </div>
  );
}

export function RangePicker({ hours, onChange }: { hours: number; onChange: (h: number) => void }) {
  const options = [
    { label: '1 hour', value: 1 },
    { label: '24 hours', value: 24 },
    { label: '7 days', value: 168 },
    { label: '30 days', value: 720 },
  ];

  return (
    <div className="flex items-center bg-surface border border-rule">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-4 h-10 text-[14px] font-medium border-r border-rule last:border-r-0 transition-colors duration-150 ${
            hours === opt.value
              ? 'bg-surface-2 text-ink'
              : 'text-ink-soft hover:text-ink hover:bg-surface-2'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}