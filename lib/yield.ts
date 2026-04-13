import type { YieldRate, YieldAsset } from '@/types';

// MOCK — Blend protocol: replace with https://blend-mainnet.stellar.org API
const BLEND_RATES: YieldRate[] = [
  {
    protocolId: 'blend-usdc',
    protocolName: 'Blend Protocol',
    asset: 'USDC',
    apy: 0.062,
    tvl: 8_400_000,
    minDeposit: 1,
    lockupDays: 0,
    riskLevel: 'medium',
    description: 'Decentralized lending protocol on Stellar. Supply USDC to earn variable yield.',
    lastUpdated: new Date(),
    isMock: true,
  },
  {
    protocolId: 'blend-xlm',
    protocolName: 'Blend Protocol',
    asset: 'XLM',
    apy: 0.038,
    tvl: 5_200_000,
    minDeposit: 10,
    lockupDays: 0,
    riskLevel: 'medium',
    description: 'Supply XLM to Blend lending pools to earn variable interest.',
    lastUpdated: new Date(),
    isMock: true,
  },
];

// MOCK — DeFindex: replace with DeFindex API when available
const DEFINDEX_RATES: YieldRate[] = [
  {
    protocolId: 'defindex-usdc',
    protocolName: 'DeFindex',
    asset: 'USDC',
    apy: 0.071,
    tvl: 3_100_000,
    minDeposit: 10,
    lockupDays: 0,
    riskLevel: 'medium',
    description:
      'Automated yield vault aggregator built on Stellar. Optimises across multiple strategies.',
    lastUpdated: new Date(),
    isMock: true,
  },
];

// MOCK — Franklin Templeton BENJI
const BENJI_RATES: YieldRate[] = [
  {
    protocolId: 'benji-usdc',
    protocolName: 'Franklin Templeton (BENJI)',
    asset: 'USDC',
    apy: 0.052,
    tvl: 280_000_000,
    minDeposit: 1,
    lockupDays: 1,
    riskLevel: 'low',
    description:
      'Tokenised US government money market fund by Franklin Templeton. Regulated, low-risk.',
    lastUpdated: new Date(),
    isMock: true,
  },
];

// MOCK — Ondo USDY
const USDY_RATES: YieldRate[] = [
  {
    protocolId: 'ondo-usdy',
    protocolName: 'Ondo Finance (USDY)',
    asset: 'USDY',
    apy: 0.049,
    tvl: 410_000_000,
    minDeposit: 500,
    lockupDays: 40,
    riskLevel: 'low',
    description: 'Yield-bearing stablecoin backed by US Treasuries. Requires KYC.',
    lastUpdated: new Date(),
    isMock: true,
  },
];

export async function fetchYieldRates(asset?: YieldAsset): Promise<YieldRate[]> {
  const all = [...BLEND_RATES, ...DEFINDEX_RATES, ...BENJI_RATES, ...USDY_RATES];
  const filtered = asset ? all.filter((r) => r.asset === asset) : all;

  const sorted = [...filtered].sort((a, b) => b.apy - a.apy);
  if (sorted.length > 0) sorted[0].isBest = true;

  return sorted;
}
