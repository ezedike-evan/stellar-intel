import { Card } from '@/components/ui/Card';
import { Sparkline } from '@/components/ui/Sparkline';
import { formatSettleDuration } from '@/lib/format';
import type { ExecutionSla, ExecutionSlaReport } from '@/lib/reputation/execution-sla';

/**
 * Settlement time for one anchor (SLA006): how long completed withdrawals took
 * over the trailing window, against the anchor's SLA thresholds.
 *
 * Breaches are stated in words, never by colour alone, and the per-corridor
 * table only appears when the anchor serves more than one corridor.
 */
export function ExecutionSlaCard({ report }: { report: ExecutionSlaReport }) {
  const { sla, breach } = report.overall;
  // Days with enough samples to publish a p95 (SLA007). Shown in both states:
  // a day can reach 5 samples while the 30-day total is still under 30.
  const points = report.history.filter((p) => p.p95Ms !== null);

  return (
    <Card
      role="region"
      aria-labelledby="execution-sla-heading"
      data-testid="execution-sla-card"
      className="space-y-4"
    >
      <div>
        <h2 id="execution-sla-heading" className="text-lg font-semibold">
          Settlement time
        </h2>
        <p className="text-fg-muted text-sm">
          How long completed withdrawals took to settle over the last {report.windowDays} days.
        </p>
      </div>

      {sla.state === 'ok' ? (
        <>
          <dl className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-fg-muted">Half settled within</dt>
              <dd className="font-medium tabular-nums">{formatSettleDuration(sla.p50Ms)}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">95% settled within</dt>
              <dd className="font-medium tabular-nums">{formatSettleDuration(sla.p95Ms)}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">99% settled within</dt>
              <dd className="font-medium tabular-nums">
                {sla.p99Ms === null ? 'Needs 100+ settlements' : formatSettleDuration(sla.p99Ms)}
              </dd>
            </div>
          </dl>

          {breach.status === 'within' && (
            <p className="text-sm">
              Within target: 95% under {formatSettleDuration(report.thresholds.p95Ms)}
            </p>
          )}
          {breach.status === 'breach' &&
            breach.breaches.map((b) => (
              <p key={b.metric} className="text-status-down text-sm">
                Slower than target: {b.metric} {formatSettleDuration(b.observedMs)} vs{' '}
                {formatSettleDuration(b.thresholdMs)}
              </p>
            ))}
        </>
      ) : (
        <p className="text-sm">
          Not enough completed withdrawals yet to publish settlement times ({sla.sampleSize} of{' '}
          {sla.minSamples} needed).
        </p>
      )}

      {points.length >= 2 ? (
        <figure className="space-y-1">
          <Sparkline data={points.map((p) => (p.p95Ms as number) / 1000)} width={160} height={32} />
          <figcaption className="text-fg-muted text-xs">
            Daily 95th-percentile settle time, {points[0]!.day} to {points[points.length - 1]!.day}{' '}
            ({points.length} days with enough data)
          </figcaption>
        </figure>
      ) : (
        <p className="text-fg-muted text-xs">Not enough daily data for a trend yet.</p>
      )}

      {report.corridors.length > 1 && (
        <table className="w-full text-sm">
          <caption className="text-fg-muted mb-2 text-left text-xs">
            Settlement time by corridor
          </caption>
          <thead>
            <tr className="text-fg-muted text-left">
              <th scope="col">Corridor</th>
              <th scope="col">p50</th>
              <th scope="col">p95</th>
              <th scope="col">p99</th>
              <th scope="col">Samples</th>
            </tr>
          </thead>
          <tbody>
            {report.corridors.map((entry) => (
              <tr key={entry.corridor} className="tabular-nums">
                <td>{entry.corridor.toUpperCase().replace('-', ' → ')}</td>
                <td>{percentile(entry.sla, 'p50Ms')}</td>
                <td>{percentile(entry.sla, 'p95Ms')}</td>
                <td>{percentile(entry.sla, 'p99Ms')}</td>
                <td>{entry.sla.sampleSize}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="text-fg-muted text-xs">
        Based on {sla.sampleSize} completed of {sla.terminalCount} finished withdrawals,{' '}
        {sla.windowStart.slice(0, 10)} to {sla.windowEnd.slice(0, 10)}. Disputed transactions are
        excluded.
      </p>
    </Card>
  );
}

function percentile(sla: ExecutionSla, key: 'p50Ms' | 'p95Ms' | 'p99Ms'): string {
  if (sla.state !== 'ok') return '—';
  const value = sla[key];
  return value === null ? '—' : formatSettleDuration(value);
}
