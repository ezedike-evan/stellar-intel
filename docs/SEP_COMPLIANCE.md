# SEP Compliance Matrix

**Last reviewed:** 2026-10-24

Stellar Intel integrates with Stellar anchors that implement various Stellar Ecosystem Proposals (SEPs). SEP-6 enables programmatic deposit/withdraw — the anchor exposes a machine-readable API rather than hosting an iframe — allowing Stellar Intel to collect KYC fields natively and surface indicative rates for SEP-6-only anchors. Anchors that advertise SEP-6 but not SEP-24 receive an **Indicative** badge in the comparison UI, since their rates are derived from the SEP-6 `/info` fee schedule rather than a live quote.

## What Stellar Intel implements

| SEP        | What it is                                  | Status            | Code                                              |
| ---------- | ------------------------------------------- | ----------------- | ------------------------------------------------- |
| **SEP-1**  | `stellar.toml` resolution                   | ✅ implemented    | [`lib/stellar/sep1.ts`](../lib/stellar/sep1.ts)   |
| **SEP-6**  | Programmatic deposit/withdraw               | ✅ implemented    | [`lib/stellar/sep6.ts`](../lib/stellar/sep6.ts)   |
| **SEP-10** | Web authentication (challenge → sign → JWT) | ✅ implemented    | [`lib/stellar/sep10.ts`](../lib/stellar/sep10.ts) |
| **SEP-12** | KYC customer API                            | ✅ implemented    | [`lib/stellar/sep12.ts`](../lib/stellar/sep12.ts) |
| **SEP-24** | Interactive hosted deposit/withdraw         | ✅ implemented    | [`lib/stellar/sep24.ts`](../lib/stellar/sep24.ts) |
| **SEP-31** | Cross-border payments (B2B)                 | ⚪ detection only | capability flag, no flow                          |
| **SEP-38** | Firm-quote RFQ                              | ✅ implemented    | [`lib/stellar/sep38.ts`](../lib/stellar/sep38.ts) |

Rate sourcing tiers (in [`lib/stellar/server-rates.ts`](../lib/stellar/server-rates.ts)):

1. **SEP-38** firm quote (preferred).
2. **SEP-24** indicative — live FX × the anchor's published SEP-24 withdraw fee.
3. **SEP-6** indicative — live FX × the anchor's SEP-6 `/info` fee (this is what makes SEP-6-only anchors like Cowrie appear in the comparison).

## Why SEP-6 matters here

The off-ramp execution flow was historically SEP-24-only (anchor-hosted KYC in an iframe). SEP-6-only anchors advertise `TRANSFER_SERVER` but no `TRANSFER_SERVER_SEP0024`, so they were silently dropped from the comparison and could not be executed. SEP-6 support was added in two phases:

- **Phase 1 — quotes.** Parse SEP-6 `/info` fees and surface an indicative rate so SEP-6 anchors appear in the comparison (Tier 3 above).
- **Phase 2 — execution.** Programmatic withdraw: SEP-6 `/withdraw` + SEP-12 (`/customer`) KYC collected via a dynamic in-app form (replacing the hosted iframe for SEP-6 anchors), with status polling through the unified status map.

The difference: **SEP-24** = the anchor hosts the KYC/checkout page (we embed a URL); **SEP-6** = we collect every field ourselves and submit programmatically (we build the form, do SEP-12 KYC). They are not mutually exclusive — many anchors support both.

Tracking: batch-2 issues `#B001–#B025` (see [CONTRIBUTING.md](../CONTRIBUTING.md#issue-numbering)).

## Per-anchor SEP support matrix

Registered anchors ([`constants/anchors.ts`](../constants/anchors.ts)). Capability is read from each anchor's `stellar.toml`; refresh with `node scripts/anchor-survey.mjs`.

| Anchor                              | SEP-1 | SEP-6 | SEP-10 | SEP-12 | SEP-24 | SEP-31 | SEP-38 | Corridors               |
| ----------------------------------- | :---: | :---: | :----: | :----: | :----: | :----: | :----: | ----------------------- |
| MoneyGram (`stellar.moneygram.com`) |  ✅   |  ❌   |   ✅   |   ❌   |   ✅   |   ❌   |   ❌   | NGN, KES, GHS, MXN, BRL |
| Cowrie Exchange (`cowrie.exchange`) |  ✅   |  ✅   |   ✅   |   ❌   |   ❌   |   ❌   |   ❌   | NGN                     |
| Anclap (`anclap.com`)               |  ✅   |  ✅   |   ✅   |   ❌   |   ✅   |   ❌   |   ❌   | ARS, PEN                |
| NGNC (`ngnc.online`)                |  ✅   |  ❌   |   ✅   |   ❌   |   ✅   |   ❌   |   ❌   | NGN                     |
| nTokens (`ntokens.com`)             |  ✅   |  ✅   |   ✅   |   ❌   |   ✅   |   ✅   |   ❌   | BRL                     |
| **Zeam Money** (`zeam.money`)       |  ✅   |  ❌   |   ✅   |   ❌   |   ✅   |   ✅   | **✅** | ZAR (see note)          |

> Snapshot — keep current via `node scripts/anchor-survey.mjs`. Capability legend: ✅ advertised · ❌ not advertised. SEP-38 column reflects `ANCHOR_QUOTE_SERVER` presence in the anchor's `stellar.toml`.
>
> **Live-probed 2026-08-04** (#720) with `npx tsx scripts/probe-sep38.mts`; capture committed at
> [`tests/fixtures/sep38/capability-capture.json`](../tests/fixtures/sep38/capability-capture.json).
> The previous version of this table listed four of the then-seven registered anchors and recorded
> no SEP-38 support anywhere, which was wrong.
>
> **MyKobo (`mykobo.co`) was delisted 2026-09-06** and is no longer in the matrix above. It
> advertised SEP-1/6/10/24/31 for EUR, but its `stellar.toml` publishes both `TRANSFER_SERVER` and
> `TRANSFER_SERVER_SEP0024` on `stellar.mykobo.co`, a host with no A or AAAA record — so every
> SEP-6 and SEP-24 call to it fails to connect. The TOML itself still returns 200, which is why a
> capability read that stops at the TOML kept scoring it as supported. EUR has no anchor now and
> the `usdc-eur` corridor is hidden from selectors until one serves it.

### SEP-38 quote gap

The SEP-38 column records whether an anchor advertises a quote server, not whether it can serve a
firm quote for a given corridor. A corridor is only firm-quoted when the quote server's `/info`
lists both the asset and the fiat pair; otherwise the corridor falls back to indicative pricing
(Tier 2 or Tier 3 above). Today no registered anchor serves a firm quote for NGN, so the USDC→NGN
flow is indicative pricing plus SEP-24 execution and is labelled as such in the UI.

### Min-receive guard

Before the wallet is asked to sign a SEP-24 withdrawal, Stellar Intel compares the anchor's own
`amount_out` estimate with the minimum-receive floor: the selected rate's expected net amount less
`MIN_RECEIVE_TOLERANCE` (2%). If the anchor now estimates less than the floor, the payment is
blocked and the user sees both figures. If the anchor gives no estimate, the flow continues.

### SEP-38 readiness

An anchor is SEP-38 ready when its `stellar.toml` publishes `ANCHOR_QUOTE_SERVER` and the quote
server's `/info` lists the asset and fiat pair of the corridor. Readiness decides whether a
corridor can show a **firm** quote or only an **indicative** estimate (fees plus a reference
price). The per-anchor result is the SEP-38 column in the matrix above and the one-line summary
below; there is no separate readiness page or endpoint yet.

### SEP-38 availability, in one line

**Zeam Money is the only registered anchor advertising a quote server** — and its `/info` offers
USDC and BRL only. No anchor serves a firm quote for **NGN**, so the USDC→NGN flow is indicative
pricing plus SEP-24 execution, and is labelled as such in the UI. Zeam's SEP-38 also offers no
**ZAR**, despite the registry listing it on the `usdc-zar` corridor; SEP-24 may serve ZAR
independently, so that is flagged in `constants/anchors.ts` rather than resolved by guesswork.

## Notes

- **Cowrie Exchange** (`cowrie.exchange`) implements SEP-6 programmatic withdraw for the NGN corridor. It does not advertise `TRANSFER_SERVER_SEP0024`, so it appears in the rate comparison as an **Indicative** source only (Tier 3).
- **Anclap** supports both SEP-6 and SEP-24. Where both are present, Stellar Intel prefers the SEP-24 hosted flow for execution and falls back to SEP-6 indicative pricing when no firm quote is available.
- **nTokens** (`ntokens.com`) services the BRL corridor via `ntokens-box.bpventures.us`. Its TOML advertises `TRANSFER_SERVER_SEP0024`, a `DIRECT_PAYMENT_SERVER` (SEP-31), and `TRANSFER_SERVER` (SEP-6). SEP-38 and SEP-12 are not advertised.
- **MoneyGram** serves the widest corridor set (five currencies) exclusively through SEP-24. It does not publish a SEP-6 transfer server or an anchor quote server.
- SEP-12 columns in the matrix above reflect the anchor's advertised capability in `stellar.toml`. The in-app KYC form wires to each anchor's `/customer` endpoint at execution time.

## Fleet survey

`scripts/anchor-survey.mjs` builds its candidate set from every source — the anchor registry, the full stellar.expert directory (no `anchor` tag required), the home domains of top stellar.expert assets and the SDF Anchor Directory — then classifies each domain by SEP support. Latest documented snapshot: 95 directory-tagged → 36 reachable toml → 10 transfer-capable / 26 issuer-only; 59 unreachable. See the [anchor exclusions list](anchors/exclusions.md).
