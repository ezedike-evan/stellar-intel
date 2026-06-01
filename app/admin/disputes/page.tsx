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
        <h1 className="mb-6 text-xl font-semibold text-gray-900 dark:text-white">Admin login</h1>
        {errorMsg && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{errorMsg}</p>}
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
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
          <button
            type="submit"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Dispute queue</h1>
        <button
          onClick={() => fetchDisputes(adminKey)}
          disabled={fetchState === 'loading'}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          {fetchState === 'loading' ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {errorMsg && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{errorMsg}</p>}

      {disputes.length === 0 && fetchState === 'idle' && (
        <p className="text-sm text-gray-500 dark:text-gray-400">No disputes in the queue.</p>
      )}

      <ul className="flex flex-col gap-3">
        {disputes.map((d) => (
          <li
            key={d.id}
            className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-gray-900 dark:text-white">
                    {d.anchorId}
                  </span>
                  <StatusBadge status={d.status} />
                </div>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{d.reason}</p>
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  {d.submittedBy} · {new Date(d.createdAt).toLocaleString()}
                </p>
              </div>
              {d.status === 'pending' && (
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => handleAction(d.id, 'accept')}
                    disabled={actionStates[d.id] === 'loading'}
                    className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => handleAction(d.id, 'reject')}
                    disabled={actionStates[d.id] === 'loading'}
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
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
    pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    accepted: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}
