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
import {
  calculateFreshness,
  formatDrift,
  getFreshnessLabel,
  getFreshnessBadgeColor,
  type FreshnessResult,
} from '@/lib/oracle/freshness';
import { ANCHORS } from '@/constants';
import type { AnchorMetadata } from '@/types';
import { Tooltip } from '@/components/ui/Tooltip';
import { composite, NORM_SETTLE_SECONDS } from '@/lib/reputation/composite';
import { Info } from 'lucide-react';

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
  computedAt: string | null;
  lastPublisherTxTimestamp: string | null;
}

const emptyMetrics: ReputationMetrics = {
  fillRate: null,
  settleP50: null,
  settleP95: null,
  slippageP50: null,
  slippageP95: null,
  outcomesCount: 0,
  computedAt: null,
  lastPublisherTxTimestamp: null,
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
    computedAt: (scorecard.computedAt as string | null) ?? null,
    lastPublisherTxTimestamp: (scorecard.lastPublisherTxTimestamp as string | null) ?? null,
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
    computedAt: (payload.computedAt as string | null) ?? null,
    lastPublisherTxTimestamp: (payload.lastPublisherTxTimestamp as string | null) ?? null,
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

function FreshnessBadge({ freshness }: { freshness: FreshnessResult | null }) {
  if (!freshness) return null;

  const colors = getFreshnessBadgeColor(freshness.status);
  const label = getFreshnessLabel(freshness.status);
  const drift = freshness.driftMs ? formatDrift(freshness.driftMs) : null;

  return (
    <div className={`rounded-lg border border-gray-200 ${colors.bg} p-3 dark:border-gray-700`}>
      <div className="flex items-center gap-2">
        <div className={colors.icon}>
          {freshness.status === 'fresh' && (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
          )}
          {freshness.status === 'stale' && (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
          )}
          {freshness.status === 'unknown' && (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
          )}
        </div>
        <div className="flex-1">
          <p className={`text-sm font-medium ${colors.text}`}>{label}</p>
          {drift && <p className={`text-xs ${colors.text} opacity-80`}>Drift: {drift}</p>}
        </div>
      </div>
    </div>
  );
}

const STELLAR_EXPERT_TX_BASE = 'https://stellar.expert/explorer/public/tx';
const METHODOLOGY_DOC_URL =
  'https://github.com/ezedike-evan/stellar-intel/blob/main/docs/ANCHOR_REPUTATION.md';

function CompositeScoreBreakdown({
  fillRate,
  slippageP50,
  settleP50,
  sampleSize,
}: {
  fillRate: number | null;
  slippageP50: number | null;
  settleP50: number | null;
  sampleSize: number;
}) {
  const fillRatePercent = fillRate !== null ? formatFillRate(fillRate) : '—';
  const slippagePercent = slippageP50 !== null ? formatPercent(slippageP50) : '—';
  const settleSeconds = settleP50 !== null ? formatSeconds(settleP50) : '—';

  return (
    <div className="space-y-2">
      <p className="font-medium text-gray-900 dark:text-white">
        composite = fill rate × (1 − slippage) ÷ (settle ÷ {NORM_SETTLE_SECONDS}s)
      </p>
      <ul className="space-y-1">
        <li>Fill rate: {fillRatePercent}</li>
        <li>Slippage (p50): {slippagePercent}</li>
        <li>Settle (p50): {settleSeconds}</li>
      </ul>
      <p className="text-gray-500 dark:text-gray-400">
        Sample size: {sampleSize} outcome{sampleSize !== 1 ? 's' : ''}
      </p>
      <a
        href={METHODOLOGY_DOC_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-blue-600 hover:underline dark:text-blue-400"
      >
        Methodology docs
      </a>
    </div>
  );
}

function MetadataSection({ metadata }: { metadata: AnchorMetadata }) {
  const hasRegions = metadata.regions?.senders || metadata.regions?.receivers;
  if (!hasRegions && !metadata.kycModel && !metadata.feeModel) return null;

  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {hasRegions && (
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/60">
          <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Regions
          </dt>
          <dd className="mt-2 space-y-1 text-sm text-gray-900 dark:text-gray-100">
            {metadata.regions?.senders && (
              <p>
                <span className="text-gray-500 dark:text-gray-400">Senders: </span>
                {metadata.regions.senders}
              </p>
            )}
            {metadata.regions?.receivers && (
              <p>
                <span className="text-gray-500 dark:text-gray-400">Receivers: </span>
                {metadata.regions.receivers}
              </p>
            )}
          </dd>
        </div>
      )}
      {(metadata.kycModel || metadata.feeModel) && (
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/60">
          {metadata.kycModel && (
            <>
              <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                KYC model
              </dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{metadata.kycModel}</dd>
            </>
          )}
          {metadata.feeModel && (
            <>
              <dt
                className={
                  metadata.kycModel
                    ? 'mt-3 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400'
                    : 'text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400'
                }
              >
                Fees
              </dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{metadata.feeModel}</dd>
            </>
          )}
        </div>
      )}
    </dl>
  );
}

export function ScorecardCard({
  anchorId,
  window: timeframe,
  latestOracleTxHash,
}: ScorecardCardProps) {
  const [metrics, setMetrics] = useState<ReputationMetrics>(emptyMetrics);
  const [historyData, setHistoryData] = useState<number[]>([]);
  const [freshness, setFreshness] = useState<FreshnessResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    setIsLoading(true);
    setError(null);
    setMetrics(emptyMetrics);
    setHistoryData([]);
    setFreshness(null);

    fetch(`/api/reputation/${encodeURIComponent(anchorId)}?window=${encodeURIComponent(timeframe)}`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load reputation data (${response.status})`);
        }

        return response.json();
      })
      .then((body) => {
        if (!isActive) return;
        const parsedMetrics = parseReputationResponse(body, timeframe);
        setMetrics(parsedMetrics);
        if (parsedMetrics.computedAt) {
          setFreshness(
            calculateFreshness(parsedMetrics.computedAt, parsedMetrics.lastPublisherTxTimestamp)
          );
        }
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
  const anchorMetadata = ANCHORS.find((a) => a.id === anchorId)?.metadata;

  const compositeScore =
    metrics.fillRate !== null && metrics.slippageP50 !== null && metrics.settleP50 !== null
      ? composite({
          fillRate: metrics.fillRate > 1 ? metrics.fillRate / 100 : metrics.fillRate,
          slippage: metrics.slippageP50 / 100,
          settleSeconds: metrics.settleP50,
        })
      : null;

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
        <div className="space-y-4">
          <FreshnessBadge freshness={freshness} />
          {compositeScore !== null && (
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/60">
              <div className="flex items-center gap-1.5">
                <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Composite score
                </dt>
                <Tooltip
                  content={
                    <CompositeScoreBreakdown
                      fillRate={metrics.fillRate}
                      slippageP50={metrics.slippageP50}
                      settleP50={metrics.settleP50}
                      sampleSize={metrics.outcomesCount}
                    />
                  }
                >
                  <Info
                    className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500"
                    aria-label="How the composite score is calculated"
                  />
                </Tooltip>
              </div>
              <dd className="mt-3 text-2xl font-semibold text-gray-900 dark:text-white">
                {compositeScore.toFixed(2)}
              </dd>
            </div>
          )}
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
          {anchorMetadata && <MetadataSection metadata={anchorMetadata} />}
        </div>
      )}
    </Card>
  );
}
