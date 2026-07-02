import Link from 'next/link';
import { ArrowDownRight, Globe, Landmark, Route } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Hero } from '@/components/landing/Hero';
import { StatBar } from '@/components/landing/StatBar';
import { CorridorStrip } from '@/components/landing/CorridorStrip';
import { ComparisonTeaser } from '@/components/landing/ComparisonTeaser';
import { Faq } from '@/components/landing/Faq';
import { registryStats } from '@/constants';

export default function HomePage() {
  const stats = registryStats();
  return (
    <div className="space-y-8 sm:space-y-16">
      {/* Hero */}
      <Hero />

      {/* Stat bar — counts derived from the anchor registry */}
      <StatBar
        stats={[
          { icon: Landmark, value: stats.anchors, label: 'Anchors tracked' },
          { icon: Route, value: stats.corridors, label: 'Corridors live' },
          { icon: Globe, value: stats.countries, label: 'Countries reachable' },
        ]}
      />

      {/* Supported corridors */}
      <CorridorStrip />

      {/* Comparison teaser */}
      <ComparisonTeaser />

      {/* Module card */}
      <section>
        <h2 className="mb-6 text-xl font-semibold text-gray-900 dark:text-white">
          Start executing
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link href="/offramp">
            <Card className="group h-full min-h-[44px] cursor-pointer transition-shadow hover:shadow-md">
              <div className="mb-4 inline-flex rounded-lg p-2.5 bg-green-50 dark:bg-green-950/30">
                <ArrowDownRight className="h-5 w-5 text-green-600" />
              </div>
              <h3 className="mb-2 font-semibold text-gray-900 dark:text-white">Off-ramp</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Route a USDC off-ramp to the cheapest anchor, by country and corridor.
              </p>
            </Card>
          </Link>
        </div>
      </section>

      {/* Explainer */}
      <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-700 sm:p-6">
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">How it works</h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {[
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
          ].map(({ step, title, body }) => (
            <div key={step} className="flex gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                {step}
              </div>
              <div>
                <div className="font-medium text-gray-900 dark:text-white">{title}</div>
                <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">{body}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <Faq />
    </div>
  );
}
