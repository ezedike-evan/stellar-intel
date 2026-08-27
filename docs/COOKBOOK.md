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
# 1. Canonicalize the intent fields below, sha-256, ed25519-sign via Freighter
#    (client-side) to get `signature` + `publicKey`. Signing is optional — see
#    docs/INTENT_API.md — omit both fields to route unattested.
# 2. POST the intent (flat fields, no wrapping object; the server recomputes
#    the canonical hash itself, so it is never sent on the wire):
curl -sX POST https://stellar-intel.vercel.app/api/intent/offramp \
  -H 'content-type: application/json' \
  -d '{
    "type": "offramp",
    "sourceAsset": "USDC",
    "destinationAsset": "NGN",
    "amount": "100",
    "sender": "GAB…",
    "recipient": "0800-123-456",
    "signature": "<base64>",
    "publicKey": "GAB…"
  }'
```

Returns `{ route, unsignedTx, quoteId }` on success. See
[`docs/INTENT_API.md`](INTENT_API.md) for the exact canonicalization/signing
steps and [`docs/CANONICAL_JSON.md`](CANONICAL_JSON.md) for the hashing rules.

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

Run the MCP server and let an agent price/compare, then sign with the user's
wallet to execute. See [`docs/MCP.md`](MCP.md) for the `npx tsx scripts/mcp/server.ts`
run command and tool list. The agent cannot spend without a user signature.

## 5. Consume the reputation oracle on-chain

Read anchor scores directly from the Soroban contract
([`contracts/reputation/`](../contracts/reputation/)) — no deploy or funded
account required, every call is a pure `simulateTransaction` against the live
testnet oracle:

```bash
node examples/consumer-contract/read-oracle.mjs cowrie usdc-ngn
```

Prints `list_anchors`, `get_score_for_corridor`, and `get_corridor_aggregate`
straight from testnet, using the same pattern as the app's
[`lib/oracle/read.ts`](../lib/oracle/read.ts). To call the oracle from inside
another Soroban contract instead of a client script, see
[`examples/consumer-contract/README.md`](../examples/consumer-contract/README.md)
for the build/deploy/invoke steps. Entrypoints are documented in
[`docs/ORACLE_SPEC.md`](ORACLE_SPEC.md). A published JS/Python SDK wrapper
around this is tracked on the roadmap; until then this script is the
zero-setup path to live data.

## 6. Re-run the anchor fleet survey

```bash
node scripts/anchor-survey.mjs           # human summary
node scripts/anchor-survey.mjs --json    # machine output
```

Classifies directory anchors by SEP support — see
[`docs/SEP_COMPLIANCE.md`](SEP_COMPLIANCE.md).
