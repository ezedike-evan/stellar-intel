import type { Anchor, Corridor, FeatureGatedAnchorAssetCode, StellarAsset } from '@/types';
import { USDC_ISSUER } from '@/lib/config';

// ─── USDC asset ───────────────────────────────────────────────────────────────

export const USDC_ASSET: StellarAsset = {
  code: 'USDC',
  issuer: USDC_ISSUER,
  name: 'USD Coin',
};

// USDC remains the default registry asset. USDT entries can be onboarded now,
// but the rate path will ignore them unless this deployment flag is explicitly on.
const enabledFlagValues = new Set(['1', 'on', 'true']);

export const ANCHOR_ASSET_FLAGS: Record<FeatureGatedAnchorAssetCode, boolean> = {
  USDT: enabledFlagValues.has((process.env.NEXT_PUBLIC_USDT_ENABLED ?? '').toLowerCase()),
};

/** Returns whether an anchor asset is available to the live rate path. */
export function isAnchorAssetEnabled(assetCode: string): boolean {
  if (assetCode === 'USDT') return ANCHOR_ASSET_FLAGS.USDT;
  return true;
}

// ─── Anchors ──────────────────────────────────────────────────────────────────

export const ANCHORS: Anchor[] = [
  {
    id: 'moneygram',
    name: 'MoneyGram',
    homeDomain: 'stellar.moneygram.com',
    serviceDomain: 'stellar.moneygram.com',
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
    seps: ['sep6'],
  },
  {
    id: 'anclap',
    name: 'Anclap',
    homeDomain: 'anclap.com',
    corridors: ['usdc-ars', 'usdc-pen'],
    assetCode: 'USDC',
    assetIssuer: USDC_ISSUER,
    seps: ['sep6', 'sep24'],
  },
  // ntokens.com: BRL fiat corridor — SEP-24 withdraw enabled, SEP-6 + SEP-31 also present.
  // Verified 2026-06-26. TOML: TRANSFER_SERVER_SEP0024 = https://ntokens-box.bpventures.us/sep24
  // /info: withdraw.BRL.enabled = true. Issues BRL token anchored 1:1 to Brazilian Real.
  {
    id: 'ntokens',
    name: 'nTokens',
    homeDomain: 'ntokens.com',
    serviceDomain: 'ntokens-box.bpventures.us',
    corridors: ['brl-brl'],
    assetCode: 'BRL',
    assetIssuer: 'GDVKY2GU2DRXWTBEYJJWSFXIGBZV6AZNBVVSUHEPZI54LIS6BA7DVVSP',
  },
];

export const KNOWN_ANCHORS = ANCHORS;

export const ANCHOR_HOME_DOMAINS: Record<string, string> = Object.fromEntries(
  ANCHORS.map((anchor) => [anchor.id, anchor.homeDomain])
);

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
  {
    id: 'usdc-eur',
    from: 'USDC',
    to: 'EUR',
    countryCode: 'DE',
    countryName: 'Germany',
  },
  {
    id: 'brl-brl',
    from: 'BRL',
    to: 'BRL',
    countryCode: 'BR',
    countryName: 'Brazil',
  },
];
