'use client';

import { useEffect, useState } from 'react';
import { ANCHORS } from '@/constants/anchors';
import {
  listTrackedIntents,
  TRACKED_INTENTS_MAX,
  type TrackedIntent,
} from '@/lib/refunds/local-history';
import type { PublicRefundCase, RefundCaseStatus } from '@/lib/refunds/store';

interface TrackedRefund {
  intent: TrackedIntent;
  cases: PublicRefundCase[];
}

const STATUS_LABELS: Record<RefundCaseStatus, string> = {
  owed: 'Owed',
  refunded: 'Refunded',
  acknowledged: 'Acknowledged',
};

const STATUS_CLASSES: Record<RefundCaseStatus, string> = {
  owed: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  refunded: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  acknowledged: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
};

function anchorName(anchorId: string): string {
  return ANCHORS.find((a) => a.id === anchorId)?.name ?? anchorId;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

async function fetchCases(intent: TrackedIntent): Promise<TrackedRefund> {
  const res = await fetch(`/api/refunds/${encodeURIComponent(intent.intentHash)}`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`refund lookup failed: ${res.status}`);
  const body = (await res.json()) as { cases?: PublicRefundCase[] };
  return { intent, cases: Array.isArray(body.cases) ? body.cases : [] };
}

/**
 * Lists the refunds tracked for the intents this browser started (#2123). There is
 * no server-side history by account, so each remembered intent is looked up on its own.
 */
export function RefundsPanel() {
  const [rows, setRows] = useState<TrackedRefund[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const intents = listTrackedIntents().slice(0, TRACKED_INTENTS_MAX);

    Promise.allSettled(intents.map(fetchCases)).then((results) => {
      if (cancelled) return;
      setRows(
        results
          .filter((r): r is PromiseFulfilledResult<TrackedRefund> => r.status === 'fulfilled')
          .map((r) => r.value)
          .filter((r) => r.cases.length > 0)
      );
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (rows === null) {
    return <p className="text-sm text-fg-muted">Loading refunds…</p>;
  }

  if (rows.length === 0) {
    return <p className="text-sm text-fg-muted">No refunds tracked in this browser.</p>;
  }

  return (
    <ul className="divide-y divide-border rounded-lg border border-border text-left">
      {rows.flatMap(({ cases }) =>
        cases.map((c) => (
          <li key={c.id} className="px-4 py-3 text-sm" data-testid="refund-row">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-primary-text">{anchorName(c.anchorId)}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[c.status]}`}
              >
                {STATUS_LABELS[c.status]}
              </span>
            </div>
            <dl className="mt-1 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-fg-muted">Opened</dt>
                <dd className="text-primary-text">{formatDate(c.openedAt)}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">Amount paid</dt>
                <dd className="text-primary-text">{c.amountPaid}</dd>
              </div>
              {c.amountRefunded !== null && (
                <div>
                  <dt className="text-fg-muted">Amount refunded</dt>
                  <dd className="text-primary-text">{c.amountRefunded}</dd>
                </div>
              )}
            </dl>
            {c.status === 'refunded' && (
              <p className="mt-2 text-xs text-fg-muted">
                Open the transfer&apos;s status page to confirm receipt
              </p>
            )}
          </li>
        ))
      )}
    </ul>
  );
}
