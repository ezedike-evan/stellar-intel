# Issuer-only anchors (excluded from corridors)

**Last reviewed:** 2026-10-17

Some domains in the [stellar.expert anchor directory](https://api.stellar.expert/explorer/public/directory?tag[]=anchor&limit=200)
advertise a Stellar asset or issuer but publish **no transfer rails** — neither a
SEP-6 `TRANSFER_SERVER` nor a SEP-24 `TRANSFER_SERVER_SEP0024` in their
`stellar.toml`. Without a transfer server there is no programmatic or hosted
deposit/withdraw flow, so these anchors offer no fiat on/off-ramp and cannot back
an off-ramp corridor. They are catalogued here so corridor selection and the
registry guard (`scripts/check-registry.mjs`) can exclude them deliberately
rather than silently.

The survey classifies anchors by transfer-rail presence, not by asset inventory;
the specific asset(s) each domain issues live in its own `stellar.toml`
`[[CURRENCIES]]` block.

## Provenance

Generated from `node scripts/anchor-survey.mjs --json`, captured in
[`scripts/anchor-survey.snapshot.json`](../../scripts/anchor-survey.snapshot.json)
(snapshot `2026-10-01`): **95** directory-tagged domains → **36** reachable →
**26** issuer-only (and 10 transfer-capable). Refresh monthly with the survey;
see the [snapshot](../../scripts/anchor-survey.snapshot.json) and
[anchor recrawl workflow](../../.github/workflows/anchor-recrawl.yml).

## Issuer-only domains (26)

|   # | Domain                | Reason                                                                   |
| --: | --------------------- | ------------------------------------------------------------------------ |
|   1 | `afreum.com`          | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|   2 | `app.phoenix-hub.io`  | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|   3 | `aps.money`           | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|   4 | `aqua.network`        | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|   5 | `bitbondsto.com`      | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|   6 | `centre.io`           | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|   7 | `decaf.so`            | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|   8 | `funtracker.site`     | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|   9 | `gratz.io`            | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|  10 | `heir.io`             | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|  11 | `ixinium.io`          | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|  12 | `luxpayband.io`       | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|  13 | `mgusd.moneygram.com` | Issuer domain only — live SEP-24 service runs at `stellar.moneygram.com` |
|  14 | `mobius.network`      | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|  15 | `nafuloo.com`         | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|  16 | `papayabot.com`       | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|  17 | `pedity.com`          | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|  18 | `pr.network`          | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|  19 | `ripplefox.com`       | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|  20 | `stronghold.co`       | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|  21 | `tempocrypto.com`     | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|  22 | `traxalt.com`         | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|  23 | `vnx.io`              | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|  24 | `www.anchorusd.com`   | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|  25 | `ximcoin.com`         | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|  26 | `xirkle.com`          | No transfer rails (SEP-6/SEP-24) — issuer-only                           |

_Note: `www.factrpay.io` was classified under `unreachableDomains` in the 2026-10-01 survey snapshot._

> An anchor leaves this list only when its `stellar.toml` starts advertising a
> usable `TRANSFER_SERVER` (SEP-6) or `TRANSFER_SERVER_SEP0024` (SEP-24); rerun
> the survey to confirm before promoting it into `constants/anchors.ts`.

## Other exclusions

Domains excluded for reasons other than missing transfer rails.

### Stellarport

- **Domain:** stellarport.io
- **Status:** Excluded
- **Reason:** Stellarport is primarily a Decentralized Exchange (DEX) and gateway for crypto assets (BTC, ETH, XRP, LTC). Verification of their `stellar.toml` reveals that all issued assets are crypto-anchored (`anchor_asset_type="crypto"`). Furthermore, their transfer server endpoint (`a3s.api.stellarport.io`) is unresponsive/non-existent. There is no evidence of fiat settlement or fiat off-ramp services. Thus, it is not suitable for fiat off-ramp integration.

### naobtc.com

- **Domain:** naobtc.com
- **Issue:** #467 (B034)
- **Triaged:** 2026-06-28
- **Status:** Excluded
- **Reason:** naobtc.com is a BTC anchor with no fiat off-ramp or on-ramp corridor. Verification of its SEP-38 `/info` endpoint reveals no fiat `sell_asset` or `buy_asset` pairs — all assets are crypto-only. There is no evidence of fiat settlement or fiat corridor services. It must not be added to any corridor list and requires no further SEP-24/SEP-38 integration work. Exclusion is permanent unless the operator adds a verifiable fiat corridor and re-submits via the anchor onboarding flow described in [`docs/ANCHOR_ONBOARDING.md`](../ANCHOR_ONBOARDING.md).
- **Linked tracking:** #B065 (issuer-only / non-fiat register)

### fchain.io

- **Domain:** fchain.io
- **Issue:** #897 (monthly re-crawl, 2026-08-01)
- **Triaged:** 2026-08-04
- **Status:** Excluded
- **Reason:** The August re-crawl promoted `fchain.io` from _unreachable_ to
  _transfer-capable_, so it surfaced as an onboarding candidate. Curl-confirmed:
  `https://fchain.io/.well-known/stellar.toml` returns HTTP 200 and advertises
  `TRANSFER_SERVER = "https://api.fchain.io"`, and that server's `/info` responds
  HTTP 200. But every asset it lists is crypto — deposit and withdraw both offer
  exactly `BCH`, `ETH`, `STM`, `USDT`, `WICC`, `XRP`, and **no fiat currency at
  all**. It is a crypto-to-crypto gateway, not a fiat off-ramp, so it cannot back
  a corridor. Same disposition as `naobtc.com` and `stellarport.io` above:
  transfer rail present, fiat rail absent. Exclusion is permanent unless the
  operator adds a verifiable fiat corridor and re-submits via
  [`docs/ANCHOR_ONBOARDING.md`](../ANCHOR_ONBOARDING.md).

### mykobo.co

- **Domain:** mykobo.co
- **Triaged:** 2026-09-06
- **Status:** Delisted
- **Reason:** MyKobo was delisted on 2026-09-06. While its `stellar.toml` serves
  HTTP 200, the transfer servers (`TRANSFER_SERVER` and `TRANSFER_SERVER_SEP0024`)
  live on `stellar.mykobo.co`, and that host has no A or AAAA record, so every
  SEP-6 and SEP-24 call fails to connect. Because MyKobo was the EUR anchor
  (EURC issuer `GAQRF3UGHBT6JYQZ7YSUYCIYWAF4T2SAA5237Q5LIQYJOHHFAWDXZ7NM`),
  `usdc-eur` no longer has a registered anchor. MyKobo returns when it
  publishes a transfer server that resolves, through the onboarding flow in
  [`docs/ANCHOR_ONBOARDING.md`](../ANCHOR_ONBOARDING.md).
