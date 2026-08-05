'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { DISCLAIMER_SENTENCES, TERMS_HREF } from '@/lib/legal';

interface ConsentModalProps {
  open: boolean;
  onAccept: () => void;
  onCancel: () => void;
}

/**
 * One-time Terms acknowledgment shown before a wallet's first execution (#741).
 *
 * The checkbox is required rather than a single "I agree" button, so accepting
 * is a deliberate act and not the same motion as dismissing a dialog. The
 * confirm button stays disabled until it is ticked.
 */
export function ConsentModal({ open, onAccept, onCancel }: ConsentModalProps) {
  const [checked, setChecked] = useState(false);
  const checkboxRef = useRef<HTMLInputElement>(null);

  // Reset on each open: a previous session's tick must not carry over into a
  // fresh prompt.
  useEffect(() => {
    if (open) {
      setChecked(false);
      checkboxRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900">
        <h2 id="consent-title" className="text-lg font-semibold text-gray-900 dark:text-white">
          Before you continue
        </h2>

        <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-300">
          {DISCLAIMER_SENTENCES.map((sentence) => (
            <li key={sentence}>{sentence}</li>
          ))}
        </ul>

        <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input
            ref={checkboxRef}
            type="checkbox"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-control-border"
          />
          <span>
            I have read and accept the{' '}
            <Link href={TERMS_HREF} className="underline underline-offset-2">
              Terms
            </Link>
            .
          </span>
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onAccept}
            disabled={!checked}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Accept and continue
          </button>
        </div>
      </div>
    </div>
  );
}
