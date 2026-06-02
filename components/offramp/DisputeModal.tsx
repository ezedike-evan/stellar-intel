'use client';

import { useState } from 'react';
import type { WithdrawStatusValue } from '@/types';

const DISPUTE_REASONS = [
  { value: 'wrong_amount', label: 'Wrong amount received' },
  { value: 'not_received', label: 'Funds not received' },
  { value: 'delayed', label: 'Unreasonable delay' },
  { value: 'wrong_account', label: 'Sent to wrong account' },
  { value: 'other', label: 'Other' },
] as const;

type DisputeReason = (typeof DISPUTE_REASONS)[number]['value'];

const DISPUTABLE_STATUSES: WithdrawStatusValue[] = ['completed', 'refunded', 'error'];

interface DisputeModalProps {
  transactionId: string;
  status: WithdrawStatusValue;
  onClose: () => void;
  onSubmit: (data: {
    transactionId: string;
    reason: DisputeReason;
    notes: string;
  }) => Promise<void>;
}

export function DisputeModal({ transactionId, status, onClose, onSubmit }: DisputeModalProps) {
  const [reason, setReason] = useState<DisputeReason | ''>('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!DISPUTABLE_STATUSES.includes(status)) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ transactionId, reason, notes });
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
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-700">
          <h2
            id="dispute-modal-title"
            className="text-base font-semibold text-gray-900 dark:text-white"
          >
            Flag Incorrect Outcome
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
            aria-label="Close"
          >
            <svg
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
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                <svg
                  className="h-6 w-6 text-green-600 dark:text-green-400"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">Dispute submitted</p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Your report has been queued for review. We&apos;ll follow up via your registered
                contact.
              </p>
              <button
                onClick={onClose}
                className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Close
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">Transaction</p>
                <p className="break-all font-mono text-xs text-gray-700 dark:text-gray-300">
                  {transactionId}
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Reason <span className="text-red-500">*</span>
                </label>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value as DisputeReason)}
                  required
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                >
                  <option value="">Select a reason…</option>
                  {DISPUTE_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Additional notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Describe what happened…"
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500"
                />
              </div>

              {error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/30 dark:text-red-400">
                  {error}
                </p>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!reason || submitting}
                  className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
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
