# Anchor Fleet Recheck

Tracking ledger for directory-tagged Stellar anchor domains whose
`stellar.toml` did **not** resolve during the fleet survey, plus the
obligation to re-check them on a fixed cadence and the criteria that promote
a domain back toward a real listing.

This is the durable companion to the
[`scripts/anchor-survey.mjs`](../scripts/anchor-survey.mjs) crawl and the
["Anchor Fleet Status" section of `maintainer.md`](../maintainer.md). It exists
so that an unreachable domain is never silently dropped: every entry below
carries a `last checked` date and is owned by the monthly recheck.

> **Resolves the #499 tracking obligation.** The lists below are generated
> from the survey, not hand-curated — see [Regenerating this list](#regenerating-this-list).

## Snapshot

| Field                     | Value                                                               |
| ------------------------- | ------------------------------------------------------------------- |
| Survey date               | 2026-06-25                                                          |
| Source                    | `https://api.stellar.expert/explorer/public/directory?tag[]=anchor` |
| Directory-tagged domains  | 92                                                                  |
| `stellar.toml` reachable  | 20                                                                  |
| Unreachable / unconfirmed | 72 (**51 unreachable** + 21 unconfirmed)                            |

The headline **51 unreachable** matches the documented fleet snapshot: these
are the domains whose host never completed a TLS connection within the
12 s timeout. The remaining 21 answered in some form (HTTP error, TLS-cert
mismatch, or no DNS) but still yielded no usable `stellar.toml`, so they are
tracked separately as _unconfirmed_.

### Reading this list — important caveats

- **Home domain ≠ service domain.** The directory lists anchors by their
  issuer/home domain, which is frequently _not_ the subdomain that serves SEP
  endpoints (e.g. `mgusd.moneygram.com` is issuer-only; the live SEP-24 service
  runs at `stellar.moneygram.com`). A row here is a _directory-probe_ failure,
  **not** a liveness check of a listed anchor. Rows that map to a known or
  listed anchor are annotated in the Notes column.
- **Strict TLS.** The survey uses Node's `fetch` (undici), which verifies the
  full certificate chain against the runtime CA store. A domain with an
  expired/mismatched cert — or a CA the runtime lacks — fails here even though
  `curl` or a browser might succeed. Treat the count as a conservative ceiling
  and confirm with `curl` before acting on any single row.

## Recheck cadence

- **Frequency:** monthly, on the **first business day**.
- **Owner:** the maintainer on rotation (recorded in the PR that updates this
  file).
- **Procedure:**
  1. Re-run the survey (see below) and regenerate the tables.
  2. For each row, bump `last checked` to the run date.
  3. Move any domain that now resolves out of these tables and into the
     promotion flow.
  4. Commit the refreshed file. A row untouched for **two consecutive cycles**
     keeps its original `first seen` date so staleness stays visible.
- **De-listing:** a domain that stays unreachable for **6 consecutive monthly
  checks** is moved to the collapsed _Archive_ section at the bottom and is no
  longer surfaced in summaries, but is never deleted (so we keep the audit
  trail and can revive it if it returns).

## Promotion criteria

A domain climbs this ladder; each step is gated on the previous one:

1. **Unreachable** — no connection. Stays in the table; re-checked monthly.
2. **Unconfirmed** — the host answers but serves no valid `stellar.toml`
   (HTTP error, bad cert, or DNS gap). Re-checked monthly; a one-line reason
   is recorded.
3. **Candidate** — `stellar.toml` resolves and parses with SEP-1 currencies
   and a signing key, **and** advertises a transfer rail (`TRANSFER_SERVER`
   or `TRANSFER_SERVER_SEP0024`). Open an
   [anchor onboarding issue](../.github/ISSUE_TEMPLATE/anchor-onboard.yml) and
   remove the row from this file.
4. **Listed** — the candidate clears the
   [onboarding checklist](ANCHOR_ONBOARDING.md) (SEP-1 + SEP-10 + a transfer
   rail, asset issuer verified, corridors documented) and is added to
   [`constants/anchors.ts`](../constants/anchors.ts).

Issuer-only domains (a valid toml but no transfer rail) are **not** promoted to
a listed off-ramp anchor; they are dropped from this tracker with a Notes entry.

## Unreachable (51)

Host did not complete a TLS connection within the 12 s timeout.

|   # | Domain                | First seen | Last checked | Notes                                                                                      |
| --: | --------------------- | ---------- | ------------ | ------------------------------------------------------------------------------------------ |
|   1 | `anchormxn.com`       | 2026-06-25 | 2026-06-25   |                                                                                            |
|   2 | `anclax.com`          | 2026-06-25 | 2026-06-25   |                                                                                            |
|   3 | `astral9.io`          | 2026-06-25 | 2026-06-25   |                                                                                            |
|   4 | `auskunft.de`         | 2026-06-25 | 2026-06-25   |                                                                                            |
|   5 | `bac.gold`            | 2026-06-25 | 2026-06-25   |                                                                                            |
|   6 | `bitx.tk`             | 2026-06-25 | 2026-06-25   |                                                                                            |
|   7 | `bostravel.online`    | 2026-06-25 | 2026-06-25   |                                                                                            |
|   8 | `charnatoken.top`     | 2026-06-25 | 2026-06-25   |                                                                                            |
|   9 | `citron.cash`         | 2026-06-25 | 2026-06-25   |                                                                                            |
|  10 | `citystatesm.com`     | 2026-06-25 | 2026-06-25   |                                                                                            |
|  11 | `clickpesa.com`       | 2026-06-25 | 2026-06-25   |                                                                                            |
|  12 | `cowrie.exchange`     | 2026-06-25 | 2026-06-25   | Listed anchor — home-domain probe only; SEP-24 service confirmed separately                |
|  13 | `cryptomover.com`     | 2026-06-25 | 2026-06-25   |                                                                                            |
|  14 | `cryptotari.io`       | 2026-06-25 | 2026-06-25   |                                                                                            |
|  15 | `dead.apay.io`        | 2026-06-25 | 2026-06-25   | Legacy/retired subdomain                                                                   |
|  16 | `equid.co`            | 2026-06-25 | 2026-06-25   |                                                                                            |
|  17 | `fchain.io`           | 2026-06-25 | 2026-06-25   |                                                                                            |
|  18 | `flutterwave.com`     | 2026-06-25 | 2026-06-25   |                                                                                            |
|  19 | `frasindo.com`        | 2026-06-25 | 2026-06-25   |                                                                                            |
|  20 | `freight-coin.com`    | 2026-06-25 | 2026-06-25   |                                                                                            |
|  21 | `funtracker.site`     | 2026-06-25 | 2026-06-25   |                                                                                            |
|  22 | `glitzkoin.com`       | 2026-06-25 | 2026-06-25   |                                                                                            |
|  23 | `goodx.network`       | 2026-06-25 | 2026-06-25   |                                                                                            |
|  24 | `gratz.io`            | 2026-06-25 | 2026-06-25   |                                                                                            |
|  25 | `heir.io`             | 2026-06-25 | 2026-06-25   |                                                                                            |
|  26 | `hotoken.io`          | 2026-06-25 | 2026-06-25   |                                                                                            |
|  27 | `irene.energy`        | 2026-06-25 | 2026-06-25   |                                                                                            |
|  28 | `ixinium.io`          | 2026-06-25 | 2026-06-25   |                                                                                            |
|  29 | `jetmint.org`         | 2026-06-25 | 2026-06-25   |                                                                                            |
|  30 | `levelg.net`          | 2026-06-25 | 2026-06-25   |                                                                                            |
|  31 | `luckybird.io`        | 2026-06-25 | 2026-06-25   |                                                                                            |
|  32 | `luxpayband.io`       | 2026-06-25 | 2026-06-25   |                                                                                            |
|  33 | `merge.lobstr.co`     | 2026-06-25 | 2026-06-25   | LOBSTR aggregator subdomain                                                                |
|  34 | `mgusd.moneygram.com` | 2026-06-25 | 2026-06-25   | MoneyGram issuer domain; live service runs at stellar.moneygram.com                        |
|  35 | `mobius.network`      | 2026-06-25 | 2026-06-25   |                                                                                            |
|  36 | `moni.com`            | 2026-06-25 | 2026-06-25   |                                                                                            |
|  37 | `mykobo.co`           | 2026-06-25 | 2026-06-25   | EUR off-ramp candidate (see #482)                                                          |
|  38 | `nafuloo.com`         | 2026-06-25 | 2026-06-25   |                                                                                            |
|  39 | `naobtc.com`          | 2026-06-25 | 2026-06-28   | Crypto-only BTC anchor; no fiat corridor — excluded (#467); see docs/anchors/exclusions.md |
|  40 | `nezly.com`           | 2026-06-25 | 2026-06-25   |                                                                                            |
|  41 | `ngnc.online`         | 2026-06-25 | 2026-06-25   |                                                                                            |
|  42 | `ntokens.com`         | 2026-06-25 | 2026-06-25   |                                                                                            |
|  43 | `nydro.energy`        | 2026-06-25 | 2026-06-25   |                                                                                            |
|  44 | `old.repocoin.io`     | 2026-06-25 | 2026-06-25   | Legacy/retired subdomain                                                                   |
|  45 | `old.sureremit.co`    | 2026-06-25 | 2026-06-25   | Legacy/retired subdomain                                                                   |
|  46 | `papayabot.com`       | 2026-06-25 | 2026-06-25   |                                                                                            |
|  47 | `pedity.com`          | 2026-06-25 | 2026-06-25   |                                                                                            |
|  48 | `photon.center`       | 2026-06-25 | 2026-06-25   |                                                                                            |
|  49 | `piiko.co`            | 2026-06-25 | 2026-06-25   |                                                                                            |
|  50 | `repocoin.io`         | 2026-06-25 | 2026-06-25   |                                                                                            |
|  51 | `uhuruwallet.co.za`   | 2026-06-25 | 2026-06-25   |                                                                                            |

## Unconfirmed (21)

Host answered but served no usable `stellar.toml`. Tracked on the same cadence;
the symptom is recorded so the next check knows what changed.

|   # | Domain                 | Symptom                | Last checked | Notes                                    |
| --: | ---------------------- | ---------------------- | ------------ | ---------------------------------------- |
|   1 | `apay.io`              | HTTP 521 (origin down) | 2026-06-25   |                                          |
|   2 | `apiscapitalfunds.com` | HTTP 403 (forbidden)   | 2026-06-25   |                                          |
|   3 | `atlantisblue.org`     | HTTP 403 (forbidden)   | 2026-06-25   |                                          |
|   4 | `pigzbe.com`           | HTTP 404 (no toml)     | 2026-06-25   |                                          |
|   5 | `six.network`          | HTTP 404 (no toml)     | 2026-06-25   |                                          |
|   6 | `smartlands.io`        | TLS chain incomplete   | 2026-06-25   |                                          |
|   7 | `stablex.cloud`        | DNS does not resolve   | 2026-06-25   |                                          |
|   8 | `stably.io`            | HTTP 400 (bad request) | 2026-06-25   |                                          |
|   9 | `steemanchor.com`      | DNS does not resolve   | 2026-06-25   |                                          |
|  10 | `steiiarusa.vip`       | DNS does not resolve   | 2026-06-25   | Likely homograph/typosquat of stellarusa |
|  11 | `stemchain.io`         | HTTP 404 (no toml)     | 2026-06-25   |                                          |
|  12 | `superlumen.org`       | DNS does not resolve   | 2026-06-25   |                                          |
|  13 | `sureremit.co`         | HTTP 403 (forbidden)   | 2026-06-25   |                                          |
|  14 | `ternio.io`            | connection refused     | 2026-06-25   |                                          |
|  15 | `thewwallet.com`       | TLS cert name mismatch | 2026-06-25   |                                          |
|  16 | `tonaira.com`          | timed out mid-response | 2026-06-25   |                                          |
|  17 | `tontinetrust.com`     | HTTP 404 (no toml)     | 2026-06-25   |                                          |
|  18 | `vcbear.net`           | TLS cert name mismatch | 2026-06-25   |                                          |
|  19 | `winsome.gift`         | DNS does not resolve   | 2026-06-25   |                                          |
|  20 | `wirexapp.com`         | HTTP 400 (bad request) | 2026-06-25   |                                          |
|  21 | `x.token.io`           | DNS does not resolve   | 2026-06-25   |                                          |

## Regenerating this list

The tables above are produced from the survey, so a recheck is one command:

```bash
# Human summary (counts only)
node scripts/anchor-survey.mjs

# Markdown tables for this file (paste into the sections above)
node scripts/anchor-survey.mjs --recheck
```

`--recheck` emits the two Markdown tables, sorted and classified exactly as
shown here, so refreshing this ledger is copy-paste with no hand-editing. After
pasting, run `npm run format` to re-align the table columns. See the script
header for the full classification keys.

## Archive

_Domains unreachable for 6+ consecutive monthly checks land here. Empty at first
snapshot._
