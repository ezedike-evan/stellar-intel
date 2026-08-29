'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Dispute } from '@/app/api/admin/disputes/route';

type ActionState = 'idle' | 'loading' | 'error';

export default function AdminDisputesPage() {
  const [adminKey, setAdminKey] = useState('');
  const [inputKey, setInputKey] = useState('');
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [fetchState, setFetchState] = useState<ActionState>('idle');
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  const [errorMsg, setErrorMsg] = useState('');

  const fetchDisputes = useCallback(async (key: string) => {
    setFetchState('loading');
    setErrorMsg('');
    try {
      const res = await fetch('/api/admin/disputes', {
        headers: { 'x-admin-key': key },
      });
      if (res.status === 401) {
        setErrorMsg('Invalid admin key.');
        setAdminKey('');
        setFetchState('error');
        return;
      }
      if (!res.ok) throw new Error('Failed to load disputes');
      const data: Dispute[] = await res.json();
      setDisputes(data);
      setFetchState('idle');
    } catch {
      setErrorMsg('Could not load disputes. Check your connection.');
      setFetchState('error');
    }
  }, []);

  useEffect(() => {
    if (adminKey) fetchDisputes(adminKey);
  }, [adminKey, fetchDisputes]);

  async function handleAction(id: string, action: 'accept' | 'reject') {
    setActionStates((s) => ({ ...s, [id]: 'loading' }));
    try {
      const res = await fetch('/api/admin/disputes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-key': adminKey,
        },
        body: JSON.stringify({ id, action }),
      });
      if (!res.ok) throw new Error('Action failed');
      const updated: Dispute = await res.json();
      setDisputes((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      setActionStates((s) => ({ ...s, [id]: 'idle' }));
    } catch {
      setActionStates((s) => ({ ...s, [id]: 'error' }));
    }
  }

  if (!adminKey) {
    return (
      <div className="mx-auto max-w-sm py-16">
        <h1 className="mb-6 text-xl font-semibold text-primary-text">Admin login</h1>
        {errorMsg && <p className="mb-4 text-sm text-status-down">{errorMsg}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setAdminKey(inputKey);
          }}
          className="flex flex-col gap-3"
        >
          <input
            type="password"
            value={inputKey}
            onChange={(e) => setInputKey(e.target.value)}
            placeholder="Admin key"
            required
            className="rounded-lg border border-control-border bg-bg-subtle px-3 py-2 text-sm text-primary-text placeholder:text-secondary-text focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <button
            type="submit"
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-background transition-colors hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-accent"
          >
            Continue
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="py-8">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Dispute queue</h2>
        <button
          onClick={() => fetchDisputes(adminKey)}
          disabled={fetchState === 'loading'}
          className="rounded-lg border border-control-border px-3 py-1.5 text-xs font-medium text-secondary-text transition-colors hover:bg-bg-sunken disabled:opacity-50 dark:hover:bg-bg-sunken"
        >
          {fetchState === 'loading' ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {errorMsg && <p className="mb-4 text-sm text-status-down">{errorMsg}</p>}

      {disputes.length === 0 && fetchState === 'idle' && (
        <p className="text-sm text-fg-muted">No disputes in the queue.</p>
      )}

      <ul className="flex flex-col gap-3">
        {disputes.map((d) => (
          <li key={d.id} className="rounded-xl border border-border bg-bg-subtle p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-primary-text">
                    {d.anchorId}
                  </span>
                  <StatusBadge status={d.status} />
                </div>
                <p className="mt-1 text-sm text-secondary-text">{d.reason}</p>
                <p className="mt-1 text-xs text-secondary-text">
                  {d.submittedBy} · {new Date(d.createdAt).toLocaleString()}
                </p>
              </div>
              {d.status === 'pending' && (
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => handleAction(d.id, 'accept')}
                    disabled={actionStates[d.id] === 'loading'}
                    className="rounded-lg bg-status-up px-3 py-1.5 text-xs font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => handleAction(d.id, 'reject')}
                    disabled={actionStates[d.id] === 'loading'}
                    className="rounded-lg bg-status-down px-3 py-1.5 text-xs font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusBadge({ status }: { status: Dispute['status'] }) {
  const styles = {
    pending: 'bg-bg-sunken text-status-unknown  ',
    accepted: 'bg-accent-subtle text-status-up  ',
    rejected: 'bg-bg-sunken text-status-down  ',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}
