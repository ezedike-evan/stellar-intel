/**
 * tests/fixtures/router-multi-hop-routes.ts
 *
 * Candidate route data for multi-hop selection tests (#1088): competing
 * swap and off-ramp executors for a swap -> off-ramp chain. Rates,
 * reliability, latency, and reputation are deliberately spread so that no
 * two candidates in a set land within floating-point epsilon of each other
 * once scored — the winner must always come from ranking the data, never
 * from the order candidates happen to be listed in here.
 */

import type { Hop } from '@/lib/router/solve';

export const USDC: Hop['sellAsset'] = { code: 'USDC' };
export const XLM: Hop['sellAsset'] = { code: 'XLM' };
export const NGN: Hop['sellAsset'] = { code: 'NGN' };

export interface RouteCandidateFixture {
  id: string;
  /** Estimated output amount this candidate delivers for the hop. */
  estimatedOut: string;
  fee: string;
  reliability: number;
  latencyMs: number;
  reputationComposite: number;
}

/** Competing swap routes for USDC -> XLM. */
export const SWAP_CANDIDATES: RouteCandidateFixture[] = [
  {
    id: 'soroswap',
    estimatedOut: '418',
    fee: '2',
    reliability: 0.98,
    latencyMs: 300,
    reputationComposite: 0.95,
  },
  {
    id: 'aquarius',
    estimatedOut: '420',
    fee: '1.5',
    reliability: 0.9,
    latencyMs: 800,
    reputationComposite: 0.85,
  },
  {
    id: 'stellarx',
    estimatedOut: '415',
    fee: '2.2',
    reliability: 0.99,
    latencyMs: 150,
    reputationComposite: 0.97,
  },
];

/** Competing off-ramp routes for XLM -> NGN. */
export const OFFRAMP_CANDIDATES: RouteCandidateFixture[] = [
  {
    id: 'cowrie',
    estimatedOut: '628000',
    fee: '900',
    reliability: 0.97,
    latencyMs: 400,
    reputationComposite: 0.92,
  },
  {
    id: 'cashwyre',
    estimatedOut: '631000',
    fee: '1200',
    reliability: 0.85,
    latencyMs: 900,
    reputationComposite: 0.8,
  },
  {
    id: 'yellowcard',
    estimatedOut: '625000',
    fee: '700',
    reliability: 0.99,
    latencyMs: 250,
    reputationComposite: 0.96,
  },
];
