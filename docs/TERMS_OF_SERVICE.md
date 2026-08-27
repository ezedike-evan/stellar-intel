# Terms of Service

> **Draft — not legal advice, and not yet reviewed by counsel.** This is an
> engineering draft written to be factually accurate about how the system
> behaves. It must be reviewed by a qualified lawyer before it is presented to
> users as binding terms. See [Review status](#review-status).

**Last reviewed:** 2026-08-26

---

## 1. What Stellar Intel is

Stellar Intel is an **information and routing layer**: it compares off-ramp rates
across Stellar anchors, publishes an anchor reputation oracle, and exposes that
data through a web interface, a public API, and an agent surface.

It is **not** a money transmitter, an exchange, a broker, or a custodian. It does
not move your money. Every transfer is between you and a third-party anchor.

## 2. Non-custody

Stellar Intel is non-custodial **by construction**, not by promise — there is no
code path through which it could take custody
([`docs/NON_CUSTODY.md`](NON_CUSTODY.md)).

Specifically, Stellar Intel never holds:

- **Your funds.** Assets move directly from your wallet to the anchor. They never
  pass through an account Stellar Intel controls.
- **Your keys.** Signing happens in your wallet. Stellar Intel never sees,
  requests, or stores a private key or seed phrase.
- **Your fiat.** The anchor settles fiat to the beneficiary under its own flow.
- **Your KYC data.** Identity verification is collected by the anchor, not by us.

**You sign every transaction.** Nothing moves without a signature you produce in
your own wallet.

## 3. Rates are estimates, not offers

This is the most important thing on this page.

Most rates shown are **indicative**: derived from anchors' published fee schedules
and live exchange rates. They are an estimate of what you would receive, not a
binding quote, and the amount you actually receive may differ.

Where an anchor supports SEP-38 firm quotes, a quote you obtain during execution
**is** binding on that anchor for the period it states — and it expires. Rates
carrying a firm quote are labelled distinctly in the interface from those that
are indicative.

Stellar Intel does not set, guarantee, or underwrite any rate. The rate is the
anchor's.

## 4. Reputation scores are observations, not endorsements

Anchor scores are computed from observed outcomes and availability probes, using
the published methodology in
[`docs/ANCHOR_REPUTATION.md`](ANCHOR_REPUTATION.md). Scores derived from a small
number of observations are labelled as such.

A score is a description of past behaviour. It is **not** a recommendation, a
guarantee of future performance, a statement about an anchor's solvency or
licensing, or a substitute for your own diligence.

Listing an anchor is not an endorsement of it.

## 5. Your responsibilities

- **Wallet security is yours.** Stellar Intel cannot recover a lost key, reverse a
  transaction, or freeze funds. Nobody can.
- **Verify before you sign.** Check the destination, asset, and amount in your
  wallet's signing prompt. That prompt, not this interface, is what authorises the
  transfer.
- **The anchor relationship is yours.** Its terms, fees, KYC requirements, limits,
  and settlement timelines are between you and it.
- **Compliance is yours.** You are responsible for the legality of your use where
  you live, including tax and reporting obligations.

## 6. Third-party anchors

Anchors are independent third parties. Stellar Intel does not control them and is
not responsible for their conduct, solvency, availability, or compliance.

Anchor data is fetched from the anchors themselves and may be stale, incomplete,
or wrong. An anchor may change its fees, suspend a corridor, or fail to settle,
without notice to us.

## 7. Availability

The service is provided **as is**, with no guarantee of availability, accuracy, or
fitness for a particular purpose. It depends on third-party infrastructure —
anchors, the Stellar network, and data providers — any of which may be
unavailable.

Data may be cached. The interface indicates freshness where it is known.

## 8. Limitation of liability

To the maximum extent permitted by law, Stellar Intel and its contributors are not
liable for losses arising from use of the service, including losses from an
inaccurate rate, an anchor's conduct, a failed or delayed settlement, or a
transaction you signed.

> **Counsel must review this clause.** Enforceability of a liability limitation
> varies significantly by jurisdiction, and some consumer-protection regimes void
> it outright.

## 9. Jurisdiction

Stellar Intel's regulatory posture rests on never taking custody. The architectural
basis is recorded in [`docs/JURISDICTIONAL.md`](JURISDICTIONAL.md), which is a memo
for reviewers, **not** a country-by-country legal opinion.

The service is not offered to users in jurisdictions where it would be unlawful,
and it is not directed at any jurisdiction in particular. If use is restricted
where you are, do not use it.

## 10. Security and disclosure

Vulnerability reporting is covered by [`docs/SECURITY.md`](SECURITY.md). The
in-scope and out-of-scope surfaces are in
[`docs/THREAT_MODEL.md`](THREAT_MODEL.md). Notably, your wallet and the anchors'
systems are outside Stellar Intel's control and therefore outside its threat model.

## 11. Changes

These terms may change. Material changes will be reflected in the "Last updated"
date. Continued use after a change constitutes acceptance.

---

## Short-form disclaimer

The user-facing summary rendered in the product (issue #739). It must remain
consistent with the sections above; if one changes, change both.

> Stellar Intel is non-custodial. You sign every transaction with your own wallet.
> Rates are live quotes, not guarantees.

Kept to three sentences deliberately — it appears in a banner, and a disclaimer
too long to read is not a disclaimer. Each sentence maps to a section above:
non-custody (§2), user-signed (§2), rates are estimates (§3).

`components/offramp/DisclaimerBanner.tsx` renders this text and links here, so
this document is the single source for the wording.

---

## Review status

| Item                                           | Status                           |
| ---------------------------------------------- | -------------------------------- |
| Factually consistent with `NON_CUSTODY.md`     | Yes                              |
| Factually consistent with `JURISDICTIONAL.md`  | Yes                              |
| Factually consistent with `THREAT_MODEL.md`    | Yes                              |
| Reflects that most rates are indicative (#720) | Yes                              |
| **Reviewed by a qualified lawyer**             | **No — required before publish** |

Two things a reviewer should look at first: the liability limitation in §8, and
whether §9's approach to jurisdiction is sufficient for the corridors actually
served.

## Related

- [`docs/NON_CUSTODY.md`](NON_CUSTODY.md) — why custody is structurally impossible
- [`docs/JURISDICTIONAL.md`](JURISDICTIONAL.md) — regulatory posture
- [`docs/THREAT_MODEL.md`](THREAT_MODEL.md) — what is in and out of scope
- [`docs/ANCHOR_REPUTATION.md`](ANCHOR_REPUTATION.md) — how scores are computed
- [`docs/SEP_COMPLIANCE.md`](SEP_COMPLIANCE.md) — which anchors support firm quotes
