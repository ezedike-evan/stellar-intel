# Issuer-only anchors (excluded from corridors)

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
(snapshot `2026-06-25`): **92** directory-tagged domains → **32** reachable →
**23** issuer-only (and 9 transfer-capable). Refresh monthly with the survey and
update this list alongside `maintainer.md` §11.

## Issuer-only domains (23)

|   # | Domain                | Reason                                                                   |
| --: | --------------------- | ------------------------------------------------------------------------ |
|   1 | `afreum.com`          | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|   2 | `app.phoenix-hub.io`  | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|   3 | `aps.money`           | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|   4 | `aqua.network`        | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|   5 | `bitbondsto.com`      | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|   6 | `centre.io`           | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|   7 | `cryptotari.io`       | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|   8 | `heir.io`             | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|   9 | `mgusd.moneygram.com` | Issuer domain only — live SEP-24 service runs at `stellar.moneygram.com` |
|  10 | `mobius.network`      | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|  11 | `nafuloo.com`         | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|  12 | `papayabot.com`       | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|  13 | `pedity.com`          | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|  14 | `pr.network`          | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|  15 | `ripplefox.com`       | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|  16 | `stronghold.co`       | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|  17 | `tempocrypto.com`     | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|  18 | `thefutbolcoin.io`    | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|  19 | `traxalt.com`         | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|  20 | `www.anchorusd.com`   | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|  21 | `www.factrpay.io`     | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|  22 | `ximcoin.com`         | No transfer rails (SEP-6/SEP-24) — issuer-only                           |
|  23 | `xirkle.com`          | No transfer rails (SEP-6/SEP-24) — issuer-only                           |

> An anchor leaves this list only when its `stellar.toml` starts advertising a
> usable `TRANSFER_SERVER` (SEP-6) or `TRANSFER_SERVER_SEP0024` (SEP-24); rerun
> the survey to confirm before promoting it into `constants/anchors.ts`.

## Other exclusions

Domains excluded for reasons other than missing transfer rails.

### Stellarport

- **Domain:** stellarport.io
- **Status:** Excluded
- **Reason:** Stellarport is primarily a Decentralized Exchange (DEX) and gateway for crypto assets (BTC, ETH, XRP, LTC). Verification of their `stellar.toml` reveals that all issued assets are crypto-anchored (`anchor_asset_type="crypto"`). Furthermore, their transfer server endpoint (`a3s.api.stellarport.io`) is unresponsive/non-existent. There is no evidence of fiat settlement or fiat off-ramp services. Thus, it is not suitable for fiat off-ramp integration.
