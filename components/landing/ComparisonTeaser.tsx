import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

/** One illustrative anchor quote for the teaser comparison. */
interface SampleQuote {
  anchor: string;
  rate: string;
  fee: string;
  youGet: string;
  /** The best payout in the sample set — highlighted. */
  best?: boolean;
}

/**
 * Static sample only — illustrative figures for a single corridor, not live
 * data. The live comparison runs on the off-ramp page from real SEP-38 quotes.
 */
const SAMPLE_CORRIDOR = '$100 USDC → NGN';
const SAMPLE_QUOTES: SampleQuote[] = [
  { anchor: 'Anchor A', rate: '1,602', fee: '1.0%', youGet: '₦158,598', best: true },
  { anchor: 'Anchor B', rate: '1,580', fee: '0.5%', youGet: '₦157,210' },
  { anchor: 'Anchor C', rate: '1,575', fee: '0.3%', youGet: '₦157,028' },
];

/**
 * Comparison-table teaser — frames the product as rate comparison across
 * anchors ("Skyscanner for Stellar anchors"). Renders a compact, static sample
 * comparison and links to the live off-ramp.
 */
export function ComparisonTeaser() {
  return (
    <section aria-labelledby="compare-heading" className="rounded-xl border border-border p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="compare-heading" className="text-lg font-semibold text-primary-text">
            One corridor, every anchor
          </h2>
          <p className="mt-1 text-sm text-secondary-text">
            Skyscanner for Stellar anchors — compare the real payout before you sign.
          </p>
        </div>
        <span className="rounded-full bg-bg-sunken px-2.5 py-1 text-xs font-medium text-secondary-text">
          Sample · {SAMPLE_CORRIDOR}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">
            Illustrative off-ramp comparison for {SAMPLE_CORRIDOR} across anchors
          </caption>
          <thead>
            <tr className="text-xs uppercase tracking-wide text-fg-muted">
              <th scope="col" className="py-2 pr-4 font-medium">
                Anchor
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Rate (NGN)
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Fee
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                You get
              </th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE_QUOTES.map((q) => (
              <tr key={q.anchor} className="border-t border-border">
                <th scope="row" className="py-2 pr-4 font-medium text-primary-text">
                  {q.anchor}
                </th>
                <td className="py-2 pr-4 text-secondary-text">{q.rate}</td>
                <td className="py-2 pr-4 text-secondary-text">{q.fee}</td>
                <td className="py-2 pr-4">
                  <span className={q.best ? 'font-semibold text-status-up' : 'text-secondary-text'}>
                    {q.youGet}
                    {q.best && (
                      <span className="ml-2 rounded bg-accent-subtle px-1.5 py-0.5 text-xs font-medium text-status-up">
                        Best
                      </span>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Link
        href="/offramp"
        className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 dark:text-accent"
      >
        Compare live rates
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </section>
  );
}
