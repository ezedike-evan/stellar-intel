import { Anchor, ArrowUpRight } from 'lucide-react';

/**
 * New-issue URL for the anchor onboarding template. Anchor operators and
 * community integrators apply to list a Stellar anchor through this form.
 */
const ANCHOR_ONBOARD_URL =
  'https://github.com/ezedike-evan/stellar-intel/issues/new?template=anchor-onboard.yml';

/**
 * Landing CTA section inviting anchors to list on Stellar Intel.
 *
 * The framing is carrot, not stick — mirroring the onboarding template: no
 * listing fee, no exclusivity, and non-custodial. The CTA opens the
 * `anchor-onboard.yml` new-issue template.
 */
export function AnchorCta() {
  return (
    <section className="rounded-xl border border-blue-200 bg-blue-50 p-6 text-center dark:border-blue-900 dark:bg-blue-950/30 sm:p-8">
      <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-blue-100 px-4 py-1.5 text-sm font-medium text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
        <Anchor className="h-3.5 w-3.5" />
        For anchors
      </div>
      <h2 className="mb-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
        Run a Stellar anchor?
      </h2>
      <p className="mx-auto mb-6 max-w-xl text-gray-600 dark:text-gray-400">
        Listing is carrot, not stick: no listing fee, no exclusivity, and we never custody user
        funds. We aggregate your quotes and publish your track record to a public Soroban oracle.
      </p>
      <a
        href={ANCHOR_ONBOARD_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-950"
      >
        List your anchor
        <ArrowUpRight className="h-4 w-4" />
      </a>
    </section>
  );
}
