import React from 'react';
import { Card } from '@/components/ui/Card';
import { Sparkline } from '@/components/ui/Sparkline';
import { formatSettleDuration } from '@/lib/format';
import type { ExecutionSlaReport } from '@/lib/reputation/execution-sla';

export interface ExecutionSlaCardProps {
  report: ExecutionSlaReport;
}

export function ExecutionSlaCard({ report }: ExecutionSlaCardProps) {
  const { overall, history, corridors } = report;

  const points = history.filter((p) => p.p95Ms !== null);

  return (
    <Card
      role="region"
      aria-labelledby="execution-sla-heading"
      data-testid="execution-sla-card"
      className="space-y-4"
    >
      <div className="flex items-center justify-between">
        <h2 id="execution-sla-heading" className="text-primary-text text-lg font-semibold">
          Execution SLA
        </h2>
        {overall.sla.state === 'ok' && (
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              overall.breach.status === 'within'
                ? 'bg-status-up/10 text-status-up'
                : 'bg-status-down/10 text-status-down'
            }`}
          >
            {overall.breach.status === 'within' ? 'Within target' : 'Breach'}
          </span>
        )}
      </div>

      {overall.sla.state === 'ok' ? (
        <div className="space-y-3">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="rounded-lg bg-bg-subtle p-3">
              <dt className="text-secondary-text text-xs">Median (p50)</dt>
              <dd className="text-primary-text mt-1 text-base font-semibold tabular-nums">
                {formatSettleDuration(overall.sla.p50Ms)}
              </dd>
            </div>
            <div className="rounded-lg bg-bg-subtle p-3">
              <dt className="text-secondary-text text-xs">95th percentile (p95)</dt>
              <dd className="text-primary-text mt-1 text-base font-semibold tabular-nums">
                {formatSettleDuration(overall.sla.p95Ms)}
              </dd>
            </div>
            <div className="rounded-lg bg-bg-subtle p-3">
              <dt className="text-secondary-text text-xs">99th percentile (p99)</dt>
              <dd className="text-primary-text mt-1 text-base font-semibold tabular-nums">
                {overall.sla.p99Ms !== null
                  ? formatSettleDuration(overall.sla.p99Ms)
                  : 'Needs 100+ settlements'}
              </dd>
            </div>
          </dl>

          {overall.breach.status === 'breach' && (
            <p className="text-status-down text-sm">
              Slower than target:{' '}
              {overall.breach.breaches
                .map(
                  (b) =>
                    `${b.metric.toUpperCase()} observed ${formatSettleDuration(
                      b.observedMs
                    )} (target ${formatSettleDuration(b.thresholdMs)})`
                )
                .join(', ')}
            </p>
          )}

          <p className="text-fg-muted text-xs">
            Based on {overall.sla.sampleSize} completed withdrawals in the last{' '}
            {overall.sla.windowDays} days
          </p>
        </div>
      ) : (
        <p className="text-secondary-text text-sm">
          Not enough completed withdrawals yet to calculate settlement percentiles (minimum 30
          required, observed {overall.sla.sampleSize}).
        </p>
      )}

      {/* Daily trend sparkline */}
      <div className="border-t border-border pt-3">
        {points.length >= 2 ? (
          <figure className="space-y-1">
            <Sparkline
              data={points.map((p) => (p.p95Ms as number) / 1000)}
              width={160}
              height={32}
            />
            <figcaption className="text-xs text-fg-muted">
              Daily 95th-percentile settle time, {points[0]!.day} to{' '}
              {points[points.length - 1]!.day} ({points.length} days with enough data)
            </figcaption>
          </figure>
        ) : (
          <p className="text-xs text-fg-muted">Not enough daily data for a trend yet.</p>
        )}
      </div>

      {/* Corridors breakdown if multiple */}
      {corridors.length > 1 && (
        <div className="border-t border-border pt-3">
          <h3 className="text-primary-text mb-2 text-sm font-semibold">Corridor breakdown</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-secondary-text border-b border-border">
                  <th className="py-2 pr-4 font-medium">Corridor</th>
                  <th className="py-2 pr-4 font-medium">p50</th>
                  <th className="py-2 pr-4 font-medium">p95</th>
                  <th className="py-2 pr-4 font-medium">p99</th>
                  <th className="py-2 font-medium">Samples</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {corridors.map((c) => (
                  <tr key={c.corridor}>
                    <td className="py-2 pr-4 font-mono font-medium text-primary-text">
                      {c.corridor}
                    </td>
                    <td className="py-2 pr-4 text-secondary-text tabular-nums">
                      {c.sla.state === 'ok' ? formatSettleDuration(c.sla.p50Ms) : '—'}
                    </td>
                    <td className="py-2 pr-4 text-secondary-text tabular-nums">
                      {c.sla.state === 'ok' ? formatSettleDuration(c.sla.p95Ms) : '—'}
                    </td>
                    <td className="py-2 pr-4 text-secondary-text tabular-nums">
                      {c.sla.state === 'ok' && c.sla.p99Ms !== null
                        ? formatSettleDuration(c.sla.p99Ms)
                        : '—'}
                    </td>
                    <td className="py-2 text-secondary-text tabular-nums">
                      {c.sla.sampleSize}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}
