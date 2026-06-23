'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  hasEnoughData,
  estimateTimeToThreshold,
  MIN_OUTCOMES_THRESHOLD,
} from '@/lib/reputation/thresholds';

type ReputationWindow = '7d' | '30d' | '90d';

interface ScorecardCardProps {
  anchorId: string;
  window: ReputationWindow;
}

interface ReputationMetrics {
  fillRate: number | null;
  settleP50: number | null;
  settleP95: number | null;
  slippageP50: number | null;
  slippageP95: number | null;
  outcomesCount: number;
}

const emptyMetrics: ReputationMetrics = {
  fillRate: null,
  settleP50: null,
  settleP95: null,
  slippageP50: null,
  slippageP95: null,
  outcomesCount: 0,
};

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseReputationResponse(body: unknown): ReputationMetrics {
  const payload = (body ?? {}) as Record<string, unknown>;

  return {
    fillRate:
      toNumber(payload.fill_rate ?? payload.fillRate) ??
      toNumber(payload.fill_rate_percent ?? payload.fillRatePercent) ??
      null,
    settleP50:
      toNumber(
        payload.settle_p50 ?? payload.settleP50 ?? payload.settlement_p50 ?? payload.settlementP50
      ) ?? null,
    settleP95:
      toNumber(
        payload.settle_p95 ?? payload.settleP95 ?? payload.settlement_p95 ?? payload.settlementP95
      ) ?? null,
    slippageP50:
      toNumber(
        payload.slippage_p50 ??
          payload.slippageP50 ??
          payload.slippage_p50_percent ??
          payload.slippageP50Percent
      ) ?? null,
    slippageP95:
      toNumber(
        payload.slippage_p95 ??
          payload.slippageP95 ??
          payload.slippage_p95_percent ??
          payload.slippageP95Percent
      ) ?? null,
    outcomesCount: toNumber(payload.outcomes_count ?? payload.outcomesCount) ?? 0,
  };
}

function formatFillRate(value: number | null): string {
  if (value === null) {
    return '—';
  }

  const percent = value > 0 && value <= 1 ? value * 100 : value;
  return `${new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  }).format(percent)}%`;
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return '—';
  }

  return `${new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value)}%`;
}

function formatSeconds(value: number | null): string {
  if (value === null) {
    return '—';
  }

  return `${new Intl.NumberFormat('en-US', {
    maximumFractionDigits: value < 10 ? 1 : 0,
    minimumFractionDigits: 0,
  }).format(value)}s`;
}

function hasReputationMetrics(metrics: ReputationMetrics): boolean {
  return (
    metrics.fillRate !== null ||
    metrics.settleP50 !== null ||
    metrics.settleP95 !== null ||
    metrics.slippageP50 !== null ||
    metrics.slippageP95 !== null
  );
}

export function ScorecardCard({ anchorId, window: timeframe }: ScorecardCardProps) {
  const [metrics, setMetrics] = useState<ReputationMetrics>(emptyMetrics);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    setIsLoading(true);
    setError(null);
    setMetrics(emptyMetrics);

    fetch(`/api/reputation/${encodeURIComponent(anchorId)}?window=${encodeURIComponent(timeframe)}`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load reputation data (${response.status})`);
        }

        return response.json();
      })
      .then((body) => {
        if (!isActive) return;
        setMetrics(parseReputationResponse(body));
      })
      .catch((fetchError) => {
        if (!isActive) return;
        setError(
          fetchError instanceof Error ? fetchError.message : 'Unable to load reputation data'
        );
      })
      .finally(() => {
        if (isActive) {
          setIsLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [anchorId, timeframe]);

  const enoughData = hasEnoughData(metrics.outcomesCount);
  const remaining = MIN_OUTCOMES_THRESHOLD - metrics.outcomesCount;

  return (
    <Card className="space-y-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Anchor reputation</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">Window: {timeframe}</p>
      </div>

      {isLoading ? (
        <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
          <Skeleton rows={3} />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/20 dark:text-red-300">
          {error}
        </div>
      ) : !hasReputationMetrics(metrics) ? (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-300">
          No reputation metrics available for this anchor.
        </div>
      ) : !enoughData ? (
        <div className="flex flex-col items-center justify-center py-10 px-4 text-center border rounded-xl bg-gray-50/50 dark:bg-gray-800/30 border-gray-200 dark:border-gray-700">
          <div className="w-12 h-12 mb-4 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-blue-500 dark:text-blue-400">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
            Collecting Data
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm mb-5">
            We are still evaluating {anchorId}. We need <strong>{remaining}</strong> more outcome
            {remaining !== 1 ? 's' : ''} to generate a reliable, statistically significant
            reputation score.
          </p>
          <div className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-200/70 rounded-full dark:bg-gray-700 dark:text-gray-300">
            Expected scorecard generation: {estimateTimeToThreshold(metrics.outcomesCount)}
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/60">
            <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Fill rate
            </dt>
            <dd className="mt-3 text-2xl font-semibold text-gray-900 dark:text-white">
              {formatFillRate(metrics.fillRate)}
            </dd>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/60">
            <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Settle
            </dt>
            <dd className="mt-3 space-y-2 text-sm text-gray-900 dark:text-gray-100">
              <div className="flex items-center justify-between">
                <span className="text-gray-500 dark:text-gray-400">p50</span>
                <span>{formatSeconds(metrics.settleP50)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500 dark:text-gray-400">p95</span>
                <span>{formatSeconds(metrics.settleP95)}</span>
              </div>
            </dd>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/60">
            <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Slippage
            </dt>
            <dd className="mt-3 space-y-2 text-sm text-gray-900 dark:text-gray-100">
              <div className="flex items-center justify-between">
                <span className="text-gray-500 dark:text-gray-400">p50</span>
                <span>{formatPercent(metrics.slippageP50)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500 dark:text-gray-400">p95</span>
                <span>{formatPercent(metrics.slippageP95)}</span>
              </div>
            </dd>
          </div>
        </div>
      )}
    </Card>
  );
}
