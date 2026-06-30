# SEP Compliance Matrix

Stellar Intel integrates with Stellar anchors that implement various Stellar Ecosystem Proposals (SEPs). SEP-6 enables programmatic deposit/withdraw — the anchor exposes a machine-readable API rather than hosting an iframe — allowing Stellar Intel to collect KYC fields natively and surface indicative rates for SEP-6-only anchors. Anchors that advertise SEP-6 but not SEP-24 receive an **Indicative** badge in the comparison UI, since their rates are derived from the SEP-6 `/info` fee schedule rather than a live quote.

## What Stellar Intel implements

| SEP        | What it is                                  | Status                      | Code                                              |
| ---------- | ------------------------------------------- | --------------------------- | ------------------------------------------------- |
| **SEP-1**  | `stellar.toml` resolution                   | ✅ implemented              | [`lib/stellar/sep1.ts`](../lib/stellar/sep1.ts)   |
| **SEP-6**  | Programmatic deposit/withdraw               | 🛠️ in progress              | `lib/stellar/sep6.ts` (planned)                   |
| **SEP-10** | Web authentication (challenge → sign → JWT) | ✅ implemented              | [`lib/stellar/sep10.ts`](../lib/stellar/sep10.ts) |
| **SEP-12** | KYC customer API                            | 🛠️ in progress (with SEP-6) | `lib/stellar/sep12.ts` (planned)                  |
| **SEP-24** | Interactive hosted deposit/withdraw         | ✅ implemented              | [`lib/stellar/sep24.ts`](../lib/stellar/sep24.ts) |
| **SEP-31** | Cross-border payments (B2B)                 | ⚪ detection only           | capability flag, no flow                          |
| **SEP-38** | Firm-quote RFQ                              | ✅ implemented              | [`lib/stellar/sep38.ts`](../lib/stellar/sep38.ts) |

Rate sourcing tiers (in [`lib/stellar/server-rates.ts`](../lib/stellar/server-rates.ts)):

1. **SEP-38** firm quote (preferred).
2. **SEP-24** indicative — live FX × the anchor's published SEP-24 withdraw fee.
3. **SEP-6** indicative — live FX × the anchor's SEP-6 `/info` fee (in progress; this is what makes SEP-6-only anchors like Cowrie appear in the comparison).

## Why SEP-6 matters here

The off-ramp execution flow was historically SEP-24-only (anchor-hosted KYC in an iframe). SEP-6-only anchors advertise `TRANSFER_SERVER` but no `TRANSFER_SERVER_SEP0024`, so they were silently dropped from the comparison and could not be executed. SEP-6 support is being added in two phases:

- **Phase 1 — quotes.** Parse SEP-6 `/info` fees and surface an indicative rate so SEP-6 anchors appear in the comparison (Tier 3 above).
- **Phase 2 — execution.** Programmatic withdraw: SEP-6 `/withdraw` + SEP-12 (`/customer`) KYC collected via a dynamic in-app form (replacing the hosted iframe for SEP-6 anchors), with status polling through the unified status map.

The difference: **SEP-24** = the anchor hosts the KYC/checkout page (we embed a URL); **SEP-6** = we collect every field ourselves and submit programmatically (we build the form, do SEP-12 KYC). They are not mutually exclusive — many anchors support both.

Tracking: batch-2 issues `#B001–#B025` (see [`issues-batch-2.md`](../issues-batch-2.md)).

## Per-anchor SEP support matrix

Registered anchors ([`constants/anchors.ts`](../constants/anchors.ts)). Capability is read from each anchor's `stellar.toml`; refresh with `node scripts/anchor-survey.mjs`.

| Anchor                              | SEP-1 | SEP-6 | SEP-10 | SEP-12 | SEP-24 | SEP-31 | SEP-38 | Corridors               |
| ----------------------------------- | :---: | :---: | :----: | :----: | :----: | :----: | :----: | ----------------------- |
| MoneyGram (`stellar.moneygram.com`) |  ✅   |  ❌   |   ✅   |   ❌   |   ✅   |   ❌   |   ❌   | NGN, KES, GHS, MXN, BRL |
| Cowrie Exchange (`cowrie.exchange`) |  ✅   |  ✅   |   ✅   |   ❌   |   ❌   |   ❌   |   ❌   | NGN                     |
| Anclap (`anclap.com`)               |  ✅   |  ✅   |   ✅   |   ❌   |   ✅   |   ❌   |   ❌   | ARS, PEN                |
| nTokens (`ntokens.com`)             |  ✅   |  ✅   |   ✅   |   ❌   |   ✅   |   ✅   |   ❌   | BRL                     |

> Snapshot — keep current via `node scripts/anchor-survey.mjs`. Capability legend: ✅ advertised · ❌ not advertised. SEP-38 column reflects `ANCHOR_QUOTE_SERVER` presence in the anchor's `stellar.toml`.

## Notes

- **Cowrie Exchange** (`cowrie.exchange`) implements SEP-6 programmatic withdraw for the NGN corridor. It does not advertise `TRANSFER_SERVER_SEP0024`, so it appears in the rate comparison as an **Indicative** source only (Tier 3). Full programmatic execution via SEP-6 + SEP-12 is tracked in batch-2.
- **Anclap** supports both SEP-6 and SEP-24. Where both are present, Stellar Intel prefers the SEP-24 hosted flow for execution and falls back to SEP-6 indicative pricing when no firm quote is available.
- **nTokens** (`ntokens.com`) services the BRL corridor via `ntokens-box.bpventures.us`. Its TOML advertises `TRANSFER_SERVER_SEP0024`, a `DIRECT_PAYMENT_SERVER` (SEP-31), and `TRANSFER_SERVER` (SEP-6). SEP-38 and SEP-12 are not advertised.
- **MoneyGram** serves the widest corridor set (five currencies) exclusively through SEP-24. It does not publish a SEP-6 transfer server or an anchor quote server.
- SEP-12 columns will flip to ✅ once the in-app KYC form (tracked in batch-2) is wired to each anchor's `/customer` endpoint.

## Fleet survey

`scripts/anchor-survey.mjs` classifies the broader directory (stellar.expert `anchor` tag) by SEP support. Latest documented snapshot: 92 directory-tagged → 41 reachable toml → 11 transfer-capable / 30 issuer-only; 51 unreachable. See [`maintainer.md`](../maintainer.md) §11.
