# Anchor Onboarding

Listing on Stellar Intel is **carrot, not stick**: we aggregate your quotes,
publish your track record to a public reputation oracle, and never custody user
funds. There is no listing fee and no exclusivity ask.

Both anchor operators and community integrators use this process. To start, open an
[🔌 Anchor onboarding issue](https://github.com/Ezedike-Evan/stellar-intel/issues/new?template=anchor-onboard.yml)
([`.github/ISSUE_TEMPLATE/anchor-onboard.yml`](../.github/ISSUE_TEMPLATE/anchor-onboard.yml)).

## What we validate

From your `stellar.toml` at `https://{domain}/.well-known/stellar.toml`:

- **SEP-1** — the toml parses, declares your asset under `[[CURRENCIES]]`, and
  carries a signing key.
- **SEP-10** — `WEB_AUTH_ENDPOINT` present (web authentication).
- A transfer rail (one of):
  - **SEP-24** — `TRANSFER_SERVER_SEP0024` (interactive hosted withdraw). The
    default, fully supported execution path today.
  - **SEP-6** — `TRANSFER_SERVER` (programmatic withdraw). Now **accepted** for
    onboarding and rate comparison when it is the only transfer rail advertised.
    Acceptance is currently for quote/rate visibility and the programmatic path is
    subject to the caveats below; full SEP-6 + SEP-12 execution is rolling out —
    see [`docs/SEP_COMPLIANCE.md`](SEP_COMPLIANCE.md).
- **SEP-38** — `ANCHOR_QUOTE_SERVER` for firm quotes. Optional today; required from
  v1.1. Without it you get an indicative rate (live FX × your published fee).

Resolution is implemented in [`lib/stellar/sep1.ts`](../lib/stellar/sep1.ts) and
classified by [`scripts/anchor-survey.mjs`](../scripts/anchor-survey.mjs). Domains
the survey could not resolve are tracked, with a monthly recheck and promotion
criteria, in [`docs/ANCHOR_FLEET_RECHECK.md`](ANCHOR_FLEET_RECHECK.md).

## SEP-6 acceptance caveats

SEP-6 anchors are acceptable for onboarding when they advertise a valid
`TRANSFER_SERVER` endpoint and can provide a usable rate signal. The current caveat
is operational rather than structural:

- We accept SEP-6 anchors for quote/rate comparison now.
- Programmatic execution still depends on the broader SEP-6 + SEP-12 flow being
  available in the app.
- Anchors that support both SEP-6 and SEP-24 should be documented in the SEP
  compliance matrix so maintainers can distinguish the execution path clearly.

Use [`docs/SEP_COMPLIANCE.md`](SEP_COMPLIANCE.md) as the canonical matrix for
SEP-6 vs SEP-24 capability and rollout status.

## Home domain vs service domain

List the domain that hosts your `stellar.toml`. Note that your **issuer/home
domain** is often distinct from the **service subdomain** that hosts SEP endpoints
(e.g. MoneyGram: `mgusd.moneygram.com` is issuer-only; `stellar.moneygram.com` runs
the SEP-24 service). We resolve endpoints from the toml, so point us at the toml
that advertises your live transfer/auth servers.

## What gets registered

Once validated, your anchor is added to
[`constants/anchors.ts`](../constants/anchors.ts) with its id, home domain,
supported corridors, asset, and SEP capabilities. Issuer-only domains (no transfer
rail) are not listed as off-ramp anchors.

## Reputation & disputes

Every quote, fill, failure, and settlement latency for your anchor is written to a
public reputation oracle with your anchor id attached
([`docs/ANCHOR_REPUTATION.md`](ANCHOR_REPUTATION.md)). New anchors start with a
bootstrap confidence band and accrue a live score from real outcomes. You agree to
respond to disputes within five business days.

> **Reputation accrual:** Newly onboarded anchors begin in a bootstrap
> phase with seeded confidence scores. See
> [Anchor Reputation: Bootstrap to Live](./ANCHOR_REPUTATION.md#new-anchor-reputation-bootstrap-to-live)
> for how reputation accrues and when live status is reached.

## Non-custody

Stellar Intel never holds user funds, keys, or fiat
([`docs/NON_CUSTODY.md`](NON_CUSTODY.md)). You handle user custody and KYC via your
own SEP flow.

## Checklist

- [ ] `stellar.toml` live and parses cleanly (`curl` + `jq`).
- [ ] SEP-1 + SEP-10 + (SEP-24 or SEP-6) advertised.
- [ ] If SEP-6 is the only transfer rail, note the current caveat in the onboarding issue and confirm the anchor is documented in the SEP compliance matrix.
- [ ] Asset issuer matches the canonical USDC issuer (or your declared asset).
- [ ] Corridors and fee/rate model documented in the onboarding issue.
- [ ] Technical contact who can answer toml/SEP-10/KYC questions within a day.
