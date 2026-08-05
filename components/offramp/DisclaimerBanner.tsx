'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { DISCLAIMER_TEXT, TERMS_HREF } from '@/lib/legal';

const STORAGE_KEY = 'offramp-disclaimer-dismissed-at';
const REAPPEAR_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export function DisclaimerBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const dismissedAt = localStorage.getItem(STORAGE_KEY);
      const dismissedRecently =
        dismissedAt !== null && Date.now() - Number(dismissedAt) < REAPPEAR_AFTER_MS;
      setVisible(!dismissedRecently);
    } catch {
      // localStorage unavailable (private browsing) — default to showing it.
      setVisible(true);
    }
  }, []);

  function handleDismiss() {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      // Best-effort — the banner just reappears next visit if this fails.
    }
  }

  if (!visible) return null;

  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400">
      <p>
        {DISCLAIMER_TEXT}{' '}
        <Link
          href={TERMS_HREF}
          className="underline underline-offset-2 hover:text-gray-900 dark:hover:text-gray-200"
        >
          Terms
        </Link>
      </p>
      <button
        onClick={handleDismiss}
        aria-label="Dismiss disclaimer"
        className="flex-shrink-0 rounded p-0.5 text-secondary-text hover:text-gray-600 dark:hover:text-gray-200"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );
}
