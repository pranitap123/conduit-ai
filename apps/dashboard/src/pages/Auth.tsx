import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Button, Field } from '../components/primitives';
import { Mark } from '../components/Mark';

export function Auth({ mode }: { mode: 'login' | 'signup' }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (): Promise<void> => {
    setBusy(true); setError(null);
    try {
      if (mode === 'login') await api.login(email, password);
      else await api.signup(email, password, orgName);
      navigate('/app');
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center p-6 bg-bg">
      <div className="w-full max-w-[400px] animate-in">
        <div className="bg-surface border border-rule p-8 sm:p-10">
          <Link to="/" className="flex justify-center mb-8">
            <div className="w-12 h-12 border border-rule flex items-center justify-center text-ink">
              <Mark size={22} />
            </div>
          </Link>

          <header className="mb-8 text-center">
            <h1 className="text-[22px] font-semibold tracking-tight text-ink mb-2">
              {mode === 'login' ? 'Sign in to Conduit' : 'Provision a gateway'}
            </h1>
            <p className="text-[14px] text-ink-soft leading-relaxed">
              {mode === 'login'
                ? 'Authenticate to reach your control plane.'
                : 'Creates an organization and a default routing project.'}
            </p>
          </header>

          <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            {mode === 'signup' && (
              <Field label="Organization name" value={orgName} onChange={setOrgName} required placeholder="Acme Corp" />
            )}
            <Field label="Work email" type="email" value={email} onChange={setEmail} autoComplete="email" required placeholder="admin@domain.com" />
            <Field
              label="Password" type="password" value={password} onChange={setPassword}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required
              {...(mode === 'signup' ? { hint: 'Minimum 10 characters.' } : {})}
            />

            {error !== null && (
              <p className="text-[14px] text-error font-medium" role="alert">{error}</p>
            )}

            <div className="pt-1">
              <div className="w-full [&>button]:w-full">
                <Button type="submit" variant="primary" disabled={busy}>
                  {busy ? 'Authenticating…' : mode === 'login' ? 'Sign in' : 'Create workspace'}
                </Button>
              </div>
            </div>
          </form>
        </div>

        <div className="mt-6 text-center text-[14px] text-ink-soft">
          {mode === 'login' ? (
            <>New to Conduit? <Link to="/signup" className="text-ink font-medium hover:text-accent transition-colors">Create an organization</Link></>
          ) : (
            <>Already have an account? <Link to="/login" className="text-ink font-medium hover:text-accent transition-colors">Sign in</Link></>
          )}
        </div>
      </div>
    </div>
  );
}