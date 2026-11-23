'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { WithdrawStatusValue } from '@/types';
import {
  DISPUTE_CATEGORIES,
  DISPUTE_CATEGORY_LABELS,
  type DisputeCategory,
} from '@/lib/reputation/dispute-ladder';

const DISPUTABLE_STATUSES: WithdrawStatusValue[] = ['completed', 'refunded', 'error'];

interface DisputeModalProps {
  transactionId: string;
  status: WithdrawStatusValue;
  onClose: () => void;
  onSubmit: (data: {
    transactionId: string;
    category: DisputeCategory;
    notes: string;
  }) => Promise<{ ref: string }>;
}

export function DisputeModal({ transactionId, status, onClose, onSubmit }: DisputeModalProps) {
  const [category, setCategory] = useState<DisputeCategory | ''>('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [ref, setRef] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!DISPUTABLE_STATUSES.includes(status)) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!category) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await onSubmit({ transactionId, category, notes });
      setRef(result.ref);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dispute-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl bg-bg-subtle">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 id="dispute-modal-title" className="text-base font-semibold text-primary-text">
            Flag Incorrect Outcome
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-secondary-text hover:bg-bg-sunken hover:text-secondary-text dark:hover:bg-bg-sunken"
            aria-label="Close"
          >
            <svg
              aria-hidden="true"
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5">
          {submitted ? (
            <div className="py-4 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent-subtle">
                <svg
                  aria-hidden="true"
                  className="h-6 w-6 text-status-up"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm font-medium text-primary-text">Dispute submitted</p>
              <p className="mt-1 text-xs text-fg-muted">Dispute filed. Reference: {ref}</p>
              <div className="mt-2">
                <Link href="/disputes" className="text-xs text-accent underline hover:text-accent">
                  Track it on the public dispute log
                </Link>
              </div>
              <button
                onClick={onClose}
                className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-background hover:opacity-90"
              >
                Close
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <p className="mb-1 text-xs text-fg-muted">Transaction</p>
                <p className="break-all font-mono text-xs text-secondary-text">{transactionId}</p>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-secondary-text">
                  Category <span className="text-status-down">*</span>
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as DisputeCategory)}
                  required
                  className="w-full rounded-lg border border-control-border bg-bg-subtle px-3 py-2 text-sm text-primary-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="">Select a category…</option>
                  {DISPUTE_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {DISPUTE_CATEGORY_LABELS[cat]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-secondary-text">
                  Additional notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Describe what happened…"
                  className="w-full rounded-lg border border-control-border bg-bg-subtle px-3 py-2 text-sm text-primary-text placeholder:text-secondary-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              {error && (
                <p className="rounded-lg bg-bg-sunken px-3 py-2 text-xs text-status-down">
                  {error}
                </p>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded-lg border border-control-border px-4 py-2 text-sm font-medium text-secondary-text hover:bg-bg-sunken dark:hover:bg-bg-sunken"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!category || submitting}
                  className="flex-1 rounded-lg bg-status-down px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? 'Submitting…' : 'Submit Dispute'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
