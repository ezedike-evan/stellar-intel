# Anchor Onboarding

> How a Stellar anchor joins Stellar Intel's rate comparison, what
> reputation score they get, how disputes work, and the remediation
> playbook when a score drops.
>
> Philosophy: **carrot, not stick.** Listing is free, reputation is
> transparent, and we will tell you what to fix before the market does.

---

## Table of contents

- [Why list on Stellar Intel](#why-list-on-stellar-intel)
- [Prerequisites](#prerequisites)
- [Technical onboarding](#technical-onboarding)
- [Reputation at listing](#reputation-at-listing)
- [Scorecard rules](#scorecard-rules)
- [Dispute handling](#dispute-handling)
- [Remediation playbook](#remediation-playbook)
- [Delisting policy](#delisting-policy)
- [Contact](#contact)

---

## Why list on Stellar Intel

- **Free public credibility.** A running, verifiable record of quote
  latency, fill rate, uptime, and settlement latency. You can link to it
  in marketing and partner conversations.
- **Agent distribution.** Every anchor in the index is reachable from
  every AI-agent integration via the MCP server. As agents handle more
  remittance traffic, coverage compounds.
- **No commercial entanglement.** Stellar Intel is non-custodial and does
  not take a cut of transactions. Listing is operationally zero-cost.
- **No editorial ranking.** We do not pick winners; the formula does. The
  math is public (see [`docs/ANCHOR_REPUTATION.md`](ANCHOR_REPUTATION.md)).

---

## Prerequisites

Functional requirements:

1. A public, cache-friendly `stellar.toml` at
   `https://{domain}/.well-known/stellar.toml` with `TRANSFER_SERVER_SEP0024`
   set.
2. Working SEP-24 interactive withdraw flow for at least one fiat corridor.
3. Working **SEP-38** quote endpoint returning live `price` data. If you
   currently only support SEP-24 fees, see the migration notes at the end
   of this section — SEP-38 is the single biggest unlock.
4. A status page or equivalent public signal for outages. Optional but
   strongly recommended.

Legal / ops requirements:

1. A single contact email for incident reports (`ops@`/`support@` — not
   a person's inbox).
2. A commitment to respond to dispute issues within 7 days.

**SEP-38 migration note.** If your stack only supports SEP-24 `/fee`,
opening a SEP-38 `/price` endpoint is typically 1–2 days of work. The
spec is small and our router accepts `stale: true` quotes for up to 30
seconds, so your backend does not need to be faster than it already is.

---

## Technical onboarding

1. Open a **New anchor integration** issue using the
   [`anchor-onboard.yml`](../.github/ISSUE_TEMPLATE/anchor-onboard.yml)
   template. The form collects:
   - Anchor name, domain, supported countries, supported currencies.
   - SEP support matrix (SEP-1 / 10 / 24 / 38).
   - Contact email for incidents.
   - A `stellar.toml` link we can probe.
2. A maintainer verifies TOML resolution, runs a manual SEP-38 quote and
   a SEP-24 handshake against a dummy intent.
3. The anchor is added to `constants/index.ts` with `status: "beta"` for
   the first 14 days.
4. The nightly integrity workflow
   ([`.github/workflows/nightly.yml`](../.github/workflows/nightly.yml))
   starts probing the domain. Probe observations begin accumulating but
   are suppressed from the public scorecard for 14 days.
5. After 14 days the anchor promotes to `status: "live"` automatically
   if the probe success rate is ≥ 95%. Otherwise the maintainer opens a
   tracking issue and pauses listing until resolved.

No custodial relationship is created. No funds or keys are exchanged.

---

## Reputation at listing

For the first 30 days a listed anchor shows:

- TrustScore = _null_ (not 0). UI renders a "new — building history"
  badge instead of a numeric score.
- Observations accumulate normally and ship to the oracle with the usual
  hash chain.
- `confidence` field reads `low` and stays there until the anchor hits
  the `n_observations ≥ 1000` + `n_corridors ≥ 4` thresholds described
  in [ANCHOR_REPUTATION § Confidence bands](ANCHOR_REPUTATION.md#confidence-bands).

A brand-new anchor cannot be "punished" by the UI simply for having no
history. It is shown as new, not as bad.

---

## Scorecard rules

Every anchor has a public scorecard at `/anchors/{anchorId}` showing:

- TrustScore + six components + confidence.
- 30-day rolling charts for each component.
- Incident flag: if an observation falls inside a logged incident window,
  it is drawn greyed-out with a tooltip pointing to the incident record.
- Dispute log: open and resolved disputes for this anchor, with outcomes.
- Corridor matrix: per asset-pair p50 latency, fill rate, net landed
  value delta vs. the market best.

Anchors can embed their scorecard. A read-only iframe + a small JSON
endpoint are provided so your marketing site can surface your live
TrustScore without screenshotting it.

---

## Dispute handling

If an observation is wrong:

1. Open a GitHub issue using the `anchor-onboard.yml` form with type
   `dispute`. Include the observation hash (visible on your scorecard),
   the claim (e.g. "this failure was a user cancel, not an anchor fault"),
   and any logs.
2. A maintainer acknowledges within 48 hours and gathers the router
   trace and on-chain record.
3. Outcome within 7 days:
   - **Correction.** A correction observation is written on-chain with
     `supersedes = originalHash` and `excluded = true`. Aggregates
     recompute. The original observation stays in history for audit;
     it is not deleted.
   - **Upheld.** No change to the score. The maintainer opens a
     remediation playbook entry (below) so the anchor sees a clear
     "what to fix" list.

Every resolution, on either side, is logged in the public `/public/disputes`
endpoint.

---

## Remediation playbook

When an anchor's score drops, the most common causes and their fixes:

| Symptom                    | Likely cause                                                   | Fix                                                                                                                            |
| -------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Low `fill_rate`            | Timeout on SEP-24 handshake, or rejecting valid SEP-38 quotes. | Check `/transactions_info` for 4xx patterns during the window. Increase timeout on your quote-sign-callback path to ≥ 30s.     |
| Low `uptime`               | Probe can't resolve TOML or `/price`.                          | Verify CDN cache isn't serving stale TOML; verify `/price` returns 200 within 5s.                                              |
| Low `price_efficiency`     | Spread vs. best market quote > 3%.                             | Review your pricing pipeline. Our router compares to the best _other_ anchor, not to an off-exchange benchmark.                |
| Low `settle_latency_score` | p95 fiat settlement > 900s.                                    | This is usually rails, not anchor software. Document the cause in your status page; we mark incident windows and exclude them. |
| Rising `dispute_rate`      | Users reporting "I signed and nothing happened".               | Check your interactive-URL expiry. Our deadline is 10min; if your SEP-24 session expires sooner, intents die silently.         |

You can always ask for a private "what would move your score" report.
Open a Discussion and a maintainer will send back the per-component
breakdown plus the top three levers.

---

## Delisting policy

An anchor is delisted only if:

1. The domain serves no valid TOML for **7 consecutive days**, or
2. The legal contact bounces and we cannot reach the anchor for **30
   days**, or
3. The anchor explicitly requests delisting.

All three flows write a final `delisted` event on-chain so the historical
scorecard stays readable. Delisting is never silent.

We do not delist for low TrustScore. A low score is a signal for users
to read; letting the data speak is the point.

---

## Contact

- Onboarding: open the
  [anchor-onboard issue](../.github/ISSUE_TEMPLATE/anchor-onboard.yml).
- Disputes: same template, type `dispute`.
- Private questions: `anchors@stellarintel.xyz` (monitored by
  maintainers; keep it for things that should not be public).
- Ecosystem chat: `#anchor-onboarding` pinned thread in
  [Discussions](https://github.com/Ezedike-Evan/stellar-intel/discussions).
