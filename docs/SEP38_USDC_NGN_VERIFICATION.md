# SEP-38 USDC→NGN Rate Verification

**Related issue**: #720\
**Milestone**: H1 Rung 1 — Data Infra + Grant

---

## What this covers

Verification that the rate infrastructure can fetch a real SEP-38 firm quote for the USDC→NGN
corridor from a production anchor, parse it correctly, and drive an accurate expiry countdown
from the live `expires_at` timestamp.

---

## Scope

| File                                  | Change                                             |
| ------------------------------------- | -------------------------------------------------- |
| `lib/stellar/__tests__/sep38.test.ts` | Added USDC→NGN corridor tests for `postSep38Quote` |
| `docs/SEP38_USDC_NGN_VERIFICATION.md` | This document                                      |

The `lib/stellar/sep38.ts` production module required no changes — `parseQuote` and
`postSep38Quote` already handle the USDC→NGN corridor correctly. The tests confirm this.

---

## Corridor identifiers

| Field        | Value                                                                   |
| ------------ | ----------------------------------------------------------------------- |
| `sell_asset` | `stellar:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` |
| `buy_asset`  | `iso4217:NGN`                                                           |
| Corridor ID  | `usdc-ngn`                                                              |

---

## Tests added (`lib/stellar/__tests__/sep38.test.ts`)

The suite `postSep38Quote — USDC→NGN corridor` covers:

1. **Round-trip**: all required fields (`id`, `price`, `total_price`, `sell_amount`, `buy_amount`,
   `fee.total`, `context`) are preserved from the anchor's response.
2. **Corridor identifiers**: fixture `buy_asset` is `iso4217:NGN` and `sell_asset` is the
   canonical USDC identifier.
3. **Expiry**: `expires_at` parses as a valid RFC 3339 timestamp in the future.
4. **Missing `expires_at`**: `Sep38ParseError` is thrown.
5. **Past `expires_at`**: `Sep38ParseError` is thrown.
6. **Missing `buy_amount`**: `Sep38ParseError` is thrown.
7. **HTTP error**: descriptive error containing the status code is thrown.
8. **URL normalisation**: trailing slashes are stripped before `/quote` is appended.
9. **JWT header**: `Authorization: Bearer <jwt>` is sent on every request.

---

## Production anchor status

No anchor in the current registry (`constants/anchors.ts`) declares `sep38` in its `seps` array
for `usdc-ngn`. The two anchors that serve the corridor use SEP-6 (Cowrie) and SEP-24
(MoneyGram, NGNC).

To run a live end-to-end demo against a production SEP-38 anchor for this corridor, an anchor
with `ANCHOR_QUOTE_SERVER` in its `stellar.toml` must be onboarded. The `assertSep38Capable`
guard will throw at runtime if an anchor without a quote server is targeted, preventing silent
fallback.

---

## Expiry countdown

The `getRemainingSeconds`, `isQuoteExpired`, `watchQuoteExpiry`, and `onQuoteExpired` functions
in `lib/stellar/sep38.ts` are verified by `tests/sep38-expiry.spec.ts`. They accept both
`expires_at` (string, from `Sep38Quote`) and `expiresAt` (Date, from `AnchorRate`) so the
countdown works identically for live SEP-38 quotes and SEP-24/SEP-6 indicative rates.

Key properties:

- Remaining seconds = `floor((expires_at_ms - now_ms) / 1000)`
- `isQuoteExpired` returns `true` when remaining ≤ 0
- `watchQuoteExpiry` emits `isExpired` on the returned `EventTarget` at expiry
- Calling `abort()` before expiry suppresses the event
