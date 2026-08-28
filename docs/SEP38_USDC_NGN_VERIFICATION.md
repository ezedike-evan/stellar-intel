# SEP-38 USDC→NGN Rate Verification

**Last reviewed:** 2026-08-26

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

## Production anchor status — live probe, 2026-08-04

The earlier version of this section reasoned from the registry. It has now been checked against
the live anchors with `npx tsx scripts/probe-sep38.mts`, and the capture is committed at
[`tests/fixtures/sep38/capability-capture.json`](../tests/fixtures/sep38/capability-capture.json).

**Verdict: USDC→NGN firm quotes are unavailable. Not from any registered anchor.**

| Anchor    | `stellar.toml` | `ANCHOR_QUOTE_SERVER`                 | Serves `usdc-ngn` |
| --------- | -------------- | ------------------------------------- | ----------------- |
| moneygram | 200            | —                                     | yes (SEP-24)      |
| cowrie    | 200            | —                                     | yes (SEP-6)       |
| ngnc      | 200            | —                                     | yes (SEP-24)      |
| anclap    | 200            | —                                     | no                |
| mykobo    | 200            | —                                     | no                |
| ntokens   | 200            | —                                     | no                |
| **zeam**  | 200            | **`https://anchor.zeam.money/sep38`** | no                |

All three NGN anchors are reachable and serve a transfer rail. None advertises a quote server,
so a firm quote for this corridor is not merely unimplemented on our side — it does not exist to
call.

### The one SEP-38 anchor

`zeam.money` is the only registered anchor advertising SEP-38. Its `/info` returned HTTP 200 and
offers:

- `stellar:USDC:GA5Z…KZVN`
- `stellar:BRL:GDVK…VVSP`
- `iso4217:BRL` (delivery: cash, ACH, PIX)

**No NGN. No ZAR** — despite the registry listing zeam on the `usdc-zar` corridor. The ZAR
corridor may still be served over SEP-24; the two rails need not cover the same currencies. That
discrepancy is flagged in `constants/anchors.ts` rather than silently resolved, because dropping
`usdc-zar` would change corridor routing on the strength of one rail's capability list.

Two registry corrections fell out of this: zeam's `seps` array omitted `sep38` even though its
TOML advertised a quote server, so nothing downstream could have routed a firm quote to it.

### What this means for the demo (#789)

The firm-quote path has exactly one place it can run today: **`usdc-brl` via zeam**. A USDC→NGN
demo must use indicative pricing and say so. The `assertSep38Capable` guard throws rather than
falling back silently, so this cannot be papered over at runtime.

### Reproducing

```bash
npx tsx scripts/probe-sep38.mts                  # report
npx tsx scripts/probe-sep38.mts --write-fixture  # refresh the capture
```

The probe retries each request. That is not politeness: a single-shot run recorded a transient
failure for zeam and would have written "no SEP-38 support" for the one anchor that has it.

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
