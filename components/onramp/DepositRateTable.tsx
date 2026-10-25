'use client';
import Link from 'next/link';
import type { AnchorRateError, DepositRate, DepositRateComparison } from '@/types';
import { AnchorLogo } from '@/components/ui/AnchorLogo';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { QuotePill } from '@/components/ui/QuotePill';
import { Skeleton } from '@/components/ui/Skeleton';
import { depositLimitStatus } from '@/lib/stellar/deposit-rates';

interface DepositRateTableProps {
  rates: DepositRateComparison | undefined;
  anchorErrors: AnchorRateError[];
  isLoading: boolean;
  error: string | undefined;
  /** ISO 4217 code of the fiat being deposited, used in the empty state. */
  fiatCode: string;
  onSelectAnchor: (rate: DepositRate) => void;
  /** Disables every Deposit button, e.g. while no wallet is connected. */
  executeDisabled: boolean;
  onRefresh: () => void;
}

const CAPTION_ID = 'deposit-rate-table-caption';
const COLUMN_COUNT = 5;

/** `stellar:CODE:ISSUER` / `stellar:native` → display code and issuer. */
function parseAssetId(assetId: string): { code: string; issuer: string } {
  if (assetId === 'stellar:native') return { code: 'XLM', issuer: '' };
  const [, code = assetId, issuer = ''] = assetId.split(':');
  return { code, issuer };
}

function truncateIssuer(issuer: string): string {
  return issuer.length > 12 ? `${issuer.slice(0, 6)}…${issuer.slice(-6)}` : issuer;
}

/**
 * Deposit estimates for one corridor, one row per (anchor, asset).
 *
 * Every figure is an estimate: the anchor sets the final conversion inside its
 * interactive deposit window. The caption saying so is always rendered, also
 * while loading and when there are no rows, so the table can never be read as a
 * firm quote.
 */
export function DepositRateTable({
  rates,
  anchorErrors,
  isLoading,
  error,
  fiatCode,
  onSelectAnchor,
  executeDisabled,
  onRefresh,
}: DepositRateTableProps) {
  // Rows outside the anchor's limits go last; Array.prototype.sort is stable, so the
  // order within each group stays the order fetchDepositRates returned.
  const rows = [...(rates?.rates ?? [])].sort(
    (a, b) => Number(depositLimitStatus(a) !== 'ok') - Number(depositLimitStatus(b) !== 'ok')
  );
  const showSkeleton = isLoading && rows.length === 0;
  const showError = !showSkeleton && Boolean(error);
  const showEmpty = !showSkeleton && !error && rows.length === 0;

  return (
    <div className="space-y-3">
      <p id={CAPTION_ID} className="text-fg-muted text-xs">
        Estimates only. Each anchor sets its final rate and fees inside its deposit window.
      </p>

      <div className="border-border overflow-x-auto rounded-xl border">
        {showSkeleton ? (
          <div role="status" aria-label="Loading deposit estimates">
            <Skeleton rows={4} columns={COLUMN_COUNT} />
          </div>
        ) : (
          <table className="w-full text-left text-sm" aria-describedby={CAPTION_ID}>
            <caption className="sr-only">
              {`${fiatCode} deposit estimates, ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`}
            </caption>
            <thead>
              <tr className="border-border bg-bg-sunken border-b">
                <th scope="col" className="text-secondary-text px-4 py-3 font-medium">
                  Anchor
                </th>
                <th scope="col" className="text-secondary-text px-4 py-3 font-medium">
                  Asset
                </th>
                <th scope="col" className="text-secondary-text px-4 py-3 text-right font-medium">
                  You receive (est.)
                </th>
                <th scope="col" className="text-secondary-text px-4 py-3 text-right font-medium">
                  Fee
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {showError && (
                <tr>
                  <td colSpan={COLUMN_COUNT} className="px-4 py-8 text-center">
                    <p role="alert" className="text-status-down mb-3 text-sm">
                      {error}
                    </p>
                    <Button variant="secondary" size="sm" onClick={onRefresh}>
                      Retry
                    </Button>
                  </td>
                </tr>
              )}

              {showEmpty && (
                <tr>
                  <td colSpan={COLUMN_COUNT} className="px-4 py-10 text-center">
                    <p className="text-secondary-text text-sm font-medium">
                      No anchor currently accepts {fiatCode} deposits on this corridor.
                    </p>
                    <div className="mt-4">
                      <Button variant="secondary" size="sm" onClick={onRefresh}>
                        Refresh now
                      </Button>
                    </div>
                  </td>
                </tr>
              )}

              {!showError &&
                rows.map((rate) => {
                  const { code, issuer } = parseAssetId(rate.asset);
                  const isBest = rows.length >= 2 && rate.anchorId === rates?.bestRateId;
                  const isUnavailable =
                    rate.source === 'unavailable' || rate.totalReceived === null;
                  const limit = depositLimitStatus(rate);

                  return (
                    <tr
                      key={`${rate.anchorId}-${rate.asset}`}
                      className="border-border border-t align-top"
                    >
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <AnchorLogo anchorId={rate.anchorId} anchorName={rate.anchorName} />
                          <Link
                            href={`/anchors/${rate.anchorId}`}
                            className="text-primary-text font-medium hover:underline"
                          >
                            {rate.anchorName}
                          </Link>
                          {isBest && <Badge variant="success">Best estimate</Badge>}
                          {/* DepositRate has no expiry, so a firm-quote pill would read as
                              expired; a deposit row is only ever shown as an estimate. */}
                          <QuotePill source={rate.source === 'sep38' ? 'sep24-fee' : rate.source} />
                        </div>
                      </td>
                      <td className="text-secondary-text px-4 py-3">
                        <span title={issuer ? truncateIssuer(issuer) : undefined}>{code}</span>
                      </td>
                      <td className="text-primary-text px-4 py-3 text-right font-medium tabular-nums">
                        {rate.totalReceived === null
                          ? '—'
                          : `≈ ${rate.totalReceived.toFixed(2)} ${code}`}
                        {limit !== 'ok' && (
                          <span className="text-status-down block text-xs font-normal">
                            {limit === 'below_min'
                              ? `Min ${rate.minAmount} ${code}`
                              : `Max ${rate.maxAmount} ${code}`}
                          </span>
                        )}
                      </td>
                      <td className="text-secondary-text px-4 py-3 text-right tabular-nums">
                        {rate.fee === null ? '—' : `${rate.fee} ${code}`}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => onSelectAnchor(rate)}
                          disabled={isUnavailable || limit !== 'ok' || executeDisabled}
                          aria-label={`Deposit with ${rate.anchorName}`}
                        >
                          Deposit
                        </Button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        )}
      </div>

      {anchorErrors.length > 0 && !showSkeleton && (
        <details className="border-border rounded-xl border px-4 py-3 text-sm">
          <summary className="text-secondary-text focus-visible:ring-accent cursor-pointer font-medium focus-visible:ring-2 focus-visible:outline-none">
            Unavailable anchors ({anchorErrors.length})
          </summary>
          <ul className="mt-3 space-y-2">
            {anchorErrors.map((anchorError) => (
              <li key={anchorError.anchorId} className="flex flex-wrap gap-x-2 text-xs">
                <span className="text-primary-text font-medium">{anchorError.anchorName}</span>
                <span className="text-fg-muted">{anchorError.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
