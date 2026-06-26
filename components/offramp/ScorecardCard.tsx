'use client';

import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  hasEnoughData,
  estimateTimeToThreshold,
  MIN_OUTCOMES_THRESHOLD,
} from '@/lib/reputation/thresholds';
import { Sparkline } from '@/components/ui/Sparkline';

type ReputationWindow = '7d' | '30d' | '90d';

interface ScorecardCardProps {
  anchorId: string;
  window: ReputationWindow;
  latestOracleTxHash?: string | undefined;
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

function toObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function scorecardKey(timeframe: ReputationWindow): string {
  return timeframe.replace('d', '');
}

function parseNestedScorecard(
  payload: Record<string, unknown>,
  timeframe: ReputationWindow
): ReputationMetrics | null {
  const scorecards = toObject(payload.scorecards);
  const scorecard = toObject(scorecards?.[scorecardKey(timeframe)]);
  if (!scorecard) return null;

  const settleMs = toObject(scorecard.settleMs);
  const settleP50Ms = toNumber(settleMs?.p50);
  const settleP95Ms = toNumber(settleMs?.p95);
  const slippage = toObject(scorecard.slippage);
  const slippageP50 = toNumber(slippage?.p50);
  const slippageP95 = toNumber(slippage?.p95);

  return {
    fillRate: toNumber(scorecard.fillRate),
    settleP50: settleP50Ms !== null ? Math.round(settleP50Ms / 1000) : null,
    settleP95: settleP95Ms !== null ? Math.round(settleP95Ms / 1000) : null,
    slippageP50: slippageP50 !== null ? slippageP50 * 100 : null,
    slippageP95: slippageP95 !== null ? slippageP95 * 100 : null,
    outcomesCount: toNumber(scorecard.sampleSize) ?? 0,
  };
}

function parseReputationResponse(body: unknown, timeframe: ReputationWindow): ReputationMetrics {
  const payload = toObject(body) ?? {};
  const nestedMetrics = parseNestedScorecard(payload, timeframe);
  if (nestedMetrics) return nestedMetrics;

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

const STELLAR_EXPERT_TX_BASE = 'https://stellar.expert/explorer/public/tx';

export function ScorecardCard({
  anchorId,
  window: timeframe,
  latestOracleTxHash,
}: ScorecardCardProps) {
  const [metrics, setMetrics] = useState<ReputationMetrics>(emptyMetrics);
  const [historyData, setHistoryData] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    setIsLoading(true);
    setError(null);
    setMetrics(emptyMetrics);
    setHistoryData([]);

    fetch(`/api/reputation/${encodeURIComponent(anchorId)}?window=${encodeURIComponent(timeframe)}`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load reputation data (${response.status})`);
        }

        return response.json();
      })
      .then((body) => {
        if (!isActive) return;
        setMetrics(parseReputationResponse(body, timeframe));
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

    fetch(`/api/reputation/${encodeURIComponent(anchorId)}/history?window=30d`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load history data (${response.status})`);
        }
        return response.json();
      })
      .then((body) => {
        if (!isActive || !body) return;
        const buckets = (body.buckets || []) as Array<{ settlementLatencyMs: number | null }>;
        let lastVal = 0;
        const dataPoints = buckets.map((b) => {
          if (b.settlementLatencyMs !== null) {
            lastVal = b.settlementLatencyMs / 1000;
          }
          return lastVal;
        });
        setHistoryData(dataPoints);
      })
      .catch(() => {
        // Silently catch history errors to keep scorecard functional
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
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Anchor reputation</p>
          {latestOracleTxHash && (
            <a
              href={`${STELLAR_EXPERT_TX_BASE}/${latestOracleTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View latest oracle transaction on stellar.expert"
              className="text-gray-400 hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400 transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
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
              {historyData.length > 0 && (
                <div
                  className="pt-2 flex justify-center border-t border-gray-200 dark:border-gray-800"
                  data-testid="scorecard-sparkline"
                >
                  <Sparkline data={historyData} />
                </div>
              )}
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
