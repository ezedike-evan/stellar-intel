// ─── Anchor / Off-ramp / On-ramp ────────────────────────────────────────────

export type DepositMethod = 'bank_transfer' | 'mobile_money' | 'cash' | 'card';

export interface AnchorInfo {
  id: string;
  name: string;
  domain: string;
  logoUrl?: string;
  supportedCountries: string[];
  supportedCurrencies: string[];
  depositMethods: DepositMethod[];
}

export interface AnchorRate {
  anchorId: string;
  anchorName: string;
  logoUrl?: string;
  // Off-ramp: USDC → fiat
  exchangeRate: number; // units of local currency per 1 USDC
  fee: number; // flat fee in USDC
  feePercent: number; // percentage fee (0.01 = 1%)
  minAmount: number; // minimum in USDC
  maxAmount: number; // maximum in USDC
  estimatedTime: string; // e.g. "1–2 hours"
  depositMethods: DepositMethod[];
  country: string;
  currency: string; // ISO 4217
  totalReceived?: number; // computed: (amount - fee) * exchangeRate
  isBest?: boolean;
  isWorst?: boolean;
  lastUpdated: Date;
  isMock?: boolean;
}

// ─── Yield ───────────────────────────────────────────────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high';
export type YieldAsset = 'USDC' | 'XLM' | 'USDY' | 'EURC';

export interface YieldRate {
  protocolId: string;
  protocolName: string;
  logoUrl?: string;
  asset: YieldAsset;
  apy: number; // 0.05 = 5%
  tvl: number; // USD value
  minDeposit: number;
  lockupDays: number; // 0 = no lockup
  riskLevel: RiskLevel;
  description: string;
  isBest?: boolean;
  lastUpdated: Date;
  isMock?: boolean;
}

// ─── Swap ────────────────────────────────────────────────────────────────────

export type SwapSource = 'SDEX' | 'Soroswap' | 'Phoenix' | 'Aquarius';

export interface SwapRoute {
  routeId: string;
  source: SwapSource;
  fromAsset: StellarAsset;
  toAsset: StellarAsset;
  fromAmount: number;
  toAmount: number;
  price: number; // toAmount / fromAmount
  priceImpact: number; // 0.003 = 0.3%
  fee: number; // in fromAsset units
  path: StellarAsset[]; // intermediate hops including from/to
  estimatedTime: string;
  isBest?: boolean;
  lastUpdated: Date;
  isMock?: boolean;
}

export interface StellarAsset {
  code: string;
  issuer?: string; // undefined for XLM (native)
  name: string;
  logoUrl?: string;
}

// ─── Network stats ───────────────────────────────────────────────────────────

export interface NetworkStats {
  totalAnchors: number;
  bestUsdcOfframpRate: number | null;
  bestUsdcOfframpAnchor: string | null;
  highestYieldApy: number | null;
  highestYieldProtocol: string | null;
  lastUpdated: Date;
}

// ─── Shared UI ───────────────────────────────────────────────────────────────

export type SortDirection = 'asc' | 'desc';
export type OfframpSortKey = 'rate' | 'fee' | 'time' | 'total';
export type YieldSortKey = 'apy' | 'tvl' | 'risk' | 'lockup';
export type SwapSortKey = 'price' | 'impact' | 'fee';

export interface Country {
  code: string; // ISO 3166-1 alpha-2
  name: string;
  currency: string; // ISO 4217
  currencySymbol: string;
  flag: string;
}
