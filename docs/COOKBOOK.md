# Cookbook

End-to-end recipes against the live API. Base URL in examples:
`https://stellar-intel.vercel.app` (swap for `http://localhost:3000` in dev).

> Endpoints and shapes are defined in code — see
> [`app/api/`](../app/api/) and [`docs/INTENT_API.md`](INTENT_API.md). The
> generated OpenAPI surface lives in [`lib/api/openapi.ts`](../lib/api/openapi.ts)
> (`npm run emit-openapi`).

## 1. Compare off-ramp rates for a corridor

```bash
curl -s "https://stellar-intel.vercel.app/api/rates/usdc-ngn?amount=100" | jq
```

Returns one row per anchor with `exchangeRate`, `fee`, `totalReceived`, `source`
(`sep38` firm, `sep24-fee`/`sep6-info` indicative), plus an `errors[]` array
explaining any anchor that could not quote.

## 2. Submit a signed off-ramp intent

```bash
# 1. Build the intent, canonicalize, sha-256, ed25519-sign via Freighter (client-side).
# 2. POST the signed envelope:
curl -sX POST https://stellar-intel.vercel.app/api/intent/offramp \
  -H 'content-type: application/json' \
  -d '{
    "intent": { "anchorId": "cowrie", "corridorId": "usdc-ngn", "amount": "100", "publicKey": "GAB…" },
    "hash": "<64-char hex>",
    "signature": "<base64>",
    "publicKey": "GAB…"
  }'
```

See [`docs/INTENT_API.md`](INTENT_API.md) for the exact canonicalization/signing
steps.

## 3. Read an anchor's reputation

```bash
# One anchor
curl -s https://stellar-intel.vercel.app/api/reputation/cowrie | jq
# Per-corridor leaderboard
curl -s "https://stellar-intel.vercel.app/api/reputation/leaderboard?corridor=usdc-ngn" | jq
# History window
curl -s "https://stellar-intel.vercel.app/api/reputation/cowrie/history?window=30d" | jq
```

Score formula: `fillRate × (1 − slippage) ÷ (settleSeconds / 300)` — see
[`docs/ANCHOR_REPUTATION.md`](ANCHOR_REPUTATION.md).

## 4. Off-ramp via an AI agent (MCP)

Install the MCP server and let an agent price/compare, then sign with the user's
wallet to execute. See [`docs/MCP.md`](MCP.md) for `claude mcp add` instructions
and tool list. The agent cannot spend without a user signature.

## 5. Consume the reputation oracle on-chain

Read anchor scores directly from the Soroban contract
([`contracts/reputation/`](../contracts/reputation/)) from a consumer contract. The
entrypoints are in [`docs/ORACLE_SPEC.md`](ORACLE_SPEC.md). (A TypeScript read
helper + JS/Python examples are roadmap deliverables.)

## 6. Re-run the anchor fleet survey

```bash
node scripts/anchor-survey.mjs           # human summary
node scripts/anchor-survey.mjs --json    # machine output
```

Classifies directory anchors by SEP support — see
[`docs/SEP_COMPLIANCE.md`](SEP_COMPLIANCE.md).
