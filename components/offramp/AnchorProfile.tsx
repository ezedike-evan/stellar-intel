import Link from 'next/link';
import { STELLAR_EXPERT_URL } from '@/constants';
import type { Bucket } from '@/lib/reputation/buckets';

type DisputeItem = {
  id: string;
  createdAt: string;
  reason: string;
  status: 'open' | 'resolved';
};

type CorridorItem = {
  id: string;
  from: string;
  to: string;
  countryName: string;
};

export interface AnchorProfileData {
  id: string;
  name: string;
  homeDomain: string;
  score: number | null;
  sampleSize: number;
  corridors: CorridorItem[];
  history: Bucket[];
  disputes: DisputeItem[];
  oracleTxId: string | null;
}

function scoreToPercent(score: number | null): number | null {
  if (score === null) return null;
  return Math.round(Math.min(1, Math.max(0, score)) * 100);
}

function chartPoints(history: Bucket[]): string {
  if (history.length === 0) return '';

  const width = 560;
  const height = 200;
  const safeMax = 1;

  return history
    .map((bucket, index) => {
      const x = (index / Math.max(1, history.length - 1)) * width;
      const value = Math.min(safeMax, Math.max(0, bucket.avgScore));
      const y = height - value * height;
      return `${x},${y}`;
    })
    .join(' ');
}

export function AnchorProfile({ data }: { data: AnchorProfileData }) {
  const points = chartPoints(data.history);
  const percentage = scoreToPercent(data.score);

  return (
    <section className="space-y-8">
      <header className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900">
        <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Anchor Profile</p>
        <h1 className="mt-2 text-3xl font-semibold text-gray-900 dark:text-white">{data.name}</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{data.homeDomain}</p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <article className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900">
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-gray-500">Score</h2>
          <p
            className="mt-3 text-5xl font-bold text-blue-600 dark:text-blue-400"
            data-testid="anchor-score"
            aria-label="Anchor score"
          >
            {percentage === null ? 'N/A' : percentage}
          </p>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {percentage === null
              ? 'No completed outcomes are available yet for this anchor.'
              : `Based on the latest reliability window (${data.sampleSize} outcomes).`}
          </p>
        </article>

        <article className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900">
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-gray-500">
            Oracle Tx
          </h2>
          {data.oracleTxId ? (
            <a
              data-testid="anchor-oracle-link"
              href={`${STELLAR_EXPERT_URL}/tx/${data.oracleTxId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 font-mono text-sm text-blue-700 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300"
            >
              {data.oracleTxId.slice(0, 16)}...
            </a>
          ) : (
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
              No oracle transaction yet.
            </p>
          )}
        </article>
      </div>

      <article className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">History</h2>
          <span className="text-xs uppercase tracking-[0.16em] text-gray-500">30d</span>
        </div>
        {points ? (
          <svg
            data-testid="anchor-history-chart"
            viewBox="0 0 560 220"
            role="img"
            aria-label="Anchor history chart"
            className="h-56 w-full"
          >
            <defs>
              <linearGradient id="history-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(59,130,246,0.4)" />
                <stop offset="100%" stopColor="rgba(59,130,246,0.05)" />
              </linearGradient>
            </defs>
            <rect x="0" y="0" width="560" height="220" rx="12" fill="rgba(148,163,184,0.08)" />
            <polyline fill="none" stroke="rgb(59,130,246)" strokeWidth="3" points={points} />
            <polygon fill="url(#history-fill)" points={`0,200 ${points} 560,200`} opacity="0.7" />
          </svg>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No history yet for this anchor.
          </p>
        )}
      </article>

      <article className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Corridors</h2>
        <ul data-testid="anchor-corridors" className="mt-4 grid gap-3 sm:grid-cols-2">
          {data.corridors.map((corridor) => (
            <li
              key={corridor.id}
              className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
            >
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                {corridor.from}/{corridor.to}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{corridor.countryName}</p>
              <Link
                href={`/anchors?corridor=${corridor.id}`}
                className="mt-2 inline-block text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                View corridor leaderboard
              </Link>
            </li>
          ))}
        </ul>
      </article>

      <article className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Disputes</h2>
        {data.disputes.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">No disputes on record.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {data.disputes.map((dispute) => (
              <li
                key={dispute.id}
                className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-900 dark:text-white">
                    {dispute.reason}
                  </span>
                  <span
                    className={
                      dispute.status === 'open'
                        ? 'rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                        : 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                    }
                  >
                    {dispute.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {new Date(dispute.createdAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  );
}
