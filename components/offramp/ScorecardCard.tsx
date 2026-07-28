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
import {
  calculateFreshness,
  formatDrift,
  getFreshnessLabel,
  getFreshnessBadgeColor,
  type FreshnessResult,
} from '@/lib/oracle/freshness';
import { ANCHORS } from '@/constants';
import type { AnchorMetadata } from '@/types';
import { AnchorLogo } from '@/components/ui/AnchorLogo';
import { composite, NORM_SETTLE_SECONDS } from '@/lib/reputation/composite';

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
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function toTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
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
    computedAt:
      toTimestamp(scorecard.computedAt) ??
      toTimestamp(scorecard.computed_at) ??
      toTimestamp(payload.computedAt) ??
      toTimestamp(payload.computed_at),
    lastPublisherTxTimestamp:
      toTimestamp(scorecard.lastPublisherTxTimestamp) ??
      toTimestamp(scorecard.last_publisher_tx_timestamp) ??
      toTimestamp(payload.lastPublisherTxTimestamp) ??
      toTimestamp(payload.last_publisher_tx_timestamp),
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
    computedAt:
      toTimestamp(payload.computedAt) ??
      toTimestamp(payload.computed_at) ??
      toTimestamp(payload.lastProbeAt) ??
      toTimestamp(payload.last_probe_at) ??
      toTimestamp(payload.lastProbedAt) ??
      toTimestamp(payload.last_probed_at),
    lastPublisherTxTimestamp:
      toTimestamp(payload.lastPublisherTxTimestamp) ??
      toTimestamp(payload.last_publisher_tx_timestamp) ??
      toTimestamp(payload.publisherTxTimestamp) ??
      toTimestamp(payload.publisher_tx_timestamp),
  };
}

function formatFillRate(value: number | null): string {
  if (value === null) return '—';
  const percent = value > 0 && value <= 1 ? value * 100 : value;
  return `${new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  }).format(percent)}%`;
}

function formatPercent(value: number | null): string {
  if (value === null) return '—';
  return `${new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value)}%`;
}

function formatSeconds(value: number | null): string {
  if (value === null) return '—';
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
    <div
      className={`rounded-lg border border-gray-200 ${colors.bg} p-3 dark:border-gray-700`}
      role="status"
      aria-label={`Probe health: ${label}`}
    >
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${colors.icon}`} aria-hidden="true" />
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
  return (
    <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
      <p className="font-medium text-gray-900 dark:text-white">
        composite = fill rate × (1 − slippage) ÷ (settle ÷ {NORM_SETTLE_SECONDS}s)
      </p>
      <ul className="space-y-1">
        <li>Fill rate: {formatFillRate(fillRate)}</li>
        <li>Slippage (p50): {formatPercent(slippageP50)}</li>
        <li>Settle (p50): {formatSeconds(settleP50)}</li>
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
          <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Regions</dt>
          <dd className="mt-2 space-y-1 text-sm text-gray-900 dark:text-gray-100">
            {metadata.regions?.senders && <p>Senders: {metadata.regions.senders}</p>}
            {metadata.regions?.receivers && <p>Receivers: {metadata.regions.receivers}</p>}
          </dd>
        </div>
      )}
      {(metadata.kycModel || metadata.feeModel) && (
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/60">
          {metadata.kycModel && (
            <>
              <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">KYC model</dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{metadata.kycModel}</dd>
            </>
          )}
          {metadata.feeModel && (
            <>
              <dt className="mt-3 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Fees</dt>
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
  const [freshness, setFreshness] = useState<FreshnessResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;
    setIsLoading(true);
    setError(null);
    setMetrics(emptyMetrics);
    setFreshness(null);

    fetch(`/api/reputation/${encodeURIComponent(anchorId)}?window=${encodeURIComponent(timeframe)}`)
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load reputation data (${response.status})`);
        return response.json();
      })
      .then((body: unknown) => {
        if (!isActive) return;
        const parsedMetrics = parseReputationResponse(body, timeframe);
        setMetrics(parsedMetrics);

        // Probe-backed responses may omit computedAt while still exposing the
        // publisher's latest observation. Prefer the aggregate timestamp, but
        // use that live publisher timestamp rather than rendering "unknown".
        const healthTimestamp =
          parsedMetrics.computedAt ?? parsedMetrics.lastPublisherTxTimestamp;
        if (healthTimestamp) {
          setFreshness(calculateFreshness(healthTimestamp, parsedMetrics.lastPublisherTxTimestamp));
        }
      })
      .catch((fetchError: unknown) => {
        if (isActive) {
          setError(fetchError instanceof Error ? fetchError.message : 'Unable to load reputation data');
        }
      })
      .finally(() => {
        if (isActive) setIsLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [anchorId, timeframe]);

  const enoughData = hasEnoughData(metrics.outcomesCount);
  const remaining = Math.max(0, MIN_OUTCOMES_THRESHOLD - metrics.outcomesCount);
  const anchorObj = ANCHORS.find((anchor) => anchor.id === anchorId);
  const anchorName = anchorObj?.name ?? anchorId;
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
        <div className="flex items-center gap-2">
          <AnchorLogo anchorId={anchorId} anchorName={anchorName} size="sm" />
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            <span className="font-semibold text-gray-900 dark:text-white">{anchorName}</span>{' '}
            reputation
          </p>
          {latestOracleTxHash && (
            <a
              href={`${STELLAR_EXPERT_TX_BASE}/${latestOracleTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View latest oracle transaction on stellar.expert"
              className="text-gray-400 transition-colors hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400"
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
      ) : (
        <>
          <FreshnessBadge freshness={freshness} />
          {!hasReputationMetrics(metrics) ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-300">
              No reputation metrics available for this anchor.
            </div>
          ) : !enoughData ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
              {estimateTimeToThreshold(metrics.outcomesCount)}
              {remaining > 0 && (
                <span> {remaining} more outcome{remaining === 1 ? '' : 's'} needed.</span>
              )}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                <p className="text-xs uppercase tracking-wide text-gray-500">Composite score</p>
                <p className="mt-2 text-3xl font-semibold text-gray-900 dark:text-white">
                  {compositeScore === null ? '—' : `${Math.round(compositeScore * 100)}%`}
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                <CompositeScoreBreakdown
                  fillRate={metrics.fillRate}
                  slippageP50={metrics.slippageP50}
                  settleP50={metrics.settleP50}
                  sampleSize={metrics.outcomesCount}
                />
              </div>
            </div>
          )}
          {anchorObj?.metadata && <MetadataSection metadata={anchorObj.metadata} />}
        </>
      )}
    </Card>
  );
}
