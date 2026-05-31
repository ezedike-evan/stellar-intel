import type { Anchor, Corridor, StellarAsset } from '@/types';
import { USDC_ISSUER } from '@/lib/config';

// ─── USDC asset ───────────────────────────────────────────────────────────────

export const USDC_ASSET: StellarAsset = {
  code: 'USDC',
  issuer: USDC_ISSUER,
  name: 'USD Coin',
};

// ─── Anchors ──────────────────────────────────────────────────────────────────

export const ANCHORS: Anchor[] = [
  {
    id: 'moneygram',
    name: 'MoneyGram',
    homeDomain: 'stellar.moneygram.com',
    corridors: ['usdc-ngn', 'usdc-kes', 'usdc-ghs', 'usdc-mxn', 'usdc-brl'],
    assetCode: 'USDC',
    assetIssuer: USDC_ISSUER,
  },
  {
    id: 'cowrie',
    name: 'Cowrie Exchange',
    homeDomain: 'cowrie.exchange',
    corridors: ['usdc-ngn'],
    assetCode: 'USDC',
    assetIssuer: USDC_ISSUER,
  },
  {
    id: 'anclap',
    name: 'Anclap',
    homeDomain: 'anclap.com',
    corridors: ['usdc-ars', 'usdc-pen'],
    assetCode: 'USDC',
    assetIssuer: USDC_ISSUER,
  },
];

export const KNOWN_ANCHORS = ANCHORS;

export const ANCHOR_HOME_DOMAINS: Record<string, string> = {
  moneygram: 'stellar.moneygram.com',
  cowrie: 'cowrie.exchange',
  anclap: 'anclap.com',
} as const;

// ─── Corridors ────────────────────────────────────────────────────────────────

export const CORRIDORS: Corridor[] = [
  {
    id: 'usdc-ngn',
    from: 'USDC',
    to: 'NGN',
    countryCode: 'NG',
    countryName: 'Nigeria',
  },
  {
    id: 'usdc-kes',
    from: 'USDC',
    to: 'KES',
    countryCode: 'KE',
    countryName: 'Kenya',
  },
  {
    id: 'usdc-ghs',
    from: 'USDC',
    to: 'GHS',
    countryCode: 'GH',
    countryName: 'Ghana',
  },
  {
    id: 'usdc-mxn',
    from: 'USDC',
    to: 'MXN',
    countryCode: 'MX',
    countryName: 'Mexico',
  },
  {
    id: 'usdc-brl',
    from: 'USDC',
    to: 'BRL',
    countryCode: 'BR',
    countryName: 'Brazil',
  },
  {
    id: 'usdc-ars',
    from: 'USDC',
    to: 'ARS',
    countryCode: 'AR',
    countryName: 'Argentina',
  },
  {
    id: 'usdc-pen',
    from: 'USDC',
    to: 'PEN',
    countryCode: 'PE',
    countryName: 'Peru',
  },
];
