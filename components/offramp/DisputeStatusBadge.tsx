'use client';

import useSWR from 'swr';
import Link from 'next/link';
import {
  DISPUTE_LEVEL_LABELS,
  type DisputeLevel,
  type DisputeCategory,
} from '@/lib/reputation/dispute-ladder';

interface DisputeSummary {
  ref: string;
  category: DisputeCategory;
  level: DisputeLevel;
  levelDeadline: string;
  status: 'open' | 'accepted' | 'rejected';
  createdAt: string;
  resolvedAt: string | null;
}

interface DisputeLookupResponse {
  disputes: DisputeSummary[];
}

const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error('Failed to fetch dispute status');
    return res.json() as Promise<DisputeLookupResponse>;
  });

function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export interface DisputeStatusBadgeProps {
  intentHash: string;
}

export function DisputeStatusBadge({ intentHash }: DisputeStatusBadgeProps) {
  const { data } = useSWR<DisputeLookupResponse>(
    intentHash ? `/api/reputation/dispute?intentHash=${intentHash}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      refreshInterval: 0,
    }
  );

  if (!data?.disputes || data.disputes.length === 0) {
    return null;
  }

  const newest = data.disputes[0];
  if (!newest) return null;

  if (newest.status === 'open') {
    const levelLabel = DISPUTE_LEVEL_LABELS[newest.level] ?? newest.level;
    const dueDate = formatDate(newest.levelDeadline);
    return (
      <div
        data-testid="dispute-status-badge"
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent-subtle/20 px-3 py-1.5 text-xs text-accent"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
        <span>
          Dispute open · {levelLabel} · decision due {dueDate}
        </span>
      </div>
    );
  }

  return (
    <div
      data-testid="dispute-status-badge"
      className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg-sunken px-3 py-1.5 text-xs text-secondary-text"
    >
      <span>
        Dispute {newest.status} · reference{' '}
        <Link
          href="/disputes"
          className="font-mono text-accent underline hover:text-accent"
        >
          {newest.ref}
        </Link>
      </span>
    </div>
  );
}
