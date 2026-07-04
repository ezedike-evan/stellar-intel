import Link from 'next/link';
import { ArrowDownRight, Globe, Landmark, Route } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Hero } from '@/components/landing/Hero';
import { StatBar } from '@/components/landing/StatBar';
import { CorridorStrip } from '@/components/landing/CorridorStrip';
import { ComparisonTeaser } from '@/components/landing/ComparisonTeaser';
import { Faq } from '@/components/landing/Faq';
import { FeatureGrid } from '@/components/landing/FeatureGrid';
import { LandingSection } from '@/components/landing/LandingSection';
import { registryStats } from '@/constants';

const HOW_IT_WORKS_STEPS = [
  {
    step: '01',
    title: 'Pick your corridor',
    body: 'Choose a destination country and the USDC amount to withdraw.',
  },
  {
    step: '02',
    title: 'Compare live quotes',
    body: 'We pull live SEP-38 quotes from every integrated anchor.',
  },
  {
    step: '03',
    title: 'Execute in one click',
    body: 'Sign once and settle directly on Stellar with Freighter — non-custodial.',
  },
];

export default function HomePage() {
  const stats = registryStats();
  return (
    <div className="space-y-8 sm:space-y-16">
      {/* Hero */}
      <LandingSection delay={0}>
        <Hero />
      </LandingSection>

      {/* Stat bar — counts derived from the anchor registry */}
      <LandingSection delay={100}>
        <StatBar
          stats={[
            {
              icon: <Landmark className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />,
              value: stats.anchors,
              label: 'Anchors tracked',
            },
            {
              icon: <Route className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />,
              value: stats.corridors,
              label: 'Corridors live',
            },
            {
              icon: <Globe className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />,
              value: stats.countries,
              label: 'Countries reachable',
            },
          ]}
        />
      </LandingSection>

      {/* Supported corridors */}
      <LandingSection delay={150}>
        <CorridorStrip />
      </LandingSection>

      {/* Comparison teaser */}
      <ComparisonTeaser />

      {/* Module card */}
      <LandingSection delay={200}>
        <h2 className="mb-6 text-xl font-semibold text-gray-900 dark:text-white">
          Start executing
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link
            href="/offramp"
            aria-label="Off-ramp — route a USDC off-ramp to the cheapest anchor, by country and corridor"
            className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-950"
          >
            <Card className="group h-full min-h-[44px] cursor-pointer transition-shadow hover:shadow-md dark:hover:shadow-gray-900/50">
              <div className="mb-4 inline-flex rounded-lg p-2.5 bg-green-50 dark:bg-green-900/40">
                <ArrowDownRight
                  className="h-5 w-5 text-green-600 dark:text-green-400"
                  aria-hidden="true"
                />
              </div>
              <h3 className="mb-2 font-semibold text-gray-900 dark:text-white">Off-ramp</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Route a USDC off-ramp to the cheapest anchor, by country and corridor.
              </p>
            </Card>
          </Link>
        </div>
      </LandingSection>

      {/* Explainer */}
      <LandingSection delay={300}>
        <FeatureGrid features={HOW_IT_WORKS_STEPS} />
      </LandingSection>

      {/* FAQ */}
      <LandingSection delay={350}>
        <Faq />
      </LandingSection>
    </div>
  );
}
