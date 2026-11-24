'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Dispute } from '@/lib/reputation/disputes';
import {
  DISPUTE_CATEGORY_LABELS,
  DISPUTE_LEVEL_LABELS,
  isOverdue,
  nextLevel,
} from '@/lib/reputation/dispute-ladder';

type ActionState = 'idle' | 'loading' | 'error';

export default function AdminDisputesPage() {
  const [adminKey, setAdminKey] = useState('');
  const [inputKey, setInputKey] = useState('');
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [fetchState, setFetchState] = useState<ActionState>('idle');
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [rationales, setRationales] = useState<Record<string, string>>({});
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

  async function handleAction(id: string, action: 'accept' | 'reject' | 'escalate') {
    setActionStates((s) => ({ ...s, [id]: 'loading' }));
    setActionErrors((e) => ({ ...e, [id]: '' }));
    const rationale = rationales[id] ?? '';
    try {
      const res = await fetch('/api/admin/disputes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-key': adminKey,
        },
        body: JSON.stringify({ id, action, rationale }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const msg =
          errorData && typeof errorData === 'object' && errorData.message
            ? String(errorData.message)
            : 'Action failed';
        setActionErrors((e) => ({ ...e, [id]: msg }));
        setActionStates((s) => ({ ...s, [id]: 'error' }));
        return;
      }
      const updated: Dispute = await res.json();
      setDisputes((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      setActionStates((s) => ({ ...s, [id]: 'idle' }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Action failed';
      setActionErrors((e) => ({ ...e, [id]: msg }));
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
        <h1 className="text-xl font-semibold text-primary-text">Dispute queue</h1>
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
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium text-primary-text">
                    {d.anchorId}
                  </span>
                  <StatusBadge status={d.status} />
                  <span className="rounded bg-bg-sunken px-2 py-0.5 text-xs text-secondary-text">
                    {DISPUTE_CATEGORY_LABELS[d.category] ?? d.category}
                  </span>
                  <span className="rounded bg-bg-sunken px-2 py-0.5 text-xs text-secondary-text">
                    {DISPUTE_LEVEL_LABELS[d.level] ?? d.level}
                  </span>
                  {isOverdue(d) && (
                    <span className="rounded bg-status-down/10 px-2 py-0.5 text-xs font-medium text-status-down">
                      Overdue
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-secondary-text">{d.reason}</p>
                <p className="mt-1 text-xs text-secondary-text">
                  {d.publicKey} · {new Date(d.createdAt).toLocaleString()} · Due{' '}
                  {new Date(d.levelDeadline).toLocaleString()}
                </p>
                {d.status === 'open' && (
                  <div className="mt-3 flex flex-col gap-1">
                    <label
                      htmlFor={`rationale-${d.id}`}
                      className="text-xs font-medium text-primary-text"
                    >
                      Public rationale
                    </label>
                    <p className="text-xs text-secondary-text">
                      Published on the public dispute log. Do not include names, account numbers,
                      emails or wallet addresses.
                    </p>
                    <textarea
                      id={`rationale-${d.id}`}
                      maxLength={500}
                      value={rationales[d.id] ?? ''}
                      onChange={(e) =>
                        setRationales((prev) => ({ ...prev, [d.id]: e.target.value }))
                      }
                      rows={2}
                      className="rounded-lg border border-control-border bg-bg-sunken px-3 py-1.5 text-xs text-primary-text focus:outline-none focus:ring-2 focus:ring-accent"
                      placeholder="Explain the public basis for this decision"
                    />
                    <div className="flex justify-end text-xs text-secondary-text">
                      {(rationales[d.id] ?? '').length}/500
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {nextLevel(d.level) === 'review' && (
                        <button
                          onClick={() => handleAction(d.id, 'escalate')}
                          disabled={actionStates[d.id] === 'loading'}
                          className="rounded-lg border border-control-border px-3 py-1.5 text-xs font-medium text-primary-text transition-colors hover:bg-bg-sunken disabled:opacity-50"
                        >
                          Escalate to {DISPUTE_LEVEL_LABELS['review']}
                        </button>
                      )}
                      <button
                        onClick={() => handleAction(d.id, 'accept')}
                        disabled={
                          actionStates[d.id] === 'loading' || !(rationales[d.id] ?? '').trim()
                        }
                        className="rounded-lg bg-status-up px-3 py-1.5 text-xs font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => handleAction(d.id, 'reject')}
                        disabled={
                          actionStates[d.id] === 'loading' || !(rationales[d.id] ?? '').trim()
                        }
                        className="rounded-lg bg-status-down px-3 py-1.5 text-xs font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                )}
                {actionErrors[d.id] && (
                  <p className="mt-2 text-xs text-status-down">{actionErrors[d.id]}</p>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusBadge({ status }: { status: Dispute['status'] }) {
  const styles = {
    open: 'bg-bg-sunken text-status-unknown',
    accepted: 'bg-accent-subtle text-status-up',
    rejected: 'bg-bg-sunken text-status-down',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}
