# On-ramp

**Last reviewed:** 2026-10-19

An on-ramp is the opposite direction from the off-ramp intent documented in
[`docs/INTENT_API.md`](INTENT_API.md): the user pays in local fiat — a bank
transfer, cash, mobile money or a card — and a Stellar anchor credits a
Stellar asset such as USDC to the user's account. Stellar Intel never holds
the fiat, never holds the asset, and never holds a key. It resolves an anchor,
prepares the pieces the user signs, and tracks the anchor's own SEP flow.

> **Status.** The on-ramp intent schema and the SEP-24 deposit primitives are
> shipped, and the `intel.onramp.quote` and `intel.onramp.prepare` MCP tools
> are live on the hosted `/api/mcp` endpoint. The `GET /api/v1/onramp/quote`
> and `POST /api/v1/intent/onramp` endpoints are **planned and not live yet** —
> the planned contract is recorded here so the implementation has a target. The in-app guide at `/docs/onramp` carries the same status.

| Piece                                                                                                                               | State               |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `OnrampIntentSchema` ([`types/intent.ts`](../types/intent.ts), [`lib/intent/onramp-schema.ts`](../lib/intent/onramp-schema.ts))     | Shipped             |
| SEP-24 deposit primitives — `initiateDeposit`, `getSep24Info`, `fetchAnchorFee` ([`lib/stellar/sep24.ts`](../lib/stellar/sep24.ts)) | Shipped             |
| On-ramp router hop — `createOnRampHop` ([`lib/router/connectors/on-ramp.ts`](../lib/router/connectors/on-ramp.ts))                  | Shipped             |
| SEP-6 deposit request — `buildSep6DepositRequest`                                                                                   | **Not implemented** |
| `GET /api/v1/onramp/quote`                                                                                                          | **Planned**         |
| `POST /api/v1/intent/onramp`                                                                                                        | **Planned**         |
| MCP `intel.onramp.quote`, `intel.onramp.prepare` ([`lib/mcp/onramp.ts`](../lib/mcp/onramp.ts))                                      | Shipped             |

## Flow

Once the anchor is chosen, a deposit runs through five stages. Everything
after the intent is the anchor's SEP flow; Stellar Intel only prepares inputs
and reads status.

1. **Preflight / trustline.** Before an anchor can credit an issued asset
   (USDC, or any non-native asset) to an account, that account must hold a
   trustline for it. The planned intent response returns an
   `unsignedChangeTrustXdr` when the destination lacks one, which the user
   signs and submits with their own wallet. When the trustline already exists
   the field is `null` and this stage is skipped. The repository does not yet
   build this XDR — no `unsignedChangeTrustXdr` producer exists today, so the
   field is part of the planned contract, not shipped behaviour.
2. **SEP-10.** The anchor authenticates the user's Stellar key and issues a
   JWT ([`lib/stellar/sep10.ts`](../lib/stellar/sep10.ts)). The JWT authorises
   the deposit transaction but moves no funds and grants no custody.
3. **Interactive deposit (SEP-24).** `initiateDeposit` POSTs to the anchor's
   `TRANSFER_SERVER_SEP0024` `/transactions/deposit/interactive` and expects a
   `interactive_customer_info_needed` response carrying a `url` and a
   transaction `id`. The `url` is the anchor's hosted deposit page. SEP-24 is
   the only deposit path wired today; the SEP-6 code in
   [`lib/stellar/sep6.ts`](../lib/stellar/sep6.ts) is withdraw-oriented
   (`buildSep6WithdrawRequest`).
4. **Pay the anchor.** The user completes the anchor's hosted instructions —
   bank transfer details, a cash-agent reference, mobile-money or card
   fields — inside the anchor's page. The fiat leg moves directly between the
   user and the anchor, outside Stellar Intel entirely.
5. **Tracking.** Stellar Intel polls the anchor's SEP-24 `/transaction`
   endpoint ([`lib/stellar/sep24.ts`](../lib/stellar/sep24.ts), used by
   [`hooks/useWithdrawStatus.ts`](../hooks/useWithdrawStatus.ts)) with
   exponential backoff (2s → ×1.5 → 30s cap). Polling resets on a status
   change and stops on a terminal state (`completed`, `error`, `refunded`,
   `expired`, `no_market`, `too_small`, `too_large`). The same polling hook
   serves both directions; for the SEP-6 path the equivalent reader is
   `getSep6Transaction`.

## Quotes are indicative

An on-ramp quote is an **estimate, not a binding price**, and the docs and UI
label it that way. The rate source is modelled on `AnchorRate.source`
([`types/index.ts`](../types/index.ts)):

- `sep38` is the only firm, binding quote source — the anchor commits to the
  price until `expiresAt`, and the id can be threaded into the SEP flow so the
  anchor honours it.
- `sep24-fee`, `sep6-info` and `sep6-fee` are estimates derived from the
  anchor's published fee schedule and a reference FX rate.
  `isIndicativeRateSource(source)` returns `true` for all three; the UI
  renders them as "Indicative".

Deposit quotes are derived from the anchor's SEP-24 `/fee` schedule and are
therefore indicative by construction. Firm SEP-38 quotes are scarce on the
live network, so a ranked on-ramp comparison today is a comparison of
estimates. Treat the quoted amount as what the anchor's published schedule
implies, not as a price the anchor has promised to honour.

## Claimable balances

Whether a deposit settles as a direct Stellar payment or as a claimable
balance is the anchor's choice, advertised in its `/info` under
`features.claimable_balances`. When the flag is `true` the anchor may create
a `claimable_balance` entry that the destination account must claim before the
funds are spendable, instead of paying the account directly; when it is `false`
the anchor credits the account with a payment. Some anchors also advertise
`features.account_creation` for destination accounts that do not exist yet.

Stellar Intel captures both capability flags in its deposit fixtures
([`tests/fixtures/onramp/`](../tests/fixtures/onramp/)) but does not yet parse
or act on them, so treat them as advisory about how a settlement will land
rather than something the app intermediates. A deposit credited into a
claimable balance is only complete once the user's wallet claims it.

## Limits

Per-corridor deposit limits come from the anchor's own `/info`, not from
Stellar Intel:

- SEP-24: each deposit asset carries optional `min_amount` and `max_amount`
  (`Sep24AssetInfo` in [`lib/stellar/sep24.ts`](../lib/stellar/sep24.ts)).
- SEP-6: the same fields are normalised to `{ min, max }` by
  `getSep6Info` (`Sep6WithdrawConfig` in
  [`lib/stellar/sep6.ts`](../lib/stellar/sep6.ts)).

Examples captured from live anchors include APS USDC `min_amount` 9.34 /
`max_amount` 669.61 and NGNC `min_amount` 20000 / `max_amount` 20000000. The
limits are per anchor, per asset, and can change without notice, so a caller
should read them from the anchor rather than hard-code them. Stellar Intel
enforces no limit of its own; the `OnrampIntentSchema` only requires `amount`
to be a positive decimal string.

## KYC is browser-only

Identity collection happens inside the anchor's SEP-24 page, opened in a
browser tab or in-app webview, and never inside Stellar Intel. Stellar Intel
never sees the KYC data, never proxies it, and never stores it. This is the
same non-custodial boundary as the off-ramp flow: the user signs, the anchor
takes custody under SEP-24, and Stellar enforces atomicity.

The practical consequence for agents is that **there is no on-ramp execute
tool** in the MCP server — an agent can quote and prepare, but the user must
complete KYC and payment in a browser. See [docs/MCP.md](MCP.md).

## HTTP surface (planned)

Neither endpoint is live yet. The request body matches the **shipped**
`OnrampIntentSchema`; the response fields are the planned contract and may
change before release.

### `GET /api/v1/onramp/quote`

```
GET /api/v1/onramp/quote?sourceAsset=NGN&destinationAsset=USDC&amount=150000&depositMethod=bank_transfer
```

```jsonc
{
  "quoteId": "quote_onramp_8f419c",
  "sourceAsset": "NGN",
  "destinationAsset": "USDC",
  "sourceAmount": "150000.00",
  "destinationAmount": "95.60",
  "rate": "1568.50",
  "fee": {
    "fixed": "500.00",
    "percent": "0.5",
  },
  "anchor": {
    "id": "cowrie",
    "name": "Cowrie Exchange",
    "domain": "cowrie.exchange",
  },
  "expiresAt": "2026-10-17T12:30:00Z",
}
```

### `POST /api/v1/intent/onramp`

```http
POST /api/v1/intent/onramp
Content-Type: application/json

<OnrampIntent>
```

```jsonc
// request
{
  "type": "onramp",
  "sourceAsset": "NGN",
  "destinationAsset": "USDC",
  "amount": "150000.00",
  "sender": "NG123456789012345678",
  "destination": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  "depositMethod": "bank_transfer",
}
// response (planned)
{
  "intentId": "onramp_intent_9a4f21",
  "status": "pending_trustline",
  "unsignedChangeTrustXdr": "AAAAAgAAAABn...",
  "handoffUrl": "https://cowrie.exchange/sep24/deposit?transaction_id=...",
  "createdAt": "2026-10-17T12:05:00Z",
}
```

The full field table and validation rules are in
[`docs/INTENT_API.md`](INTENT_API.md).

## MCP tools

Two on-ramp tools are specified but not registered. `intel.onramp.quote`
returns an indicative quote across anchors and `intel.onramp.prepare` builds
the unsigned intent and the anchor handoff URL. There is deliberately no
execute tool: KYC and payment are browser-only. Details in
[docs/MCP.md](MCP.md).

## Related

- [`docs/INTENT_API.md`](INTENT_API.md) — the `OnrampIntent` schema, memo rules,
  and the planned endpoint.
- [`docs/MCP.md`](MCP.md) — the agent surface and the missing execute tool.
- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — where the on-ramp sits in the
  intent router and hop chain.
- [`docs/SEP_COMPLIANCE.md`](SEP_COMPLIANCE.md) — per-anchor SEP-6/SEP-24
  support and how it is surveyed.
- [`docs/FAQ.md`](FAQ.md) — "is this custodial?" and what happens when an
  anchor fails.
