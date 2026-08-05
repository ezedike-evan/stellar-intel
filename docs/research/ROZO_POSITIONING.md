# ROZO — current positioning

**Researched**: 2026-08-05 · **Issue**: #709 · **Feeds**: #710 (differentiation paragraph)

Notes on what ROZO actually says it does today, so the differentiation paragraph
argues against the real product rather than a remembered one. Everything below is
quoted or paraphrased from ROZO's own surfaces, with links. Where their marketing
and their engineering documentation disagree, both are recorded.

---

## What they say they are

From [rozo.ai](https://rozo.ai/):

> Visa layer for stablecoins. Spend crypto. Better than cards.

> The Visa layer for stablecoins. Accept, send and settle across chains with one intent.

The site lists Base, Ethereum, Polygon, BNB Chain and Arbitrum, with Stellar and
Solana appearing in wallet and bridge contexts. The product surface is one-tap
checkout, merchant acceptance, cross-chain settlement, and an "intent engine"
that routes payments across chains.

## What the engineering docs say

From the [IntentPay tech doc](https://docs.rozo.ai/start/litepaper/rozo-intentpay-techdoc):

- **Intent Extraction** — "parses AI provider invoices and checkout flows into a
  structured Stellar payment intent".
- **Settlement Adapter** — translates a Stellar USDC payment into Base USDC
  settlement to Coinbase Commerce.
- **Liquidity Layer** — ROZO-owned prefunded inventory on Base settles the
  provider payment immediately, then rebalances asynchronously through ROZO's own
  Intent API.

Stellar is the user-facing chain: the user pays Stellar USDC into a ROZO
settlement account, and that payment is verified on-chain before anything
downstream happens.

## Correction to the framing in #709

**The issue is titled "CCTP pay/bridge", and that is not what their own tech doc
describes.** CCTP appears in ROZO's marketing and in third-party coverage, but the
IntentPay document does not mention it — the described mechanism is ROZO-owned LP
inventory plus an in-house Intent API for asynchronous rebalancing, deliberately
so the user does not wait for bridge finality.

The distinction matters for #710. "They bridge with CCTP, we don't" would be a
differentiation built on a claim ROZO's engineers don't make, and it would be
argued against a moving target — the rail underneath their liquidity layer is an
implementation detail they can change without changing what the product is.

## The part that actually differentiates

Across the marketing site and the tech doc, ROZO does not mention:

- anchors, or choosing between them
- anchor reliability, uptime, or health
- off-ramp quality
- SEP-6, SEP-24, SEP-31 or SEP-38

Their settlement path is **crypto to crypto** — Stellar USDC → Base USDC →
Coinbase Commerce. Fiat off-ramp is out of scope in their own documentation.

That is the real line, and it is a line about _scope_, not about _rails_:

|                    | ROZO                              | Stellar Intel                  |
| ------------------ | --------------------------------- | ------------------------------ |
| Moves value        | yes, across chains, own liquidity | no, non-custodial              |
| Touches fiat rails | no — crypto settlement only       | yes, that is the subject       |
| Cares which anchor | not applicable                    | the entire product             |
| Unit of work       | a payment intent                  | an anchor's observed behaviour |

## Positioning shifts to watch

- The "Visa layer for stablecoins" framing is broader than IntentPay's documented
  scope. If ROZO extends from crypto settlement into fiat off-ramp, the scope
  distinction above narrows and #710 needs revisiting.
- ROZO consuming anchor reliability data is a **complement, not a conflict**: an
  intent router that settles into fiat eventually has to pick an anchor, which is
  the question this project answers. #711 (outreach) should lead with that rather
  than with contrast.

## Sources

- <https://rozo.ai/> — marketing site, retrieved 2026-08-05
- <https://docs.rozo.ai/start/litepaper/rozo-intentpay-techdoc> — IntentPay
  technical documentation, retrieved 2026-08-05

Both were read on the same day. Re-check before reusing these quotes: this file
records a snapshot, and the gap between their marketing and their tech doc is
exactly the kind of thing that moves.
