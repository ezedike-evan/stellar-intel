# FAQ

> Plain-English answers to the questions we get most. If you have one
> that isn't here, open a [Discussion](https://github.com/Ezedike-Evan/stellar-intel/discussions)
> and we will add it.

---

## Is this custodial?

**No.** Stellar Intel never takes custody of user funds or keys at any
point in any flow. The anchor takes custody under SEP-24 for the
duration of the off-ramp leg; we only route, rank, and observe. Every
leg is signed by the user from their own wallet.

If you find a code path that could plausibly take custody, that is a
P0 vulnerability — see [`docs/SECURITY.md`](SECURITY.md).

---

## What if an anchor fails mid-flow?

The intent has a hard `deadline` (max 10 minutes from creation). If the
anchor doesn't report a terminal state by then, the intent is marked
failed with reason `deadline`, and the router writes a failure
observation to the reputation oracle.

No funds are "stuck with Stellar Intel" — we never had them. If funds
are stuck at the anchor, the dispute path is between the user and the
anchor, and you have on-chain evidence of every step to hand the anchor
a clean ticket.

The `fill_rate` component of the TrustScore captures chronic failures.
Users steering future flows can see the pattern without us editorialising.

---

## How is this different from just comparing rates on anchors' websites?

Three differences:

1. **Net landed value**, not headline rate. We include fees, expected
   slippage, and a fill-rate penalty so "best rate" means the number
   actually arriving in the recipient's account, not the marketing
   number.
2. **Execution in the same interface.** A comparison table is half the
   product. The other half is the intent you sign right there, the
   SEP-24 handoff that runs without you re-entering data, and the
   poll-to-terminal tracker.
3. **Reputation is persistent.** Anchors do not just compete on price;
   they compete on every quote they have honoured or dropped for the
   last 30 days. That number is on-chain and permissionless to read.

A rate aggregator is a magazine. Stellar Intel is the execution layer
that the magazine is a shop window for.

---

## How are you different from "Skyscanner for anchors"?

The Skyscanner comparison is useful shorthand — search, compare, click.
The difference:

- Skyscanner hands you off to the airline's site and hopes for the best.
  We route a **signed intent** through our infra to the anchor, with a
  binding minimum-landed-value floor and a deadline.
- Skyscanner does not write flight experience to a neutral, public
  ledger. We do. Every quote, fill, and failure accumulates on-chain,
  so the next user does not start from zero.
- Skyscanner is paid by airlines. We take no rev share from anchors —
  the incentive to rank them honestly is built in.

The right framing: Skyscanner is the UI for the discovery step;
Stellar Intel is the UI **and** the protocol for the execution step.

---

## Does the oracle need permission from anchors?

No. Anchors do not grant permission for us to observe their behaviour.
Every SEP-38 quote is a public act — an HTTP response from a public
endpoint. Every SEP-24 fill is an on-chain transaction. The oracle
indexes public behaviour; nothing requires anchor buy-in.

Anchors _do_ benefit from opting in to additional signals (a private
endpoint, incident notifications) because those signals improve the
fidelity of their score. But the oracle can run, and does run, with
zero anchor cooperation.

Dispute process for wrong observations is documented in
[`docs/ANCHOR_REPUTATION.md`](ANCHOR_REPUTATION.md#dispute-process).

---

## What about MSB / VASP / money-transmission classification?

Our architecture is designed to be non-MSB by construction:

- Every leg is **signed by the user**, not by us.
- The **anchor takes custody** under SEP-24; we never do.
- Stellar enforces **atomicity** of the payment operations; we do not
  operate a settlement system.

We are not a money transmitter because we do not transmit money. We
compare, route, and observe.

A longer-form legal memo lives in
[`docs/JURISDICTIONAL.md`](JURISDICTIONAL.md). This is maintainer
thinking, not legal advice — if you are building on top, consult your
own counsel.

---

## Who is this for?

- **Users sending money home.** The UI is the direct product.
- **Wallet and dapp builders.** Embed the widget, use the SDK, hit the
  Intent API. One integration lights up every anchor.
- **AI agents.** The MCP server gives an agent the same primitives the
  UI uses, so an agent can price-and-send on a user's behalf.
- **Anchors.** A public scorecard is free marketing, and agent coverage
  is free distribution.
- **Institutional treasurers.** The reputation oracle is the only
  verifiable off-ramp track record on Stellar today; v5 will extend it
  with compliance-grade primitives.

---

## Why Stellar and not <L2 / L1>?

Three reasons, in order:

1. **SEPs exist.** The standards for anchors — SEP-24, SEP-38, SEP-10 —
   are the reason an "execution layer for stablecoin value" is even
   tractable. Every other chain requires bespoke wiring per
   off-ramp partner.
2. **Corridor density.** Real fiat off-ramp coverage across Africa and
   Latin America already exists on Stellar. We do not need to build the
   bridge to the bank — Cowrie, Bitso, Click and others already did.
3. **Soroban as the reputation ledger.** A read-cheap, public smart-
   contract layer is exactly the right host for the oracle. Other
   chains cost more to read and have less relevant participant density.

This is not a multichain project. We are going depth-first on Stellar.

---

## What's the business model?

- **Today:** grant-funded, zero user fees.
- **Post-v2:** optional paid tier for high-volume API consumers and for
  institutional features (custom SLAs, advanced dispute tooling). The
  free tier stays free.
- **Never:** a take-rate on user transactions, or editorial ranking in
  exchange for payment. Either would compromise the only thing the
  product has going for it — credible neutrality.

---

## Is this open source?

Yes. MIT-licensed. See [`LICENSE`](../LICENSE).

Governance is open: weight changes, new publishers, and any other
reputation-affecting change go through a public PR + Discussion window.
See [`docs/ANCHOR_REPUTATION.md § Governance`](ANCHOR_REPUTATION.md#governance).

---

## How do I contribute?

- Browse the [OSS Week contributor board](../.github/OSS_WEEK_CONTRIBUTOR_BOARD.md)
  for 30 scoped good-first-issues.
- Read [`CONTRIBUTING.md`](../CONTRIBUTING.md) for the dev loop.
- Join [Discussions](https://github.com/Ezedike-Evan/stellar-intel/discussions)
  — ask questions, propose designs, show what you're building.
- Every merged contributor during OSS Week is named in the grant
  resubmission document.
