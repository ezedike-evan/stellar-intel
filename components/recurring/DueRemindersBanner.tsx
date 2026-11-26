'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { loadRecurringIds } from '@/lib/recurring/client';
import type { DueReminder } from '@/lib/recurring/due';

/** The pre-filled, allowlist-limited off-ramp for one due reminder (REC011). */
export function reminderHref(r: DueReminder): string {
  const sp = new URLSearchParams({
    corridor: r.corridorId,
    amount: r.amount,
    recurring: r.authorizationId,
    cycle: String(r.cycleNumber),
  });
  return `/offramp?${sp.toString()}`;
}

/**
 * Lists the standing-order payments that are due now for the orders this
 * browser created. Fetches once on mount and renders nothing when there are no
 * stored ids, nothing is due, or the request fails.
 */
export function DueRemindersBanner() {
  const [reminders, setReminders] = useState<DueReminder[]>([]);

  useEffect(() => {
    // The due route accepts at most 20 ids per request.
    const ids = loadRecurringIds().slice(0, 20);
    if (ids.length === 0) return;

    let active = true;
    fetch(`/api/recurring/due?ids=${ids.map(encodeURIComponent).join(',')}`)
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { reminders?: unknown };
        if (active && Array.isArray(data.reminders)) {
          setReminders(data.reminders as DueReminder[]);
        }
      })
      .catch(() => {
        // A reminder is a convenience: on any failure, show nothing.
      });
    return () => {
      active = false;
    };
  }, []);

  if (reminders.length === 0) return null;

  return (
    <section
      aria-label="Standing order payments due"
      className="rounded-xl border border-border bg-bg-sunken px-4 py-3 text-sm"
    >
      <h2 className="font-medium text-primary-text">
        {reminders.length === 1
          ? 'A standing order payment is due'
          : `${reminders.length} standing order payments are due`}
      </h2>
      <ul className="mt-2 space-y-1.5">
        {reminders.map((r) => (
          <li
            key={`${r.authorizationId}-${r.cycleNumber}`}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
          >
            <span className="text-secondary-text">
              {r.amount} {r.sourceAsset} → {r.destinationAsset} is due
            </span>
            <Link
              href={reminderHref(r)}
              className="font-medium text-accent underline underline-offset-2 hover:opacity-80"
            >
              Pay now
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
