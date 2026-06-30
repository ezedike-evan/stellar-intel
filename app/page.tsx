import Link from 'next/link';
import { ArrowDownRight, Globe } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Hero } from '@/components/landing/Hero';
import { StatBar } from '@/components/landing/StatBar';
import { CorridorStrip } from '@/components/landing/CorridorStrip';
import { KNOWN_ANCHORS } from '@/constants';

export default function HomePage() {
  return (
    <div className="space-y-16">
      {/* Hero */}
      <Hero />

      {/* Stat bar */}
      <StatBar stats={[{ icon: Globe, value: KNOWN_ANCHORS.length, label: 'Anchors tracked' }]} />

      {/* Supported corridors */}
      <CorridorStrip />

      {/* Module card */}
      <section>
        <h2 className="mb-6 text-xl font-semibold text-gray-900 dark:text-white">
          Start transacting
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link href="/offramp">
            <Card className="group h-full cursor-pointer transition-shadow hover:shadow-md">
              <div className="mb-4 inline-flex rounded-lg p-2.5 bg-green-50 dark:bg-green-950/30">
                <ArrowDownRight className="h-5 w-5 text-green-600" />
              </div>
              <h3 className="mb-2 font-semibold text-gray-900 dark:text-white">Off-ramp</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Execute USDC off-ramps across Stellar anchors by country and corridor.
              </p>
            </Card>
          </Link>
        </div>
      </section>

      {/* Explainer */}
      <section className="rounded-xl border border-gray-200 p-6 dark:border-gray-700">
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">How it works</h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {[
            {
              step: '01',
              title: 'Pick your corridor',
              body: 'Select the country and amount you want to withdraw.',
            },
            {
              step: '02',
              title: 'Compare live rates',
              body: 'We fetch real SEP-24 rates from all supported Stellar anchors.',
            },
            {
              step: '03',
              title: 'Execute in one click',
              body: 'Select the best option and execute directly on Stellar via Freighter.',
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
    </div>
  );
}
