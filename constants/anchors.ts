import type { Anchor, Corridor, FeatureGatedAnchorAssetCode, StellarAsset } from '@/types';
import { USDC_ISSUER } from '@/lib/config';
import { flags } from '@/lib/flags';

// ─── USDC asset ───────────────────────────────────────────────────────────────

export const USDC_ASSET: StellarAsset = {
  code: 'USDC',
  issuer: USDC_ISSUER,
  name: 'USD Coin',
};

// USDC remains the default registry asset. USDT entries can be onboarded now,
// but the rate path will ignore them unless this deployment flag is explicitly on.
const enabledFlagValues = new Set(['1', 'on', 'true']);

const ANCHOR_ASSET_FLAGS: Record<FeatureGatedAnchorAssetCode, boolean> = {
  USDT: enabledFlagValues.has((process.env.NEXT_PUBLIC_USDT_ENABLED ?? '').toLowerCase()),
};

/** Returns whether an anchor asset is available to the live rate path. */
export function isAnchorAssetEnabled(assetCode: string): boolean {
  if (assetCode === 'USDT') return ANCHOR_ASSET_FLAGS.USDT;
  return true;
}

// ─── Anchors ──────────────────────────────────────────────────────────────────

// Bucketed Anchors (not integrated):
// - fchain.io: SEP-6 /info only lists crypto assets (BCH, ETH, USDT, WICC, XRP, STM). No fiat settlement available. (Verified 2026-06-28)

export const ANCHORS: Anchor[] = [
  {
    id: 'moneygram',
    name: 'MoneyGram',
    homeDomain: 'stellar.moneygram.com',
    serviceDomain: 'stellar.moneygram.com',
    corridors: ['usdc-ngn', 'usdc-kes', 'usdc-ghs', 'usdc-mxn', 'usdc-brl'],
    assetCode: 'USDC',
    assetIssuer: USDC_ISSUER,
    seps: ['sep10', 'sep24'],
  },
  {
    // SEP-6 programmatic withdraw — rates are indicative, not firm quotes
    id: 'cowrie',
    name: 'Cowrie Exchange',
    homeDomain: 'cowrie.exchange',
    serviceDomain: 'api.cowrie.exchange',
    corridors: ['usdc-ngn'],
    seps: ['sep6', 'sep10'],
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
    seps: ['sep6', 'sep24'],
  },
  // ngnc.online: NGN fiat corridor — SEP-24 withdraw enabled.
  // Verified 2026-06-29. TOML: TRANSFER_SERVER_SEP0024 present. /info: withdraw.USDC.enabled = true.
  // Serves USDC→NGN corridor for Nigeria.
  {
    id: 'ngnc',
    name: 'NGNC',
    homeDomain: 'ngnc.online',
    corridors: ['usdc-ngn'],
    assetCode: 'USDC',
    assetIssuer: USDC_ISSUER,
    seps: ['sep24'],
  },
  // mykobo.co: DELISTED 2026-09-06. Its stellar.toml still advertises both
  // TRANSFER_SERVER and TRANSFER_SERVER_SEP0024 on stellar.mykobo.co, and that
  // host has no A or AAAA record — every SEP-6 and SEP-24 call fails to connect.
  // The TOML itself still serves 200, so a check that stops at the TOML reads
  // this anchor as healthy; the nightly probe follows the advertised endpoint
  // and does not. Nothing here is fixable from our side: re-list when MyKobo
  // publishes a transfer server that resolves. Was: EURC issuer
  // GAQRF3UGHBT6JYQZ7YSUYCIYWAF4T2SAA5237Q5LIQYJOHHFAWDXZ7NM, usdc-eur,
  // seps sep6/sep24/sep31.
  // ultracapital.xyz: NOT integrated — crypto yield-token platform, no fiat off-ramp.
  // Verified 2026-06-29. TOML present (SEP-6 + SEP-24). SEP-24 /info withdraw assets: ETH,
  // yUSDC, BTC, yBTC, yXLM, yETH. anchor_asset_type = "crypto" throughout — no fiat corridor.
  // Decision (B031): bucket as crypto-only; revisit if a fiat asset is added.

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
    seps: ['sep6', 'sep24', 'sep31'],
  },
  // zeam.money: ZAR fiat corridor — SEP-24 withdraw/deposit enabled.
  // Verified 2026-08-28. The home domain publishes the SEP-24 endpoint; the
  // legacy anchor.zeam.money service host returns 404 for stellar.toml.
  // /info: deposit/withdraw for USDC enabled.
  //
  // Re-probed 2026-08-04 (#720): also declares
  // ANCHOR_QUOTE_SERVER = https://anchor.zeam.money/sep38, which the `seps`
  // array omitted. It is the ONLY registered anchor advertising SEP-38.
  //
  // Note the corridor mismatch: this entry claims `usdc-zar`, but the SEP-38
  // /info offers USDC and BRL only — no ZAR asset at all. The ZAR corridor may
  // still be served over SEP-24; the two rails are not required to cover the
  // same currencies. Flagged rather than silently "corrected", because dropping
  // usdc-zar would change corridor routing on the strength of one rail's
  // capability list. See tests/fixtures/sep38/capability-capture.json.
  {
    id: 'zeam',
    name: 'Zeam Money',
    homeDomain: 'zeam.money',
    corridors: ['usdc-zar'],
    assetCode: 'USDC',
    assetIssuer: USDC_ISSUER,
    seps: ['sep24', 'sep31', 'sep38'],
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
  // ─── v1.1 target corridors ────────────────────────────────────────────────
  // Scaffolded ahead of anchor onboarding (see .github/ISSUE_TEMPLATE/anchor-onboard.yml).
  // Gated behind the `v11Corridors` flag AND anchor coverage — see V11_CORRIDOR_IDS
  // and VISIBLE_CORRIDORS below. They remain in CORRIDORS so lookups and validation
  // resolve, but stay out of selectors until an anchor serves them.
  {
    id: 'usdc-zar',
    from: 'USDC',
    to: 'ZAR',
    countryCode: 'ZA',
    countryName: 'South Africa',
  },
  // XOF is the West African CFA franc, shared across UEMOA states. We anchor the
  // corridor's country metadata to Senegal as the primary onboarding market.
  {
    id: 'usdc-xof',
    from: 'USDC',
    to: 'XOF',
    countryCode: 'SN',
    countryName: 'Senegal',
  },
];

/**
 * Corridor IDs gated behind the `v11Corridors` feature flag. These are defined
 * in CORRIDORS but excluded from VISIBLE_CORRIDORS until the flag is enabled and
 * at least one anchor serves them.
 */
export const V11_CORRIDOR_IDS: ReadonlySet<string> = new Set([
  'usdc-zar',
  'usdc-xof',
  // usdc-eur is not a v1.1 scaffold -- it was live until mykobo, its only
  // anchor, was delisted above. It sits here because this set is what
  // VISIBLE_CORRIDORS checks anchor coverage against, so listing it keeps the
  // corridor resolvable for lookups while hiding it from selectors until an
  // anchor serves it again. Same state it was in before mykobo onboarded.
  'usdc-eur',
]);

/**
 * Maintainer-set "typical" USDC amounts per corridor, used to seed the
 * amount input's quick-select chips. Reasonable round numbers per corridor,
 * not derived from real transaction volume.
 */
export const TYPICAL_AMOUNTS: Record<string, number[]> = {
  'usdc-ngn': [50, 100, 200],
  'usdc-kes': [50, 100, 250],
  'usdc-ghs': [50, 100, 200],
  'usdc-mxn': [100, 300, 500],
  'usdc-brl': [100, 250, 500],
  'usdc-ars': [50, 150, 300],
  'usdc-pen': [50, 150, 300],
  'usdc-eur': [100, 300, 500],
  'brl-brl': [100, 250, 500],
  'usdc-zar': [50, 150, 300],
  'usdc-xof': [50, 100, 200],
};

/** Corridor IDs that at least one anchor in the registry currently serves. */
const SERVED_CORRIDOR_IDS: ReadonlySet<string> = new Set(
  ANCHORS.flatMap((anchor) => anchor.corridors)
);

/**
 * Corridors safe to surface in selectors. Non-gated corridors always appear;
 * v1.1 gated corridors appear only when the `v11Corridors` flag is on AND an
 * anchor serves them — so a scaffolded corridor stays hidden until it's live.
 */
export const VISIBLE_CORRIDORS: Corridor[] = CORRIDORS.filter((c) => {
  if (!V11_CORRIDOR_IDS.has(c.id)) return true;
  return flags.v11Corridors && SERVED_CORRIDOR_IDS.has(c.id);
});

// ─── Registry stats ─────────────────────────────────────────────────────────────

/** Headline registry counts for the landing stat bar. */
export interface RegistryStats {
  /** Number of integrated anchors. */
  anchors: number;
  /** Distinct corridors actually served by at least one anchor. */
  corridors: number;
  /** Distinct destination countries reachable through those corridors. */
  countries: number;
}

const COUNT_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
] as const;

/**
 * The registry size, spelled out, for prose that names the count. Copy on the
 * home page and in llms.txt used to hard-code "seven" and went stale the moment
 * an anchor was delisted -- on a page whose own comment says it "cannot drift
 * from the registry it describes". Falls back to digits past twelve.
 */
export const ANCHOR_COUNT_WORD: string = COUNT_WORDS[ANCHORS.length] ?? String(ANCHORS.length);

/**
 * Derive headline counts from the registry (#B074). Corridors and countries are
 * counted from the corridors anchors actually serve — not the full corridor
 * table — so the stat bar never advertises a route with no anchor behind it.
 */
export function registryStats(): RegistryStats {
  const servedCorridorIds = new Set(ANCHORS.flatMap((anchor) => anchor.corridors));
  const countryCodes = new Set(
    CORRIDORS.filter((corridor) => servedCorridorIds.has(corridor.id)).map(
      (corridor) => corridor.countryCode
    )
  );
  return {
    anchors: ANCHORS.length,
    corridors: servedCorridorIds.size,
    countries: countryCodes.size,
  };
}
