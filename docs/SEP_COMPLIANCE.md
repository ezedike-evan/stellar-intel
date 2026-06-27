# SEP Compliance

Which Stellar Ecosystem Proposals (SEPs) Stellar Intel implements, and which each
integrated anchor supports.

## What Stellar Intel implements

| SEP        | What it is                                  | Status                      | Code                                              |
| ---------- | ------------------------------------------- | --------------------------- | ------------------------------------------------- |
| **SEP-1**  | `stellar.toml` resolution                   | ✅ implemented              | [`lib/stellar/sep1.ts`](../lib/stellar/sep1.ts)   |
| **SEP-10** | Web authentication (challenge → sign → JWT) | ✅ implemented              | [`lib/stellar/sep10.ts`](../lib/stellar/sep10.ts) |
| **SEP-24** | Interactive hosted deposit/withdraw         | ✅ implemented              | [`lib/stellar/sep24.ts`](../lib/stellar/sep24.ts) |
| **SEP-38** | Firm-quote RFQ                              | ✅ implemented              | [`lib/stellar/sep38.ts`](../lib/stellar/sep38.ts) |
| **SEP-6**  | Programmatic deposit/withdraw               | 🛠️ in progress              | `lib/stellar/sep6.ts` (planned)                   |
| **SEP-12** | KYC customer API                            | 🛠️ in progress (with SEP-6) | `lib/stellar/sep12.ts` (planned)                  |
| **SEP-31** | Cross-border payments (B2B)                 | ⚪ detection only           | capability flag, no flow                          |

Rate sourcing tiers (in [`lib/stellar/server-rates.ts`](../lib/stellar/server-rates.ts)):

1. **SEP-38** firm quote (preferred).
2. **SEP-24** indicative — live FX × the anchor's published SEP-24 withdraw fee.
3. **SEP-6** indicative — live FX × the anchor's SEP-6 `/info` fee (_in progress_;
   this is what makes SEP-6-only anchors like Cowrie appear in the comparison).

## Why SEP-6 matters here

The off-ramp execution flow was historically SEP-24-only (anchor-hosted KYC in an
iframe). SEP-6-only anchors advertise `TRANSFER_SERVER` but no
`TRANSFER_SERVER_SEP0024`, so they were silently dropped from the comparison and
could not be executed. SEP-6 support is being added in two phases:

- **Phase 1 — quotes.** Parse SEP-6 `/info` fees and surface an indicative rate so
  SEP-6 anchors appear in the comparison (Tier 3 above).
- **Phase 2 — execution.** Programmatic withdraw: SEP-6 `/withdraw` +
  SEP-12 (`/customer`) KYC collected via a dynamic in-app form (replacing the hosted
  iframe for SEP-6 anchors), with status polling through the unified status map.

The difference: **SEP-24** = the anchor hosts the KYC/checkout page (we embed a
URL); **SEP-6** = we collect every field ourselves and submit programmatically (we
build the form, do SEP-12 KYC). They are not mutually exclusive — many anchors
support both.

Tracking: batch-2 issues `#B001–#B025` (see
[`issues-batch-2.md`](../issues-batch-2.md)).

## Per-anchor matrix

Registered anchors ([`constants/anchors.ts`](../constants/anchors.ts)). Capability
is read from each anchor's `stellar.toml`; refresh with
`node scripts/anchor-survey.mjs`.

| Anchor                              | SEP-1 | SEP-10 | SEP-6 | SEP-24 | SEP-38 | Corridors               |
| ----------------------------------- | :---: | :----: | :---: | :----: | :----: | ----------------------- |
| MoneyGram (`stellar.moneygram.com`) |  ✅   |   ✅   |   —   |   ✅   |   —    | NGN, KES, GHS, MXN, BRL |
| Cowrie (`cowrie.exchange`)          |  ✅   |   ✅   |  ✅   |   —    |   —    | NGN                     |
| Anclap (`anclap.com`)               |  ✅   |   ✅   |  ✅   |   ✅   |   —    | ARS, PEN                |

> Snapshot — keep current via the survey. Capability legend: ✅ advertised · —
> not advertised. SEP-38 columns reflect `ANCHOR_QUOTE_SERVER` presence.

## Fleet survey

`scripts/anchor-survey.mjs` classifies the broader directory (stellar.expert
`anchor` tag) by SEP support. Latest documented snapshot: 92 directory-tagged → 41
reachable toml → 11 transfer-capable / 30 issuer-only; 51 unreachable. See
[`maintainer.md`](../maintainer.md) §11.
