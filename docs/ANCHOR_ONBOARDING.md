# Anchor Onboarding

**Last reviewed:** 2026-08-29

Listing on Stellar Intel is **carrot, not stick**: we aggregate your quotes,
publish your track record to a public reputation oracle, and never custody user
funds. There is no listing fee and no exclusivity ask.

Both anchor operators and community integrators use this process. To start, open an
[🔌 Anchor onboarding issue](https://github.com/Ezedike-Evan/stellar-intel/issues/new?template=anchor-onboard.yml)
([`.github/ISSUE_TEMPLATE/anchor-onboard.yml`](../.github/ISSUE_TEMPLATE/anchor-onboard.yml)).

## What we validate

From your `stellar.toml` at `https://{domain}/.well-known/stellar.toml`:

- **SEP-1** — the toml parses, declares your asset under `[[CURRENCIES]]`, and
  carries a `SIGNING_KEY`.
- **SEP-10** — `WEB_AUTH_ENDPOINT` present (web authentication).
- A transfer rail (one of):
  - **SEP-24** — `TRANSFER_SERVER_SEP0024` (interactive hosted withdraw). The
    default, fully supported execution path today, and the only rail the nightly
    probe accepts — see [What the probes require](#what-the-probes-require).
  - **SEP-6** — `TRANSFER_SERVER` (programmatic withdraw). **Accepted** for
    onboarding and rate comparison when it is the only transfer rail advertised,
    subject to the caveats below; full SEP-6 + SEP-12 execution is rolling out —
    see [`docs/SEP_COMPLIANCE.md`](SEP_COMPLIANCE.md).
  - **SEP-31** — `DIRECT_PAYMENT_SERVER`. Detected as a transfer capability;
    there is no SEP-31 flow in the app today.
- **SEP-38** — `ANCHOR_QUOTE_SERVER` for firm quotes. Optional today; required
  from v1.1, and required for the quote-latency and quote-drift probes to record
  anything for you. Without it you get an indicative rate (live FX × your
  published fee).

Capability detection is exact: a SEP is treated as supported **if and only if**
its toml key is present. The mapping lives in
[`lib/stellar/sep1.ts`](../lib/stellar/sep1.ts) and is locked by
[`tests/anchors.invariants.spec.ts`](../tests/anchors.invariants.spec.ts), so a
registry entry claiming a SEP your toml does not advertise fails CI:

| Registry `seps` claim | `stellar.toml` key that backs it |
| --------------------- | -------------------------------- |
| `sep6`                | `TRANSFER_SERVER`                |
| `sep10`               | `WEB_AUTH_ENDPOINT`              |
| `sep24`               | `TRANSFER_SERVER_SEP0024`        |
| `sep31`               | `DIRECT_PAYMENT_SERVER`          |
| `sep38`               | `ANCHOR_QUOTE_SERVER`            |

The broader fleet is classified by
[`scripts/anchor-survey.mjs`](../scripts/anchor-survey.mjs). Domains the survey
could not resolve are tracked, with a monthly recheck and promotion criteria, in
[`docs/ANCHOR_FLEET_RECHECK.md`](ANCHOR_FLEET_RECHECK.md); domains with no
transfer rail at all are catalogued in
[`docs/anchors/exclusions.md`](anchors/exclusions.md).

## What the probes require

Four automated checks run against a listed anchor. They decide whether your
listing stays visible, so build the toml to satisfy them.

### 1. Nightly TOML validator — decides whether you stay visible

[`scripts/validate-anchors.mjs`](../scripts/validate-anchors.mjs), run by the
`anchor-health-ledger` job in
[`.github/workflows/nightly.yml`](../.github/workflows/nightly.yml) and locally
with `npm run validate:anchors`. For each registered anchor it fetches
`https://{serviceDomain ?? homeDomain}/.well-known/stellar.toml` and requires:

- the probe domain to be a plain public hostname — dot-separated labels with an
  alphabetic TLD. Ports, paths, IP literals, `localhost` and userinfo are
  rejected before the fetch is made;
- **HTTP 200 within 15 seconds**, following redirects;
- a line-anchored **`TRANSFER_SERVER_SEP0024 =`** in the body.

> **SEP-6-only anchors: read this.** The nightly probe's success condition is
> SEP-24 specifically, not "any transfer rail". An anchor advertising only
> `TRANSFER_SERVER` fails this probe every night and accumulates a failure
> streak; at `thresholdNights` (default 3, overridable with
> `ANCHOR_DEGRADE_THRESHOLD`) it latches `degraded`. Cowrie is the live example:
> its ledger entry currently reads
> `lastError: "missing TRANSFER_SERVER_SEP0024 (SEP-24)"`. Onboarding accepts
> SEP-6-only anchors for rate comparison, but until the probe's success condition
> is widened they will not pass the nightly check. Say so explicitly in your
> onboarding issue so a maintainer tracks it rather than reading your listing as
> a live outage.

A `degraded` anchor is **hidden from corridor selectors and the rate engine**
(`getAnchorsByCorridorId` in [`lib/stellar/anchors.ts`](../lib/stellar/anchors.ts))
but is **never removed from the registry** — the flag clears automatically on the
first successful resolution.

The job opens a pull request against `main` with the refreshed ledger rather than
pushing directly, so a status change is reviewable.

### 2. Asset-issuer integrity — same run, warning only

Your `[[CURRENCIES]]` must advertise your registered asset code under the
registered issuer:

```toml
[[CURRENCIES]]
code = "USDC"
issuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
```

A trusted code published under a different issuer is a look-alike asset. It is
reported as a `::warning::` in the nightly run and logged at runtime by
`validateAnchorAssetIssuer`; it never sets `degraded`. The registry's canonical
issuer still governs the SEP-38 asset identifiers we send you, so a mismatch
means your quotes are being requested for an asset you are not advertising.

### 3. Registry guard — runs on every pull request

`npm run check:registry`
([`scripts/check-registry.mjs`](../scripts/check-registry.mjs), the
`registry guard` job in CI) asserts that your `serviceDomain` **or** `homeDomain`
appears in the committed survey snapshot's `transferCapableDomains`. If the
public directory lists you under an issuer-only domain while your SEP endpoints
live on a service subdomain the survey does not crawl, the entry needs an
`ALLOWLIST` exception with a written reason — MoneyGram is the canonical case.

### 4. Reputation probes — how your score bootstraps

[`lib/reputation/probe.ts`](../lib/reputation/probe.ts) writes samples into the
probe health ledger (see [the two health ledgers](#the-two-health-ledgers)):

- **Uptime probe** (`kind: 'uptime'`) — resolves your `stellar.toml` through the
  same SEP-1 helper the runtime uses, recording reachability and round-trip
  latency. Failures are classified `dns`, `tls`, `http`, `timeout` or `unknown`.
- **Quote-latency and quote-drift probes** (`kind: 'quote'`) — require
  `ANCHOR_QUOTE_SERVER` and a working SEP-38 `GET /price` for
  `sell_asset=stellar:{assetCode}:{assetIssuer}`,
  `buy_asset=iso4217:{corridor currency}` and `context=sep31`, returning a
  positive `total_price` (or `price`). Without a quote server these record
  nothing for you, and your `quoteLatencyByCorridor` stays empty everywhere it is
  surfaced. A quote more than `QUOTE_DRIFT_THRESHOLD_PERCENT` (default 3%) from
  the cross-anchor median for the same corridor is flagged — informational only,
  never an auto-exclusion.

## The two health ledgers

"Health ledger" refers to two different, complementary records. They are easy to
confuse and are not interchangeable.

|                        | **Anchor health ledger**                                                                                                           | **Probe health ledger**                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Where                  | [`constants/anchor-health.json`](../constants/anchor-health.json), committed to the repo                                           | The reputation store (SQLite in dev, Postgres in prod)                                              |
| Written by             | `scripts/validate-anchors.mjs`, once per nightly run                                                                               | `lib/reputation/probe.ts`, via `recordProbeSample`                                                  |
| Shape                  | `{ thresholdNights, updatedAt, anchors: { [anchorId]: { consecutiveFailures, degraded, lastCheckedAt, lastStatus, lastError } } }` | `ProbeLedgerRow` — `{ domain, kind, corridor, reachable, latencyMs, failureType, error, probedAt }` |
| Keyed by               | Anchor **id**                                                                                                                      | Anchor **domain** (plus corridor, on `quote` rows)                                                  |
| Read by                | `getAnchorHealth`, `isAnchorDegraded`, `getDegradedAnchorIds` in [`lib/stellar/anchors.ts`](../lib/stellar/anchors.ts)             | `queryProbeSamples`, `computeLatencyPercentiles`, `quoteLatencyPercentiles`                         |
| Effect on your listing | `degraded: true` hides you from selectors                                                                                          | None directly — it bootstraps reputation signals                                                    |
| Retention              | Rewritten in full each run; anchors no longer in the registry are pruned                                                           | `PROBE_RETENTION_DAYS` = 90, compacted by `compactProbes`                                           |

Both feed the SDF Anchor Directory export
([`docs/ANCHOR_DIRECTORY_CONTRIBUTION.md`](ANCHOR_DIRECTORY_CONTRIBUTION.md)):
the anchor ledger supplies `status`, `lastStatus`, `lastError` and
`consecutiveFailures`; the probe ledger supplies `uptime`, `avgLatencyMs` and
`quoteLatencyByCorridor`.

**A new anchor does not need a hand-written ledger entry.** The validator
rebuilds `constants/anchor-health.json` from `constants/anchors.ts` on its next
run, adding your id and pruning anchors that have left the registry. Until then
your id is simply absent: `getAnchorHealth` returns `undefined` and
`isAnchorDegraded` is `false`, so a new listing is visible immediately rather
than hidden until first probed. In the SDF export that same absence reads as
`status: "unknown"`, not `healthy` or `degraded`.

## What gets registered

Once validated, your anchor is added to
[`constants/anchors.ts`](../constants/anchors.ts) — the single source of truth,
re-exported verbatim by `lib/stellar/anchors.ts`. The entry is an `Anchor`
([`types/index.ts`](../types/index.ts)):

| Field           | Required       | Notes                                                                                                                                                      |
| --------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | ✅             | Stable, lower-case. The key for the health ledger, the leaderboard, the SDF export and the on-chain oracle — changing it discards your reputation history. |
| `name`          | ✅             | Display name in the rate table.                                                                                                                            |
| `homeDomain`    | ✅             | Domain hosting `stellar.toml`. Plain public hostname only.                                                                                                 |
| `serviceDomain` |                | Set when SEP endpoints live elsewhere; every probe and the runtime resolve `serviceDomain ?? homeDomain`.                                                  |
| `corridors`     | ✅             | Corridor **ids** from `CORRIDORS`, e.g. `usdc-ngn` — never display names.                                                                                  |
| `assetCode`     | ✅             | Asset sold through those corridors. `USDT` entries are ignored by the live rate path unless `NEXT_PUBLIC_USDT_ENABLED` is set.                             |
| `assetIssuer`   | ✅             | Issuer account, or the `USDC_ISSUER` constant (the validator resolves that reference from `NEXT_PUBLIC_USDC_ISSUER`).                                      |
| `seps`          | ✅ in practice | Declared capabilities. See the warning below.                                                                                                              |
| `metadata`      |                | Operator regions / KYC model / fee model. Defined on the type, but not written inline today — see the flat-entry constraint below.                         |

> **`seps` is not optional in practice.** `transferCapable()` is
> `anchor.seps?.some(sep => TRANSFER_SEPS.includes(sep)) ?? false`. An entry with
> no `seps` — or with only `sep10` / `sep38` — is silently excluded from
> `getAnchorsByCorridorId`, so the anchor never reaches a corridor selector or
> the rate engine, and nothing errors. Declare at least one of `sep6`, `sep24`,
> `sep31`.

> **Keep the entry flat.** `scripts/validate-anchors.mjs` and
> `scripts/check-registry.mjs` isolate anchor objects with a brace-free
> `\{[^{}]*\}` scan, which keeps them dependency-free but means they do not
> tolerate nested braces. An entry containing an inline object literal (for
> example `metadata: { ... }`) is not matched as a block, so the anchor is
> **silently skipped**: never probed, never in the health ledger, never checked
> by the registry guard, and nothing is printed. Corridor and `seps` arrays are
> fine — they use `[ ]`. Keep each field on its own line as a quoted literal;
> `assetIssuer: USDC_ISSUER` is the one bare identifier both parsers handle.

Corridor ids must already exist in `CORRIDORS`. `usdc-zar` and `usdc-xof` are
v1.1 corridors: they stay hidden until `NEXT_PUBLIC_V11_CORRIDORS=on` **and** an
anchor serves them. Issuer-only domains (no transfer rail) are not listed as
off-ramp anchors.

Match the existing entries' comment style, which records what was verified and
when:

```ts
// ngnc.online: NGN fiat corridor — SEP-24 withdraw enabled.
// Verified 2026-06-29. TOML: TRANSFER_SERVER_SEP0024 present. /info: withdraw.USDC.enabled = true.
```

Surveyed-and-rejected domains get the same treatment as a comment in place of an
entry (see `ultracapital.xyz`, `fchain.io`), so a settled decision is not
re-litigated later.

### Before you open the pull request

```bash
npm run check:registry                    # registry guard — also its own CI job
npm run validate:anchors -- --dry-run     # nightly probe, without writing the ledger
npm run test                              # invariants, corridor coverage, discovery
npm run typecheck && npm run lint && npm run format:check
```

Confirm your anchor actually appears in the table `validate:anchors --dry-run`
prints. A missing row means the parser skipped your entry — check the flat-entry
constraint above. Do not hand-edit `constants/anchor-health.json` or
`scripts/anchor-survey.snapshot.json`; both are generated, and the next run
overwrites them.

## SEP-6 acceptance caveats

SEP-6 anchors are acceptable for onboarding when they advertise a valid
`TRANSFER_SERVER` endpoint and can provide a usable rate signal.

- We accept SEP-6 anchors for quote/rate comparison now (Tier 3 in
  [`lib/stellar/server-rates.ts`](../lib/stellar/server-rates.ts): live FX × the
  SEP-6 `/info` fee), and they carry an **Indicative** badge in the comparison UI.
- Programmatic execution still depends on the broader SEP-6 + SEP-12 flow being
  available in the app.
- The nightly probe still requires `TRANSFER_SERVER_SEP0024` — see the callout in
  [What the probes require](#1-nightly-toml-validator--decides-whether-you-stay-visible).
- Anchors supporting both SEP-6 and SEP-24 should be documented in the SEP
  compliance matrix so maintainers can tell the execution path apart. Where both
  are present, the SEP-24 hosted flow is preferred for execution.

Use [`docs/SEP_COMPLIANCE.md`](SEP_COMPLIANCE.md) as the canonical matrix for
SEP-6 vs SEP-24 capability and rollout status.

## Home domain vs service domain

List the domain that hosts your `stellar.toml`. Your **issuer/home domain** is
often distinct from the **service subdomain** that hosts SEP endpoints (e.g.
MoneyGram: `mgusd.moneygram.com` is issuer-only; `stellar.moneygram.com` runs the
SEP-24 service). Where they differ, the registry carries both: `homeDomain` and
an optional `serviceDomain`.

Every probe resolves `serviceDomain ?? homeDomain`, so **point `serviceDomain` at
the toml that advertises your live transfer and auth servers**. Getting this
wrong is the most common way a healthy anchor ends up flagged `degraded`.

## Reputation & disputes

Every quote, fill, failure, and settlement latency for your anchor is written to a
public reputation oracle with your anchor id attached
([`docs/ANCHOR_REPUTATION.md`](ANCHOR_REPUTATION.md)). New anchors start with a
bootstrap confidence band and accrue a live score from real outcomes. You agree to
respond to disputes within five business days.

> **Reputation accrual:** Newly onboarded anchors begin in a bootstrap phase with
> **no composite score** — the scorecard reports `insufficient_data` rather than a
> synthetic seed value. See
> [Anchor Reputation: Bootstrap to Live](./ANCHOR_REPUTATION.md#new-anchor-reputation-bootstrap-to-live)
> for how reputation accrues and when live status is reached.

## Non-custody

Stellar Intel never holds user funds, keys, or fiat
([`docs/NON_CUSTODY.md`](NON_CUSTODY.md)). You handle user custody and KYC via your
own SEP flow.

## Checklist

- [ ] `stellar.toml` live at `https://{serviceDomain ?? homeDomain}/.well-known/stellar.toml` and parses cleanly (`curl` + `jq`).
- [ ] It answers **HTTP 200 in under 15 s** — the nightly probe's timeout.
- [ ] SEP-1 (`[[CURRENCIES]]` + `SIGNING_KEY`) + SEP-10 (`WEB_AUTH_ENDPOINT`) + a transfer rail advertised.
- [ ] `TRANSFER_SERVER_SEP0024` present, or the SEP-6-only caveat noted in the onboarding issue.
- [ ] `[[CURRENCIES]]` advertises your registered `assetCode` under your registered `assetIssuer` — no look-alike.
- [ ] Every SEP claimed in `seps` is backed by its toml key, and at least one of `sep6` / `sep24` / `sep31` is claimed.
- [ ] `serviceDomain` supplied whenever SEP endpoints are not on the home domain.
- [ ] Registry entry is flat — no nested object literal anywhere in it.
- [ ] Corridors named by their registry ids, and the fee/rate model documented in the onboarding issue.
- [ ] `ANCHOR_QUOTE_SERVER` supplied if you want firm quotes and quote-latency samples (required from v1.1).
- [ ] Technical contact who can answer toml/SEP-10/KYC questions within a day.
