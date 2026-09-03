import { useCallback, useEffect, useState } from 'react';
import { api, type ApiKeyRow } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { Button, Empty, ErrorState, Field, Loading, Panel } from '../components/primitives';

export function Keys() {
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.keys().then(setKeys).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    setCreateError(null);
    try {
      const res = await api.createKey(newName.trim());
      setRevealed(res.plaintext);
      setNewName('');
      setCreating(false);
      load();
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    if (!window.confirm('Are you sure you want to revoke this API key? Applications using it will immediately lose access.')) {
      return;
    }
    try {
      await api.revokeKey(id);
      load();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-8 animate-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="t-page text-ink">API keys</h1>
          <p className="mt-1 text-[15px] text-ink-soft">Manage virtual gateway keys used to authenticate upstream calls.</p>
        </div>
        {keys !== null && keys.length > 0 && !creating && (
          <div>
            <Button variant="primary" onClick={() => setCreating(true)}>
              Create API key
            </Button>
          </div>
        )}
      </div>

      {creating && (
        <div className="bg-surface border border-rule p-6 rounded-lg shadow-sm enter">
          <h2 className="text-[16px] font-semibold text-ink mb-4">Create new virtual key</h2>
          <form onSubmit={create} className="flex flex-col gap-4 max-w-md">
            <Field
              label="Key name or owner"
              value={newName}
              onChange={setNewName}
              placeholder="e.g. Production Backend Service"
              required
            />
            {createError && <p className="text-[14px] text-error font-medium">{createError}</p>}
            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? 'Creating…' : 'Save and generate'}
              </Button>
              <Button type="button" onClick={() => { setCreating(false); setNewName(''); setCreateError(null); }}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {revealed && (
        <div className="bg-surface border border-accent p-6 rounded-lg shadow-md enter relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-accent" />
          <h2 className="text-[16px] font-semibold text-ink mb-2">Save your new API key</h2>
          <p className="text-[14px] text-ink-soft mb-4">
            This secret token will never be shown again. Copy it now and store it securely in your environment variables.
          </p>
          <div className="flex items-center gap-3 bg-surface-2 p-3 border border-rule rounded font-mono text-[14px] text-ink select-all">
            <span className="flex-1 truncate">{revealed}</span>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(revealed);
                alert('Copied to clipboard');
              }}
              className="px-3 py-1.5 bg-accent text-paper text-[13px] font-medium rounded hover:opacity-90 transition-opacity shrink-0"
            >
              Copy key
            </button>
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={() => setRevealed(null)}>I have stored this key safely</Button>
          </div>
        </div>
      )}

      <Panel title="Active keys">
        {keys === null ? (
          <Loading rows={3} />
        ) : error !== null ? (
          <ErrorState message={error} onRetry={load} />
        ) : keys.length === 0 ? (
          <Empty
            title="No API keys provisioned"
            body="Create your first gateway virtual key to start routing requests through Conduit."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                Create API key
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-rule-soft text-[13px] text-ink-soft font-medium">
                  <th className="py-3 px-5">Name</th>
                  <th className="py-3 px-5">Prefix</th>
                  <th className="py-3 px-5">Created</th>
                  <th className="py-3 px-5">Last used</th>
                  <th className="py-3 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule-soft text-[14px]">
                {keys.map((k) => (
                  <tr key={k.id} className="hover:bg-surface-2/50 transition-colors duration-150">
                    <td className="py-3.5 px-5 font-medium text-ink">{k.name}</td>
                    <td className="py-3.5 px-5 font-mono text-ink-soft">{k.prefix}…</td>
                    <td className="py-3.5 px-5 text-ink-soft">{formatDateTime(k.created_at)}</td>
                    <td className="py-3.5 px-5 text-ink-soft">
                      {k.last_used_at ? formatDateTime(k.last_used_at) : <span className="text-ink-faint">Never</span>}
                    </td>
                    <td className="py-3.5 px-5 text-right">
                      <Button variant="danger" onClick={() => revoke(k.id)}>
                        Revoke
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}