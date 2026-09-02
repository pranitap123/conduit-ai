import { useCallback, useEffect, useState } from 'react';
import { api, type ApiKeyRow } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { Button, Empty, ErrorState, Field, Loading, Panel, Pill } from '../components/primitives';

export function Keys() {
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.keys().then(setKeys).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] font-semibold tracking-tight">API keys</h1>
        <Button variant="primary" onClick={() => setCreating(true)}>Create key</Button>
      </div>

      <p className="text-[13px] text-ink-soft max-w-prose">
        A key authenticates requests to <code className="figure text-[12px]">/v1/chat/completions</code>.
        Only a hash is stored, so a key is shown once and cannot be recovered afterwards.
      </p>

      <Panel>
        {error !== null ? <ErrorState message={error} onRetry={load} />
          : keys === null ? <Loading rows={4} />
          : keys.length === 0 ? (
            <Empty
              title="No keys yet"
              body="Create a key to start sending traffic through the gateway."
              action={<Button variant="primary" onClick={() => setCreating(true)}>Create key</Button>}
            />
          ) : <KeyTable keys={keys} onRevoked={load} />}
      </Panel>

      {creating && (
        <CreateDialog
          onClose={() => setCreating(false)}
          onCreated={(plaintext) => { setCreating(false); setRevealed(plaintext); load(); }}
        />
      )}

      {revealed !== null && <RevealDialog plaintext={revealed} onClose={() => setRevealed(null)} />}
    </div>
  );
}

function KeyTable({ keys, onRevoked }: { keys: ApiKeyRow[]; onRevoked: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);

  const revoke = async (k: ApiKeyRow): Promise<void> => {
    // Irreversible and immediate. Confirm before, not a toast after.
    if (!window.confirm(`Revoke "${k.name}"? Requests using it will start failing straight away.`)) return;
    setBusy(k.id);
    await api.revokeKey(k.id).catch(() => undefined);
    setBusy(null);
    onRevoked();
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <caption className="sr-only">API keys in this organization</caption>
        <thead>
          <tr className="text-ink-soft border-b border-rule-soft">
            <th scope="col" className="text-left font-medium px-4 py-2">Name</th>
            <th scope="col" className="text-left font-medium px-4 py-2">Key</th>
            <th scope="col" className="text-left font-medium px-4 py-2 hidden md:table-cell">Project</th>
            <th scope="col" className="text-left font-medium px-4 py-2 hidden sm:table-cell">Last used</th>
            <th scope="col" className="text-left font-medium px-4 py-2">Status</th>
            <th scope="col" className="px-4 py-2"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const revoked = k.revoked_at !== null;
            return (
              <tr key={k.id} className="border-b border-rule-soft last:border-0">
                <td className="px-4 py-2 font-medium">{k.name}</td>
                <td className="px-4 py-2 figure text-[12px] text-ink-soft whitespace-nowrap">
                  tg_live_{k.prefix}…{k.last4}
                </td>
                <td className="px-4 py-2 text-ink-soft hidden md:table-cell">{k.project_name}</td>
                <td className="px-4 py-2 text-ink-soft hidden sm:table-cell whitespace-nowrap">
                  {k.last_used_at === null ? 'Never' : formatDateTime(k.last_used_at)}
                </td>
                <td className="px-4 py-2">
                  {revoked ? <Pill tone="bad">Revoked</Pill> : <Pill tone="ok">Active</Pill>}
                </td>
                <td className="px-4 py-2 text-right">
                  {!revoked && (
                    <Button variant="danger" disabled={busy === k.id} onClick={() => void revoke(k)}>
                      {busy === k.id ? 'Revoking' : 'Revoke'}
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Dialog({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-ink/25" />
      <div className="relative w-full max-w-md bg-surface border border-rule enter">
        <header className="h-12 px-4 flex items-center border-b border-rule">
          <h2 className="text-[14px] font-semibold">{title}</h2>
        </header>
        {children}
      </div>
    </div>
  );
}

function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (plaintext: string) => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    if (name.trim() === '') { setError('Give the key a name so you can recognise it later.'); return; }
    setBusy(true); setError(null);
    try {
      const created = await api.createKey(name.trim());
      onCreated(created.plaintext);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog title="Create API key">
      <div className="p-4 flex flex-col gap-4">
        <Field
          label="Name" value={name} onChange={setName}
          placeholder="production-backend"
          hint="Shown in the request explorer so you can tell traffic sources apart."
        />
        {error !== null && <p className="text-[13px] text-error" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Creating' : 'Create key'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function RevealDialog({ plaintext, onClose }: { plaintext: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog title="Copy your key now">
      <div className="p-4 flex flex-col gap-3">
        <p className="text-[13px] text-ink-soft">
          This is the only time the key is shown. Only its hash is stored, so it cannot be
          shown again — if you lose it, revoke it and create another.
        </p>
        <code className="figure text-[12px] p-3 bg-surface-2 border border-rule break-all select-all">
          {plaintext}
        </code>
        <div className="flex justify-end gap-2">
          <Button onClick={() => {
            void navigator.clipboard.writeText(plaintext).then(() => setCopied(true));
          }}>
            {copied ? 'Copied' : 'Copy key'}
          </Button>
          <Button variant="primary" onClick={onClose}>Done</Button>
        </div>
      </div>
    </Dialog>
  );
}
