import { clsx } from 'clsx';
import { Card } from '@/components/ui/Card';
import type { QuoteGapStats } from '@/lib/reputation/quote-gap';

/** Fewer completed transactions than this say nothing reliable about an anchor. */
export const MIN_QUOTE_GAP_SAMPLES = 5;

/** `+0.50` / `-1.20`: always signed, so direction never depends on colour alone. */
function signed(value: number): string {
  const rounded = value.toFixed(2);
  if (Number(rounded) === 0) return '0.00'; // never "-0.00"
  return Number(rounded) > 0 ? `+${rounded}` : rounded;
}

function gapTone(value: number): string {
  const rounded = Number(value.toFixed(2));
  if (rounded < 0) return 'text-status-down';
  if (rounded > 0) return 'text-status-up';
  return 'text-primary-text';
}

/**
 * How closely an anchor delivered the rate it showed, in plain words: the median
 * gap, the range 95% of transactions fell inside, and how many landed worse or
 * better. A negative gap means the user received less than quoted. Too few samples
 * and the numbers are withheld rather than shown as if they meant something.
 */
export function QuoteGapCard({
  sampleCount,
  p50GapPct,
  p95AbsGapPct,
  worseCount,
  betterCount,
  windowDays,
}: QuoteGapStats) {
  const hasEnough =
    sampleCount >= MIN_QUOTE_GAP_SAMPLES && p50GapPct !== null && p95AbsGapPct !== null;

  return (
    <Card aria-labelledby="quote-gap-heading" role="region" className="space-y-3">
      <h2 id="quote-gap-heading" className="text-primary-text text-lg font-semibold">
        Quote accuracy
      </h2>

      {hasEnough ? (
        <>
          <p className="text-secondary-text text-sm">
            Median gap between quoted and landed rate:{' '}
            <span className={clsx('font-semibold tabular-nums', gapTone(p50GapPct))}>
              {signed(p50GapPct)}%
            </span>
          </p>
          <p className="text-secondary-text text-sm">
            95% of transactions landed within{' '}
            <span className="text-primary-text font-semibold tabular-nums">
              {p95AbsGapPct.toFixed(2)}%
            </span>
          </p>
          <p className="text-secondary-text text-sm">
            <span className="text-status-down font-semibold tabular-nums">{worseCount} worse</span>
            {' / '}
            <span className="text-status-up font-semibold tabular-nums">
              {betterCount} better
            </span>{' '}
            than quoted
          </p>
          <p className="text-fg-muted text-xs">
            Based on {sampleCount} completed transactions in the last {windowDays} days
          </p>
        </>
      ) : (
        <p className="text-secondary-text text-sm">
          Not enough completed transactions yet to measure this anchor&apos;s quote accuracy.
        </p>
      )}
    </Card>
  );
}
