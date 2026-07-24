'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Info } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { ANCHORS } from '@/constants';
import { Tooltip } from '@/components/ui/Tooltip';

type ReputationWindow = '7d' | '30d' | '90d';
type HealthStatus = 'healthy' | 'degraded' | 'unknown';

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
  health: HealthStatus;
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
  health: 'unknown',
};

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toTimestamp(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normaliseHealth(value: unknown): HealthStatus | null {
  if (typeof value !== 'string') return null;

  const status = value.toLowerCase();
  if (status === 'healthy' || status === 'ok' || status === 'good' || status === 'up') {
    return 'healthy';
  }

  if (
    status === 'degraded' ||
    status === 'warning' ||
    status === 'warn' ||
    status === 'unhealthy' ||
    status === 'down'
  ) {
    return 'degraded';
  }

  return status === 'unknown' ? 'unknown' : null;
}

function normaliseRate(value: number | null): number | null {
  if (value === null) return null;
  return value > 1 ? value / 100 : value;
}

function parseMetrics(body: unknown, requestedWindow: ReputationWindow): ReputationMetrics {
  const response = toObject(body) ?? {};
  const root = toObject(response.data) ?? response;
  const scorecards = toObject(root.scorecards);
  const scorecard = toObject(scorecards?.[requestedWindow]);
  const metrics = toObject(root.metrics);
  const probe = toObject(root.probe) ?? toObject(root.probeData) ?? {};
  const source = scorecard ?? metrics ?? root;
  const settleMs = toObject(source.settleMs);
  const slippage = toObject(source.slippage);

  const outcomeCollection = Array.isArray(probe.outcomes)
    ? probe.outcomes
    : Array.isArray(root.outcomes)
      ? root.outcomes
      : null;

  const outcomesCount =
    toNumber(
      source.sampleSize ??
        source.outcomesCount ??
        source.outcomes_count ??
        source.totalProbes ??
        source.probeCount ??
        probe.sampleSize ??
        probe.outcomesCount ??
        probe.outcomes_count ??
        probe.totalProbes ??
        probe.probeCount ??
        probe.outcomeCount ??
        (outcomeCollection ? outcomeCollection.length : null)
    ) ?? 0;

  const fillRate = normaliseRate(
    toNumber(source.fillRate ?? source.fill_rate ?? source.fillRatePercent ?? source.fill_rate_percent)
  );

  const explicitHealth =
    normaliseHealth(source.status) ??
    normaliseHealth(source.health) ??
    normaliseHealth(source.healthStatus) ??
    normaliseHealth(probe.status) ??
    normaliseHealth(probe.health) ??
    normaliseHealth(probe.healthStatus) ??
    normaliseHealth(root.status) ??
    normaliseHealth(root.health) ??
    normaliseHealth(root.healthStatus);

  const health: HealthStatus =
    outcomesCount > 0
      ? explicitHealth ??
        (fillRate !== null ? (fillRate < 0.8 ? 'degraded' : 'healthy') : 'unknown')
      : 'unknown';

  const settleP50FromMilliseconds = settleMs?.p50;
  const settleP95FromMilliseconds = settleMs?.p95;
  const slippageP50FromRatio = slippage?.p50;
  const slippageP95FromRatio = slippage?.p95;

  const settleP50Value = toNumber(
    settleP50FromMilliseconds ?? source.settleP50 ?? source.settle_p50
  );
  const settleP95Value = toNumber(
    settleP95FromMilliseconds ?? source.settleP95 ?? source.settle_p95
  );
  const slippageP50Value = toNumber(
    slippageP50FromRatio ?? source.slippageP50 ?? source.slippage_p50
  );
  const slippageP95Value = toNumber(
    slippageP95FromRatio ?? source.slippageP95 ?? source.slippage_p95
  );

  return {
    fillRate,
    settleP50:
      settleP50Value === null
        ? null
        : Math.round(settleP50Value / (settleP50FromMilliseconds !== undefined && settleP50FromMilliseconds !== null ? 1000 : 1)),
    settleP95:
      settleP95Value === null
        ? null
        : Math.round(settleP95Value / (settleP95FromMilliseconds !== undefined && settleP95FromMilliseconds !== null ? 1000 : 1)),
    slippageP50:
      slippageP50Value === null
        ? null
        : slippageP50Value * (slippageP50FromRatio !== undefined && slippageP50FromRatio !== null ? 100 : 1),
    slippageP95:
      slippageP95Value === null
        ? null
        : slippageP95Value * (slippageP95FromRatio !== undefined && slippageP95FromRatio !== null ? 100 : 1),
    outcomesCount,
    computedAt: toTimestamp(source.computedAt ?? source.computed_at ?? probe.computedAt),
    lastPublisherTxTimestamp: toTimestamp(
      source.lastPublisherTxTimestamp ??
        source.last_publisher_tx_timestamp ??
        probe.lastPublisherTxTimestamp
    ),
    health,
  };
}

function healthLabel(status: HealthStatus): string {
  if (status === 'healthy') return 'Healthy';
  if (status === 'degraded') return 'Degraded';
  return 'Unknown';
}

function healthClasses(status: HealthStatus): string {
  if (status === 'healthy') {
    return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300';
  }

  if (status === 'degraded') {
    return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
  }

  return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
}

function dotClass(status: HealthStatus): string {
  if (status === 'healthy') return 'bg-green-500';
  if (status === 'degraded') return 'bg-amber-500';
  return 'bg-gray-400';
}

function formatMetric(value: number | null, suffix = ''): string {
  return value === null ? '—' : `${value}${suffix}`;
}

export function ScorecardCard({
  anchorId,
  window,
  latestOracleTxHash,
}: ScorecardCardProps) {
  const [metrics, setMetrics] = useState<ReputationMetrics>(emptyMetrics);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function loadReputation(): Promise<void> {
      setIsLoading(true);
      setError(false);

      try {
        const response = await fetch(
          `/api/reputation/${encodeURIComponent(anchorId)}?window=${window}`,
          { signal: controller.signal, cache: 'no-store' }
        );

        if (!response.ok) throw new Error('Unable to load reputation data');

        const body: unknown = await response.json();
        setMetrics(parseMetrics(body, window));
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setMetrics(emptyMetrics);
        setError(true);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }

    void loadReputation();
    return () => controller.abort();
  }, [anchorId, window]);

  const anchor = ANCHORS.find((item) => item.id === anchorId);
  const anchorName = anchor?.name ?? anchorId;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-gray-500">Reputation</p>
          <h2 className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">
            {anchorName}
          </h2>
        </div>

        <div
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${healthClasses(metrics.health)}`}
          data-testid="health-badge"
          aria-label={`Probe health: ${healthLabel(metrics.health)}`}
        >
          <span className={`h-2 w-2 rounded-full ${dotClass(metrics.health)}`} aria-hidden="true" />
          {healthLabel(metrics.health)}
          <Tooltip content="Based on live probe outcomes reported for this anchor.">
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
          </Tooltip>
        </div>
      </div>

      {isLoading ? (
        <div className="mt-5 space-y-3" aria-label="Loading reputation data">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-gray-500">Fill rate</p>
              <p className="mt-1 font-semibold text-gray-900 dark:text-white">
                {formatMetric(metrics.fillRate === null ? null : metrics.fillRate * 100, '%')}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Settlement P50</p>
              <p className="mt-1 font-semibold text-gray-900 dark:text-white">
                {formatMetric(metrics.settleP50, 's')}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Slippage P50</p>
              <p className="mt-1 font-semibold text-gray-900 dark:text-white">
                {formatMetric(metrics.slippageP50, '%')}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Probe outcomes</p>
              <p className="mt-1 font-semibold text-gray-900 dark:text-white">
                {metrics.outcomesCount}
              </p>
            </div>
          </div>

          {error ? (
            <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
              Live probe data is temporarily unavailable.
            </p>
          ) : metrics.outcomesCount === 0 ? (
            <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
              No live probe outcomes have been recorded for this anchor yet.
            </p>
          ) : (
            <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
              Health is sourced from {metrics.outcomesCount} live probe outcome
              {metrics.outcomesCount === 1 ? '' : 's'}.
            </p>
          )}
        </>
      )}

      {latestOracleTxHash ? (
        <a
          className="mt-4 inline-flex items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400"
          href={`https://stellar.expert/explorer/public/tx/${latestOracleTxHash}`}
          target="_blank"
          rel="noreferrer"
        >
          View latest oracle transaction
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      ) : null}
    </Card>
  );
}
