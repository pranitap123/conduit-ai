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
    <div className="min-h-dvh flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <Link to="/" className="flex items-center gap-2 text-ink mb-6">
          <Mark /><b className="text-[15px] tracking-tight">Tollgate</b>
        </Link>

        <h1 className="text-[20px] font-semibold tracking-tight">
          {mode === 'login' ? 'Sign in' : 'Create an organization'}
        </h1>
        <p className="mt-1 mb-6 text-[13px] text-ink-soft">
          {mode === 'login'
            ? 'Your gateway traffic, spend and keys.'
            : 'You get an organization, a default project, and somewhere to create your first key.'}
        </p>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => { e.preventDefault(); void submit(); }}
        >
          {mode === 'signup' && (
            <Field label="Organization name" value={orgName} onChange={setOrgName} required placeholder="Acme" />
          )}
          <Field
            label="Email" type="email" value={email} onChange={setEmail}
            autoComplete="email" required placeholder="you@company.com"
          />
          <Field
            label="Password" type="password" value={password} onChange={setPassword}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required
            {...(mode === 'signup' ? { hint: 'At least 10 characters.' } : {})}
          />

          {error !== null && <p className="text-[13px] text-error" role="alert">{error}</p>}

          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Working' : mode === 'login' ? 'Sign in' : 'Create organization'}
          </Button>
        </form>

        <p className="mt-5 text-[13px] text-ink-soft">
          {mode === 'login' ? (
            <>No account? <Link to="/signup" className="text-accent underline underline-offset-2">Create an organization</Link></>
          ) : (
            <>Already have one? <Link to="/login" className="text-accent underline underline-offset-2">Sign in</Link></>
          )}
        </p>
      </div>
    </div>
  );
}
