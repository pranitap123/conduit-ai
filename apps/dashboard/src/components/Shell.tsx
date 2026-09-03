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
    <>
      <div className="bg-noise" aria-hidden="true" />
      <div className="min-h-dvh flex flex-col lg:flex-row bg-ambient">
        <nav className="shrink-0 lg:w-64 border-b lg:border-b-0 lg:border-r border-rule bg-surface/80 backdrop-blur-md p-5 lg:p-6 flex flex-col justify-between relative z-10 transition-colors duration-500">
          <div>
            <Link to="/app" className="flex items-center gap-2.5 text-ink mb-10 hover:opacity-80 transition-all duration-300 active:scale-95 origin-left group">
              <div className="group-hover:text-accent transition-colors duration-300">
                <Mark size={22} />
              </div>
              <b className="text-[17px] tracking-tight font-semibold">Conduit</b>
            </Link>

            <div className="flex flex-col gap-1 relative">
              <span className="t-label mb-2 px-3">Gateway</span>
              {nav.map((item) => {
                const active = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`relative px-3 py-2.5 text-[15px] font-medium rounded-md transition-all duration-200 overflow-hidden group ${
                      active
                        ? 'text-ink bg-surface-2 shadow-sm'
                        : 'text-ink-soft hover:text-ink hover:bg-surface-2/50'
                    }`}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-1/2 bg-accent rounded-r-md animate-in" aria-hidden="true" />
                    )}
                    <span className="relative z-10">{item.name}</span>
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="mt-10 lg:mt-auto pt-5 border-t border-rule-soft flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              className="w-full text-left px-3 py-2.5 text-[14px] font-medium rounded-md text-ink-soft hover:text-ink hover:bg-surface-2 transition-all duration-200"
            >
              {theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            </button>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="w-full text-left px-3 py-2.5 text-[14px] font-medium rounded-md text-ink-soft hover:text-error hover:bg-error-soft transition-all duration-200"
            >
              Log out
            </button>
          </div>
        </nav>

        <main className="flex-1 min-w-0 p-6 lg:p-10 overflow-y-auto relative z-0">
          <div key={location.pathname} className="max-w-6xl mx-auto w-full animate-in">
            {children}
          </div>
        </main>
      </div>
    </>
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
    <div className="flex items-center bg-surface border border-rule rounded-md shadow-sm overflow-hidden p-0.5 gap-0.5 transition-colors duration-300">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`relative px-4 h-9 text-[14px] font-medium rounded-sm transition-all duration-200 ${
            hours === opt.value
              ? 'bg-surface-2 text-ink shadow-sm'
              : 'text-ink-soft hover:text-ink hover:bg-surface-2/50'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}