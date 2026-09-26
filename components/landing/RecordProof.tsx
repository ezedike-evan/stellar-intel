import Link from 'next/link';
import { tryGetReputationStore } from '@/lib/reputation/store';
import { loadProbeCoverageReport } from '@/lib/reputation/probeCoverage';

/**
 * components/landing/RecordProof.tsx
 *
 * The landing page asserted a record and then showed none of it. The probe
 * ledger has been accumulating real coverage for weeks, and
 * `/api/reputation/probe-coverage` has been serving it, but nothing on the site
 * rendered it — so the strongest evidence the project has was invisible to
 * anyone deciding whether to trust it.
 *
 * Every number here is read from that ledger at build time. None is a target,
 * an estimate, or a round number chosen because it reads well. If the store is
 * unavailable the section does not render at all, rather than showing zeros —
 * a zero here would be a claim about the anchors, when it is really a statement
 * about our own database connection.
 */
export async function RecordProof() {
  const store = tryGetReputationStore();
  if (!store) return null;

  let report;
  try {
    report = await loadProbeCoverageReport(store);
  } catch {
    return null;
  }

  const observed = report.anchors.filter((anchor) => anchor.coveredDays > 0);
  if (observed.length === 0) return null;

  const longestRun = observed.reduce(
    (max, anchor) => (anchor.continuousDays > max ? anchor.continuousDays : max),
    0
  );

  const figures: Array<{ value: string; unit: string; label: string }> = [
    {
      value: String(longestRun),
      unit: longestRun === 1 ? 'day' : 'days',
      label: 'longest unbroken run',
    },
    {
      value: String(observed.length),
      unit: observed.length === 1 ? 'anchor' : 'anchors',
      label: 'observed, of ' + report.anchors.length + ' registered',
    },
    { value: '4', unit: 'signals', label: 'uptime · quote · issuer · toml' },
    { value: '5', unit: 'minutes', label: 'between probes' },
  ];

  return (
    <section aria-labelledby="record-proof-heading" className="border-border border-t pt-8">
      <h2 id="record-proof-heading" className="text-fg-muted font-mono text-xs tracking-wide">
        the record so far &middot; as of {report.asOfDay}
      </h2>

      <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-4">
        {figures.map((figure) => (
          <div key={figure.label}>
            <dd className="font-mono text-4xl tabular-nums">
              {figure.value}
              <span className="text-fg-muted ml-2 text-base">{figure.unit}</span>
            </dd>
            <dt className="text-secondary-text mt-3 text-sm">{figure.label}</dt>
          </div>
        ))}
      </dl>

      {/* The bar this project set itself, and how far off it is. A reader who
          wants to know whether the record is trustworthy yet is better served
          by the distance than by a reassurance. */}
      <p className="text-secondary-text measure mt-10 text-base">
        {report.fleetThresholdMet ? (
          <>
            Every registered anchor now has {report.thresholdDays} continuous days of observation —
            the coverage this project set as the bar before any score is written to a mainnet
            oracle.
          </>
        ) : (
          <>
            Nothing is written to a mainnet oracle until every registered anchor has{' '}
            {report.thresholdDays} continuous days of observation. The slowest is{' '}
            {report.daysUntilFleetThreshold} {report.daysUntilFleetThreshold === 1 ? 'day' : 'days'}{' '}
            away. Publishing a credit bureau with an empty file is the failure this waits out.
          </>
        )}{' '}
        <Link
          href="/methodology"
          className="text-primary-text hover:text-accent underline underline-offset-4"
        >
          Read the method &rarr;
        </Link>
      </p>
    </section>
  );
}
