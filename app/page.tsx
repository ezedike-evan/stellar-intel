import Link from 'next/link';
import {
  ArrowDownRight,
  ArrowUpRight,
  TrendingUp,
  ArrowLeftRight,
  Zap,
  Globe,
  BarChart3,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { fetchAnchorRates } from '@/lib/anchors';
import { fetchYieldRates } from '@/lib/yield';
import { KNOWN_ANCHORS } from '@/constants';
import { formatPercent } from '@/lib/stellar';

const MODULES = [
  {
    href: '/offramp',
    label: 'Off-ramp',
    description: 'Compare USDC withdrawal rates across Stellar anchors by country and corridor.',
    icon: ArrowDownRight,
    color: 'text-green-600',
    bg: 'bg-green-50 dark:bg-green-950/30',
  },
  {
    href: '/onramp',
    label: 'On-ramp',
    description: 'Compare deposit fees and methods to buy USDC across all supported anchors.',
    icon: ArrowUpRight,
    color: 'text-blue-600',
    bg: 'bg-blue-50 dark:bg-blue-950/30',
  },
  {
    href: '/yield',
    label: 'Yield',
    description:
      'Compare APY across Blend, DeFindex, BENJI, USDY and other Stellar yield protocols.',
    icon: TrendingUp,
    color: 'text-purple-600',
    bg: 'bg-purple-50 dark:bg-purple-950/30',
  },
  {
    href: '/swap',
    label: 'Swap Router',
    description: 'Find the best swap price across SDEX order books and Stellar AMMs.',
    icon: ArrowLeftRight,
    color: 'text-orange-600',
    bg: 'bg-orange-50 dark:bg-orange-950/30',
  },
];

async function getStats() {
  try {
    const [ngRates, allYield] = await Promise.all([
      fetchAnchorRates('NG', 'NGN', 100),
      fetchYieldRates(),
    ]);
    const best = ngRates.find((r) => r.isBest);
    const bestYield = allYield.find((r) => r.isBest);
    return {
      totalAnchors: KNOWN_ANCHORS.length,
      bestUsdcOfframpRate: best?.exchangeRate ?? null,
      bestUsdcOfframpAnchor: best?.anchorName ?? null,
      highestYieldApy: bestYield?.apy ?? null,
      highestYieldProtocol: bestYield?.protocolName ?? null,
    };
  } catch {
    return {
      totalAnchors: KNOWN_ANCHORS.length,
      bestUsdcOfframpRate: null,
      bestUsdcOfframpAnchor: null,
      highestYieldApy: null,
      highestYieldProtocol: null,
    };
  }
}

export default async function HomePage() {
  const stats = await getStats();

  return (
    <div className="space-y-16">
      {/* Hero */}
      <section className="py-12 text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-blue-50 px-4 py-1.5 text-sm font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
          <Zap className="h-3.5 w-3.5" />
          Built on Stellar · SCF Submission
        </div>
        <h1 className="mb-4 text-4xl font-bold tracking-tight text-gray-900 dark:text-white md:text-5xl">
          Find the best rates on Stellar,
          <br />
          <span className="text-blue-600">in real time.</span>
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-gray-600 dark:text-gray-400">
          Compare off-ramp rates, on-ramp fees, yield protocols, and swap routes across the entire
          Stellar network. One click to execute.
        </p>
      </section>

      {/* Live stats bar */}
      <section className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex items-center gap-3">
            <Globe className="h-5 w-5 text-blue-600" />
            <div>
              <div className="text-xl font-bold text-gray-900 dark:text-white">
                {stats.totalAnchors}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Anchors tracked</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ArrowDownRight className="h-5 w-5 text-green-600" />
            <div>
              <div className="text-xl font-bold text-gray-900 dark:text-white">
                {stats.bestUsdcOfframpRate != null
                  ? `₦${stats.bestUsdcOfframpRate.toFixed(2)}`
                  : '—'}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Best USDC → NGN rate
                {stats.bestUsdcOfframpAnchor && (
                  <span className="ml-1 text-gray-400">({stats.bestUsdcOfframpAnchor})</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <BarChart3 className="h-5 w-5 text-purple-600" />
            <div>
              <div className="text-xl font-bold text-gray-900 dark:text-white">
                {stats.highestYieldApy != null ? formatPercent(stats.highestYieldApy) : '—'} APY
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Best yield
                {stats.highestYieldProtocol && (
                  <span className="ml-1 text-gray-400">({stats.highestYieldProtocol})</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Module cards */}
      <section>
        <h2 className="mb-6 text-xl font-semibold text-gray-900 dark:text-white">
          Choose a comparator
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {MODULES.map(({ href, label, description, icon: Icon, color, bg }) => (
            <Link key={href} href={href}>
              <Card className="group h-full cursor-pointer transition-shadow hover:shadow-md">
                <div className={`mb-4 inline-flex rounded-lg p-2.5 ${bg}`}>
                  <Icon className={`h-5 w-5 ${color}`} />
                </div>
                <h3 className="mb-2 font-semibold text-gray-900 dark:text-white">{label}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* Explainer */}
      <section className="rounded-xl border border-gray-200 p-6 dark:border-gray-700">
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">How it works</h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {[
            {
              step: '01',
              title: 'Pick your action',
              body: 'Off-ramp, on-ramp, earn yield, or swap — choose what you need.',
            },
            {
              step: '02',
              title: 'Compare live rates',
              body: 'We fetch rates from all Stellar anchors and protocols in real time, every 30 seconds.',
            },
            {
              step: '03',
              title: 'Execute in one click',
              body: 'Select the best option and execute directly on Stellar — no leaving the app.',
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
