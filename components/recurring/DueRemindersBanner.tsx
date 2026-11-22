'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { loadRecurringIds } from '@/lib/recurring/client';
import type { DueReminder } from '@/lib/recurring/due';

interface DueRemindersBannerProps {
  currentAuthId?: string | undefined;
}

export function DueRemindersBanner({ currentAuthId }: DueRemindersBannerProps) {
  const [reminders, setReminders] = useState<DueReminder[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [dismissed, setDismissed] = useState<boolean>(false);

  useEffect(() => {
    const ids = loadRecurringIds();
    if (ids.length === 0) {
      setLoading(false);
      return;
    }

    let active = true;
    async function fetchDue() {
      try {
        const res = await fetch(`/api/recurring/due?ids=${encodeURIComponent(ids.join(','))}`);
        if (!res.ok) return;
        const data = await res.json();
        if (active && Array.isArray(data.reminders)) {
          const dueList = data.reminders.filter(
            (r: DueReminder) => r.due && (!currentAuthId || r.authorizationId !== currentAuthId)
          );
          setReminders(dueList);
        }
      } catch {
        // silently fallback
      } finally {
        if (active) setLoading(false);
      }
    }

    fetchDue();
    return () => {
      active = false;
    };
  }, [currentAuthId]);

  if (dismissed || loading || reminders.length === 0) {
    return null;
  }

  return (
    <aside
      role="region"
      aria-label="Standing order reminders"
      className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-amber-200"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 text-lg" aria-hidden="true">
            ⏰
          </span>
          <div>
            <h4 className="font-semibold text-amber-100">
              You have {reminders.length} standing payment{reminders.length > 1 ? 's' : ''} due
            </h4>
            <ul className="mt-2 space-y-1 text-sm">
              {reminders.map((r) => (
                <li key={r.authorizationId} className="flex items-center gap-2">
                  <span>
                    {r.amount} {r.sourceAsset} → {r.destinationAsset} ({r.corridorId})
                  </span>
                  <Link
                    href={`/offramp?recurring=1&authId=${encodeURIComponent(r.authorizationId)}&corridorId=${encodeURIComponent(r.corridorId)}&amount=${encodeURIComponent(r.amount)}&sourceAsset=${encodeURIComponent(r.sourceAsset)}&destinationAsset=${encodeURIComponent(r.destinationAsset)}&remainingCap=${encodeURIComponent(r.remainingCap)}`}
                    className="font-medium underline hover:text-amber-50"
                  >
                    Execute now
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-sm text-amber-300 hover:text-amber-100"
          aria-label="Dismiss reminder"
        >
          ✕
        </button>
      </div>
    </aside>
  );
}
