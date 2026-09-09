import type { Metadata } from 'next';
import Link from 'next/link';
import { Hero } from '@/components/landing/Hero';
import { AnchorRegistry } from '@/components/landing/AnchorRegistry';
import { CorridorStrip } from '@/components/landing/CorridorStrip';
import { LeaderboardTeaser } from '@/components/landing/LeaderboardTeaser';
import { RatePreview } from '@/components/landing/RatePreview';
import { Faq } from '@/components/landing/Faq';
import { LandingSection } from '@/components/landing/LandingSection';
import { registryStats } from '@/constants';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://stellar-intel.vercel.app';

// Distinct from app/layout.tsx's site-wide default (#1056) — this page, plus
// /offramp, /anchors, and /history, previously all inherited that one title.
const TITLE = 'Stellar Intel — off-ramp anchor health record';
const DESCRIPTION =
  'Live health and reputation records for every registered Stellar off-ramp anchor — probed every five minutes and scored on fill rate, slippage, and settlement time.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: 'website',
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    images: [
      {
        url: new URL('/opengraph-image', SITE_URL).toString(),
        width: 1200,
        height: 630,
        alt: TITLE,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
};

const STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@type': 'FinancialProduct',
  name: 'Stellar Intel',
  // Was: "Compare off-ramp rates, on-ramp fees, yield protocols, and swap
  // routes across the Stellar network in real time." Three of those four are
  // not in the product at all.
  description:
    'A public health and reputation record for Stellar off-ramp anchors. Every registered anchor is probed every five minutes across four signals, with the scoring method published.',
  url: SITE_URL,
  applicationCategory: 'FinanceApplication',
};

/**
 * The page is ordered as an argument, not as a list of features: state the gap
 * between declaration and observation, show the registry that gap applies to,
 * then show the live record, then say how it is scored.
 *
 * Two sections were removed rather than restyled.
 *
 * `ComparisonTeaser` rendered a table of "Anchor A / Anchor B / Anchor C" with
 * invented rates and a ₦158,598 payout. It carried a "Sample" pill, but at a
 * glance it read as live data — on a product whose entire claim is the
 * difference between what is declared and what is observed. The live figures in
 * the hero and on /offramp are real and do the same job honestly.
 *
 * `FeatureGrid` was a three-column icon-plus-paragraph explainer whose second
 * step read "We pull live SEP-38 quotes from every integrated anchor" — a claim
 * docs/POSITIONING.md retires by name, since one of seven anchors advertises a
 * quote server at all. It is replaced by a plain numbered sequence with copy
 * that survives contact with the network.
 */
export default function HomePage() {
  const stats = registryStats();

  return (
    <div className="space-y-24 sm:space-y-32">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(STRUCTURED_DATA).replace(/</g, '\\u003c'),
        }}
      />

      <Hero />

      {/* The registry the record covers, read straight from constants/anchors.ts. */}
      <LandingSection delay={0}>
        <AnchorRegistry />
      </LandingSection>

      {/* Counts, stated as a sentence rather than three icons in boxes. */}
      <LandingSection delay={50}>
        <section aria-label="Registry coverage" className="border-border border-t pt-8">
          <dl className="grid grid-cols-3 gap-6">
            <div>
              <dt className="text-fg-muted font-mono text-xs tracking-wide">anchors</dt>
              <dd className="mt-2 font-mono text-3xl tabular-nums">{stats.anchors}</dd>
            </div>
            <div>
              <dt className="text-fg-muted font-mono text-xs tracking-wide">corridors</dt>
              <dd className="mt-2 font-mono text-3xl tabular-nums">{stats.corridors}</dd>
            </div>
            <div>
              <dt className="text-fg-muted font-mono text-xs tracking-wide">countries</dt>
              <dd className="mt-2 font-mono text-3xl tabular-nums">{stats.countries}</dd>
            </div>
          </dl>
        </section>
      </LandingSection>

      <LandingSection delay={75}>
        <CorridorStrip />
      </LandingSection>

      <LandingSection delay={100}>
        <LeaderboardTeaser />
      </LandingSection>

      <LandingSection delay={125}>
        <section aria-labelledby="live-rates-heading">
          <h2 id="live-rates-heading" className="type-title">
            Live rates
          </h2>
          <p className="text-secondary-text measure mt-4 text-base">
            Best available rate per corridor, right now. A dash means no anchor answered — which is
            itself a reading, and it is recorded as one.
          </p>
          <div className="mt-10">
            <RatePreview />
          </div>
        </section>
      </LandingSection>

      {/* How it works — a sequence, not a feature grid. No icons: an icon beside
          "pick your corridor" adds nothing a reader did not already have. */}
      <LandingSection delay={150}>
        <section aria-labelledby="how-heading">
          <h2 id="how-heading" className="type-title">
            How the record is made
          </h2>
          <ol className="border-border mt-10 border-t">
            {[
              {
                n: '01',
                title: 'Probe',
                body: 'Every registered anchor, every five minutes, across four signals: did the endpoint answer, does stellar.toml still parse, does the issuer still match the asset on-chain, was a quote available.',
              },
              {
                n: '02',
                title: 'Record',
                body: 'Each probe is an outcome, stored and replayable. Nothing is averaged away, and a sample too small to score is labelled small rather than dressed up as confidence it has not earned.',
              },
              {
                n: '03',
                title: 'Publish',
                body: 'The composite score, the method behind it, and the raw coverage are all public — on the web, through the API, and mirrored to a Soroban contract for permissionless reads.',
              },
            ].map((step) => (
              <li
                key={step.n}
                className="border-border grid grid-cols-1 gap-x-6 gap-y-2 border-b py-8 sm:grid-cols-12"
              >
                <span className="text-fg-muted font-mono text-xs tracking-wide sm:col-span-2">
                  {step.n}
                </span>
                <h3 className="text-base font-medium sm:col-span-3">{step.title}</h3>
                <p className="text-secondary-text text-base sm:col-span-7">{step.body}</p>
              </li>
            ))}
          </ol>

          {/* The execution path belongs on this page, but below the record and
              never above the fold — docs/POSITIONING.md is explicit that
              leading with the dependent half is how the earlier framing went
              wrong. tests/components/HomePage.test.tsx asserts both halves of
              that placement. */}
          <p className="text-secondary-text measure mt-10 text-base">
            Built on the record, there is an execution path: choose a corridor, then sign a single
            intent in Freighter and settle directly on Stellar &mdash; non-custodial, with the
            anchor taking custody under SEP-24 and this project never holding funds.
          </p>
        </section>
      </LandingSection>

      {/* Three real destinations, as a bordered list rather than tinted icon cards. */}
      <LandingSection delay={175}>
        <section aria-labelledby="build-heading">
          <h2 id="build-heading" className="type-title">
            Build on it
          </h2>
          <div className="border-border mt-10 grid grid-cols-1 border-t sm:grid-cols-3">
            {[
              {
                href: '/offramp',
                title: 'Off-ramp',
                body: 'Route a USDC off-ramp to the cheapest anchor, by country and corridor.',
              },
              {
                href: '/docs',
                title: 'Developer portal',
                body: 'API reference, quickstart, authentication, and integration docs for wallets, agents, and third-party apps.',
              },
              {
                href: '/docs/api',
                title: 'Interactive API',
                body: 'Every endpoint, live, in the playground. No key and no setup to read the record.',
              },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group border-border hover:bg-bg-subtle focus-visible:ring-accent focus-visible:ring-offset-background border-b p-6 transition-colors duration-100 ease-out focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none sm:border-r sm:last:border-r-0"
              >
                <h3 className="text-base font-medium">
                  {item.title}
                  <span
                    aria-hidden="true"
                    className="text-fg-muted group-hover:text-primary-text ml-2 inline-block transition-colors"
                  >
                    &rarr;
                  </span>
                </h3>
                <p className="text-secondary-text mt-2 text-sm">{item.body}</p>
              </Link>
            ))}
          </div>
        </section>
      </LandingSection>

      <LandingSection delay={200}>
        <Faq />
      </LandingSection>
    </div>
  );
}
