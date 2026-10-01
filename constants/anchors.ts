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
    sep10ClientDomain: true,
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
  // anclap.com: ARS and PEN fiat corridors — SEP-6 and SEP-24 deposit and withdraw enabled.
  // Verified 2026-09-23. TOML CURRENCIES: ARS issuer GCYE7C77EB5AWAA25R5XMWNI2EDOKTTFTTPZKM2SR5DI4B4WFD52DARS,
  // PEN issuer GA4TDPNUCZPTOHB3TKUYMDCRVATXKEADH7ZEYEBWJKQKE2UBFCYNBPEN.
  // /info: deposit [ARS, PEN], withdraw [ARS, PEN]. No USDC on either rail.
  {
    id: 'anclap',
    name: 'Anclap',
    homeDomain: 'anclap.com',
    corridors: ['ars-ars', 'pen-pen'],
    assetCode: 'ARS',
    assetIssuer: 'GCYE7C77EB5AWAA25R5XMWNI2EDOKTTFTTPZKM2SR5DI4B4WFD52DARS',
    seps: ['sep6', 'sep24'],
  },
  // ngnc.online: NGN fiat corridor — SEP-24 deposit/withdraw enabled for NGNC token.
  // Verified 2026-09-23. TOML: TRANSFER_SERVER_SEP0024 present.
  // /info: deposit [NGNC] (min 20,000), withdraw [NGNC] (min 10,000).
  // Issuer: GASBV6W7GGED66MXEVC7YZHTWWYMSVYEY35USF2HJZBLABLYIFQGXZY6, anchor_asset NGN.
  // Note: GHSC and KESC are status=pending in TOML and not currently on rail.
  // latamex.com (Settle Network): ARS and BRL fiat corridors — SEP-6 and SEP-24 deposit and withdraw.
  // Verified 2026-09-23. TOML at https://pubnet-sep.latamex.com/.well-known/stellar.toml:
  // TRANSFER_SERVER and TRANSFER_SERVER_SEP0024 = https://transfer-server.zetl.network,
  // WEB_AUTH_ENDPOINT = https://transfer-server.zetl.network/auth. CURRENCIES: ARST issuer
  // GCSAZVWXZKWS4XS223M5F54H2B6XPIIXZZGP7KEAIU6YSL5HDRGCI3DG (anchor_asset ARS), BRLT issuer
  // GCHQ3F2BF5P74DMDNOOGHT5DUCKC773AW5DTOFINC26W4KGYFPYDPRSO (anchor_asset BRL).
  // /info: deposit and withdraw [ARST, BRLT] enabled; plain USDC deposit/withdraw disabled;
  // USDC only via deposit-exchange / withdraw-exchange. No SEP-38.
  // The usdc-ars and usdc-brl corridors are SEP-6 withdraw-exchange (USDC in, ARS/BRL out):
  // rates are indicative (sep6-fee), never a firm SEP-38 quote.
  {
    id: 'latamex',
    name: 'Latamex',
    homeDomain: 'pubnet-sep.latamex.com',
    corridors: ['arst-ars', 'brlt-brl', 'usdc-ars', 'usdc-brl'],
    assetCode: 'ARST',
    assetIssuer: 'GCSAZVWXZKWS4XS223M5F54H2B6XPIIXZZGP7KEAIU6YSL5HDRGCI3DG',
    seps: ['sep6', 'sep10', 'sep24'],
  },
  {
    id: 'ngnc',
    name: 'NGNC',
    homeDomain: 'ngnc.online',
    corridors: ['ngnc-ngn'],
    assetCode: 'NGNC',
    assetIssuer: 'GASBV6W7GGED66MXEVC7YZHTWWYMSVYEY35USF2HJZBLABLYIFQGXZY6',
    seps: ['sep10', 'sep24'],
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
    // deposit disabled on SEP-6/SEP-24 /info (verified 2026-09-23)
    depositEnabled: false,
  },
  // zeam.money: verified payment rails for BRL and a separate ZAR claim.
  // Verified 2026-09-23. SEP-24 /info at https://anchor.zeam.money/sep24/info
  // lists deposit/withdraw asset pairs [USDC, native]; SEP-31 receive is [USDC].
  // SEP-38 /info at https://anchor.zeam.money/sep38/info advertises assets
  // stellar:USDC:..., stellar:BRL:..., and iso4217:BRL, with country_codes ["BR"].
  // No ZAR asset or country code appears anywhere in the live /info responses.
  // We keep the ZAR route on the registry but flag it as unverified pending an
  // interactive check, rather than silently rewriting the corridor claim.
  {
    id: 'zeam',
    name: 'Zeam Money',
    homeDomain: 'zeam.money',
    corridors: ['usdc-zar', 'usdc-brl'],
    unverifiedCorridors: ['usdc-zar'],
    assetCode: 'USDC',
    assetIssuer: USDC_ISSUER,
    seps: ['sep10', 'sep24', 'sep31', 'sep38'],
  },
  // ramp.aps.money: APS (Advanced Payment Solutions) runs a live SEP-24 USDC ramp,
  // found by the anchor census outside the `anchor` tag. Verified 2026-09-23.
  // TOML: TRANSFER_SERVER_SEP0024 = https://ramp.aps.money/gollum/api/v1/sep0024,
  // WEB_AUTH_ENDPOINT = https://ramp.aps.money/gollum/api/v1/sep0010 (alive, 400).
  // USDC issuer = GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN (canonical).
  // /info: deposit.USDC enabled (min 9.34, max 669.61, 4.5% + 0.25), withdraw.USDC
  // enabled (min 32.33, max 681.81, 1% + 5). No SEP-6, no SEP-38.
  // The SDF directory lists BRL, EUR and CLP payout currencies; /info does not
  // expose them, so all three corridors are registered but flagged unverified:
  // payout currency per corridor unverified (no interactive session run).
  {
    id: 'aps',
    name: 'APS Ramp',
    homeDomain: 'ramp.aps.money',
    corridors: ['usdc-brl', 'usdc-eur', 'usdc-clp'],
    unverifiedCorridors: ['usdc-brl', 'usdc-eur', 'usdc-clp'],
    assetCode: 'USDC',
    assetIssuer: USDC_ISSUER,
    seps: ['sep10', 'sep24'],
  },
  // bitnovo.com: EUR buy/sell provider bringing back usdc-eur, orphaned by the
  // MyKobo delisting. Verified 2026-09-23. SEP-24 at
  // https://stellar.bitnovo.com/sep24 (`TRANSFER_SERVER_SEP0024` in
  // https://stellar.bitnovo.com/.well-known/stellar.toml); /info lists
  // deposit/withdraw asset pairs [EUR, native, USDC] with `fee.enabled = false`;
  // SEP-10 /auth is alive. The TOML CURRENCIES list only USDC (canonical issuer)
  // and XLM — the EUR entry on the rail is not a declared TOML asset, so EUR is
  // NOT registered as a sold asset here. Payout is not proven end-to-end, so the
  // corridor stays flagged unverified pending an interactive check.
  {
    id: 'bitnovo',
    name: 'Bitnovo',
    homeDomain: 'stellar.bitnovo.com',
    corridors: ['usdc-eur'],
    unverifiedCorridors: ['usdc-eur'],
    assetCode: 'USDC',
    assetIssuer: USDC_ISSUER,
    seps: ['sep10', 'sep24'],
  },
  // perahub.com.ph (PETNET, Philippines): a live SEP-31 receiving anchor paying PHP.
  // Tracked for health and survey coverage, never routed — see the usdc-php corridor
  // entry below for why. Verified 2026-09-23.
  //
  // TOML (https://stellar.perahub.com.ph/.well-known/stellar.toml) advertises exactly
  // one transfer server: DIRECT_PAYMENT_SERVER = https://stellar.perahub.com.ph/sep31,
  // alongside WEB_AUTH_ENDPOINT (SEP-10) and a SEP-12 KYC server. No TRANSFER_SERVER
  // (SEP-6) and no TRANSFER_SERVER_SEP0024 (SEP-24) are present, so there is no deposit
  // rail on either side.
  // GET /sep31/info: receive USDC enabled, min 0.1, max 1000, fee 5 + 1%; the transaction
  // field set includes peso_amount. SEP-10 /auth answers (400 without a challenge token);
  // SEP-12 returns 403 to an unauthenticated GET. TOML CURRENCIES lists USDC under the
  // canonical issuer, so the registered assetIssuer is USDC_ISSUER — no look-alike.
  {
    id: 'perahub',
    name: 'PeraHub',
    homeDomain: 'stellar.perahub.com.ph',
    corridors: [],
    sep31Corridors: ['usdc-php'],
    assetCode: 'USDC',
    assetIssuer: USDC_ISSUER,
    seps: ['sep10', 'sep31'],
  },
  // kbtrading.org (KB Trading, BVI) issues CLPX, the Chilean peso token. Verified
  // 2026-09-29 against its own endpoints.
  //
  // The `seps` list here is honest about what the anchor advertises: it really
  // does run SEP-6, SEP-24, SEP-10 and SEP-31, so it is transfer-capable by the
  // mechanical test and isSep31Only() is false for it. Those rails still cannot
  // move the clpx-clp corridor, which is why `corridors` is empty and the lane is
  // recorded in sep31Corridors instead:
  //
  //   GET /sep24/info  deposit.CLPX  enabled, min 14000, max 3500000, no fee
  //                   deposit.BTCLN enabled, min 1000,  max 507059, 1%
  //                   withdraw.CLPX { enabled: false }  <- names it, then refuses it
  //                   withdraw.BTCLN enabled, min 10000, max 507059 (lightning)
  //   GET /sep6/info   the identical shape (withdraw.CLPX disabled; the BTCLN
  //                   withdraw carries a lightning/BOLT11 `type`)
  //   GET /sep31/info  receive.CLPX enabled, min 14000, max 8500000, transfer
  //                   type bank_account
  //
  // So CLPX goes in over SEP-6/SEP-24, but the only way back out to fiat is
  // SEP-31, and SEP-31 is never routed: receiving on it needs a bilateral
  // sending-anchor agreement. A CLPX withdrawal on either programmatic rail is
  // what would make this lane routable, and the anchor currently advertises it as
  // disabled — re-read the withdraw map before treating this lane as anything
  // other than tracked.
  //
  // TOML (https://kbtrading.org/.well-known/stellar.toml, also served for
  // clpx.finance): TRANSFER_SERVER = https://kbtrading.org/sep6,
  // TRANSFER_SERVER_SEP0024 = https://kbtrading.org/sep24, DIRECT_PAYMENT_SERVER =
  // https://kbtrading.org/sep31, WEB_AUTH_ENDPOINT = https://kbtrading.org/auth
  // (responds 400 without a challenge token), KYC_SERVER =
  // https://kbtrading.org/kyc. The Anchor `seps` union has no sep12 member, so
  // SEP-12 is left out rather than misfiled under another protocol.
  // CURRENCIES: CLPX issuer GDYSPBVZHPQTYMGSYNOHRZQNLB3ZWFVQ2F7EP7YBOLRGD42XIC3QUX5G,
  // anchor_asset_type fiat, anchor_asset CLP, status live, display_decimals 2.
  // XCHF, IDRT, TRYB, XSGD and KRW are listed there too, but every one of them
  // is status=test, so they are deliberately not registered here.
  {
    id: 'clpx',
    name: 'KB Trading (CLPX)',
    homeDomain: 'kbtrading.org',
    corridors: [],
    sep31Corridors: ['clpx-clp'],
    assetCode: 'CLPX',
    assetIssuer: 'GDYSPBVZHPQTYMGSYNOHRZQNLB3ZWFVQ2F7EP7YBOLRGD42XIC3QUX5G',
    seps: ['sep6', 'sep10', 'sep24', 'sep31'],
  },
  // sofizpay.com: DZT (Algerian dinar stablecoin) issuer with live SEP-6 and
  // SEP-24 deposit/withdraw rails — the first Algerian corridor on Stellar.
  // Verified 2026-09-23, re-checked 2026-09-29. Both TRANSFER_SERVER and
  // TRANSFER_SERVER_SEP0024 are "https://sofizpay.com/sep24/" (trailing
  // slash); SEP-24 /info lists deposit/withdraw asset pairs [DZT] with
  // deposit min 500 and withdraw min 1000 at fee 200 + 1%; SEP-10 /auth is
  // alive and a KYC_SERVER is present. The TOML CURRENCIES list only DZT
  // (issuer GCAZI7YBLIDJWIVEL7ETNAZGPP3LC24NO6KAOBWZHUERXQ7M5BC52DLV, no
  // anchor_asset declared), so DZT is registered as the sold asset directly.
  {
    id: 'sofizpay',
    name: 'SofizPay',
    homeDomain: 'sofizpay.com',
    corridors: ['dzt-dzd'],
    assetCode: 'DZT',
    assetIssuer: 'GCAZI7YBLIDJWIVEL7ETNAZGPP3LC24NO6KAOBWZHUERXQ7M5BC52DLV',
    seps: ['sep6', 'sep10', 'sep24'],
  },
  // finclusive.com: US licensed money transmitter (North Carolina) advertising
  // live SEP-6, SEP-24 and SEP-31 rails for USDC with zero fees. Verified
  // 2026-09-23. SEP-6 and SEP-24 both live at
  // https://api.finclusive.com/stellar/transfer, SEP-31 at
  // https://api.finclusive.com/stellar/directpayment; /info lists
  // deposit/withdraw asset pairs [XLM, USDC] enabled on both rails; SEP-10
  // authentication is alive. The TOML USDC issuer is the canonical one, with
  // anchor_asset USD — but /info shows no withdraw types, so the fiat leg is
  // only evidenced by the SDF directory (USD) and the corridor stays flagged
  // unverified. Confidence: low.
  {
    id: 'finclusive',
    name: 'FinClusive',
    homeDomain: 'finclusive.com',
    corridors: ['usdc-usd'],
    unverifiedCorridors: ['usdc-usd'],
    assetCode: 'USDC',
    assetIssuer: USDC_ISSUER,
    seps: ['sep6', 'sep10', 'sep24', 'sep31'],
  },
];

export const KNOWN_ANCHORS = ANCHORS;

export const ANCHOR_HOME_DOMAINS: Record<string, string> = Object.fromEntries(
  ANCHORS.map((anchor) => [anchor.id, anchor.homeDomain])
);

// ─── Corridors ────────────────────────────────────────────────────────────────

/** Issuer of the nTokens BRL token sold on the `brl-brl` corridor. */
const BRL_ISSUER = 'GDVKY2GU2DRXWTBEYJJWSFXIGBZV6AZNBVVSUHEPZI54LIS6BA7DVVSP';
/** Issuer of anclap's ARS token (see the anclap anchor entry above). */
const ARS_ISSUER = 'GCYE7C77EB5AWAA25R5XMWNI2EDOKTTFTTPZKM2SR5DI4B4WFD52DARS';
/** Issuer of anclap's PEN token (see the anclap anchor entry above). */
const PEN_ISSUER = 'GA4TDPNUCZPTOHB3TKUYMDCRVATXKEADH7ZEYEBWJKQKE2UBFCYNBPEN';
/** Issuer of NGNC token (see the ngnc anchor entry above). */
const NGNC_ISSUER = 'GASBV6W7GGED66MXEVC7YZHTWWYMSVYEY35USF2HJZBLABLYIFQGXZY6';
/** Issuer of KB Trading's CLPX token (see the clpx anchor entry above). */
const CLPX_ISSUER = 'GDYSPBVZHPQTYMGSYNOHRZQNLB3ZWFVQ2F7EP7YBOLRGD42XIC3QUX5G';
/** Issuer of SofizPay's DZT token (see the sofizpay anchor entry above). */
const DZT_ISSUER = 'GCAZI7YBLIDJWIVEL7ETNAZGPP3LC24NO6KAOBWZHUERXQ7M5BC52DLV';
/** Issuer of Latamex's ARST token (see the latamex anchor entry above). */
const ARST_ISSUER = 'GCSAZVWXZKWS4XS223M5F54H2B6XPIIXZZGP7KEAIU6YSL5HDRGCI3DG';
/** Issuer of Latamex's BRLT token (see the latamex anchor entry above). */
const BRLT_ISSUER = 'GCHQ3F2BF5P74DMDNOOGHT5DUCKC773AW5DTOFINC26W4KGYFPYDPRSO';

/**
 * Corridor ids follow the convention `<on-chain asset code>-<payout fiat code>`,
 * lower-case. Two tokens that share an asset code but have different issuers
 * need different corridor ids.
 */
export const CORRIDORS: Corridor[] = [
  {
    id: 'usdc-ngn',
    from: 'USDC',
    fromIssuer: USDC_ISSUER,
    fromPeg: 'USD',
    to: 'NGN',
    countryCode: 'NG',
    countryName: 'Nigeria',
  },
  {
    id: 'usdc-kes',
    from: 'USDC',
    fromIssuer: USDC_ISSUER,
    fromPeg: 'USD',
    to: 'KES',
    countryCode: 'KE',
    countryName: 'Kenya',
  },
  {
    id: 'usdc-ghs',
    from: 'USDC',
    fromIssuer: USDC_ISSUER,
    fromPeg: 'USD',
    to: 'GHS',
    countryCode: 'GH',
    countryName: 'Ghana',
  },
  {
    id: 'usdc-mxn',
    from: 'USDC',
    fromIssuer: USDC_ISSUER,
    fromPeg: 'USD',
    to: 'MXN',
    countryCode: 'MX',
    countryName: 'Mexico',
  },
  {
    id: 'usdc-brl',
    from: 'USDC',
    fromIssuer: USDC_ISSUER,
    fromPeg: 'USD',
    to: 'BRL',
    countryCode: 'BR',
    countryName: 'Brazil',
  },
  {
    id: 'usdc-ars',
    from: 'USDC',
    fromIssuer: USDC_ISSUER,
    fromPeg: 'USD',
    to: 'ARS',
    countryCode: 'AR',
    countryName: 'Argentina',
  },
  {
    id: 'usdc-pen',
    from: 'USDC',
    fromIssuer: USDC_ISSUER,
    fromPeg: 'USD',
    to: 'PEN',
    countryCode: 'PE',
    countryName: 'Peru',
  },
  {
    id: 'usdc-eur',
    from: 'USDC',
    fromIssuer: USDC_ISSUER,
    fromPeg: 'USD',
    to: 'EUR',
    countryCode: 'DE',
    countryName: 'Germany',
  },
  {
    id: 'usdc-clp',
    from: 'USDC',
    fromIssuer: USDC_ISSUER,
    fromPeg: 'USD',
    to: 'CLP',
    countryCode: 'CL',
    countryName: 'Chile',
  },
  {
    id: 'usdc-usd',
    from: 'USDC',
    fromIssuer: USDC_ISSUER,
    fromPeg: 'USD',
    to: 'USD',
    countryCode: 'US',
    countryName: 'United States',
  },
  {
    id: 'brl-brl',
    from: 'BRL',
    fromIssuer: BRL_ISSUER,
    fromPeg: 'BRL',
    to: 'BRL',
    countryCode: 'BR',
    countryName: 'Brazil',
  },
  {
    id: 'ars-ars',
    from: 'ARS',
    fromIssuer: ARS_ISSUER,
    fromPeg: 'ARS',
    to: 'ARS',
    countryCode: 'AR',
    countryName: 'Argentina',
  },
  {
    id: 'pen-pen',
    from: 'PEN',
    fromIssuer: PEN_ISSUER,
    fromPeg: 'PEN',
    to: 'PEN',
    countryCode: 'PE',
    countryName: 'Peru',
  },
  {
    id: 'ngnc-ngn',
    from: 'NGNC',
    fromIssuer: NGNC_ISSUER,
    fromPeg: 'NGN',
    to: 'NGN',
    countryCode: 'NG',
    countryName: 'Nigeria',
  },
  {
    id: 'dzt-dzd',
    from: 'DZT',
    fromIssuer: DZT_ISSUER,
    fromPeg: 'DZD',
    to: 'DZD',
    countryCode: 'DZ',
    countryName: 'Algeria',
  },
  {
    id: 'arst-ars',
    from: 'ARST',
    fromIssuer: ARST_ISSUER,
    fromPeg: 'ARS',
    to: 'ARS',
    countryCode: 'AR',
    countryName: 'Argentina',
  },
  {
    id: 'brlt-brl',
    from: 'BRLT',
    fromIssuer: BRLT_ISSUER,
    fromPeg: 'BRL',
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
    fromIssuer: USDC_ISSUER,
    fromPeg: 'USD',
    to: 'ZAR',
    countryCode: 'ZA',
    countryName: 'South Africa',
  },
  // XOF is the West African CFA franc, shared across UEMOA states. We anchor the
  // corridor's country metadata to Senegal as the primary onboarding market.
  {
    id: 'usdc-xof',
    from: 'USDC',
    fromIssuer: USDC_ISSUER,
    fromPeg: 'USD',
    to: 'XOF',
    countryCode: 'SN',
    countryName: 'Senegal',
  },
  // ─── SEP-31-only corridor ───────────────────────────────────────────────────
  // usdc-php is served by perahub as a SEP-31 receiving anchor (see ANCHORS above).
  // It lives in CORRIDORS so the corridor resolves for the record, the onboarding
  // survey and health probes, but it can never be routed: SEP-31 requires a
  // bilateral sending-anchor agreement we do not have, and perahub advertises no
  // SEP-6/SEP-24 rail to quote against. That keeps it out of SERVED_CORRIDOR_IDS
  // (built from `corridors`, never from `sep31Corridors`) and therefore out of
  // VISIBLE_CORRIDORS, so no selector or rate path can pick it up.
  {
    id: 'usdc-php',
    from: 'USDC',
    fromIssuer: USDC_ISSUER,
    fromPeg: 'USD',
    to: 'PHP',
    countryCode: 'PH',
    countryName: 'Philippines',
  },
  // clpx-clp is served by kbtrading only as a SEP-31 receiving anchor (see the
  // clpx entry in ANCHORS above). It lives in CORRIDORS so the lane resolves for
  // the record, the onboarding survey and health probes, but it can never be
  // routed: the anchor's SEP-6/SEP-24 rails take CLPX in but do not pay CLPX out
  // (withdraw.CLPX is advertised disabled), and SEP-31 needs a bilateral
  // sending-anchor agreement. Because the lane is recorded in `sep31Corridors`
  // and not `corridors`, it stays out of SERVED_CORRIDOR_IDS and therefore out of
  // VISIBLE_CORRIDORS, so no selector or rate path can pick it up.
  {
    id: 'clpx-clp',
    from: 'CLPX',
    fromIssuer: CLPX_ISSUER,
    fromPeg: 'CLP',
    to: 'CLP',
    countryCode: 'CL',
    countryName: 'Chile',
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
  // usdc-pen: orphaned when anclap was corrected to its own tokens 2026-09-23
  // (usdc-ars is served again by latamex via SEP-6 withdraw-exchange)
  'usdc-pen',
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
  'usdc-clp': [50, 150, 300],
  'usdc-usd': [100, 250, 500],
  'brl-brl': [100, 250, 500],
  'ars-ars': [50000, 100000, 250000],
  'pen-pen': [100, 300, 500],
  'ngnc-ngn': [20000, 50000, 100000],
  'dzt-dzd': [5000, 10000, 25000],
  'arst-ars': [50000, 100000, 250000],
  'brlt-brl': [100, 250, 500],
  'usdc-zar': [50, 150, 300],
  'usdc-xof': [50, 100, 200],
};

/** Corridor IDs that at least one anchor in the registry currently serves. */
export const SERVED_CORRIDOR_IDS: ReadonlySet<string> = new Set(
  ANCHORS.flatMap((anchor) => anchor.corridors)
);

/**
 * Corridors safe to surface in selectors. The set is gated by the registry's
 * served-corridor coverage, and v1.1 target corridors additionally require the
 * feature flag. A corridor can never appear unless an anchor actually serves it.
 */
export const VISIBLE_CORRIDORS: Corridor[] = CORRIDORS.filter((c) => {
  if (!SERVED_CORRIDOR_IDS.has(c.id)) return false;
  if (!V11_CORRIDOR_IDS.has(c.id)) return true;
  return flags.v11Corridors;
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
