# Stellar Intel — MCP Server

**Last reviewed:** 2026-08-29

The MCP server exposes Stellar Intel's off-ramp routing and anchor
intelligence to MCP-capable agents over stdio or streamable HTTP. It lives in
[`scripts/mcp`](../scripts/mcp) (in-repo dev server) and
[`packages/mcp`](../packages/mcp) (the `@stellarintel/mcp` package — **not
yet published to npm**), and both reuse the same routing + canonical-hashing
logic as the web app (`lib/mcp/offramp.ts`).

The two entry points do not expose the same tool set:

| Tool                      | `packages/mcp` | `scripts/mcp/server.ts` (dev) |
| ------------------------- | -------------- | ----------------------------- |
| `intel.offramp.quote`     | ✓              | ✓                             |
| `intel.offramp.prepare`   | ✓              | ✓                             |
| `intel.execute`           | ✓              | ✓                             |
| `intel.anchor.reputation` | ✓              | —                             |
| `intel.anchor.health`     | ✓              | —                             |

**Scope:** Stellar Intel abstracts anchors, not chains. These tools answer
"what's my best fiat exit price, and which Stellar anchor should I trust to
execute it" — not "move this value across chains." For cross-chain pay/bridge
intents, an agent should reach for ROZO instead. See
[docs/AGENT_POSITIONING.md](AGENT_POSITIONING.md) for the full comparison.

## Running

> **Note:** `@stellarintel/mcp` is **not yet published to npm** —
> `npm install @stellarintel/mcp` currently 404s. The package name is
> reserved in `packages/mcp/package.json`; until it is published, run the
> server from a clone of this repository as shown below.

All commands start from a checkout:

```bash
git clone https://github.com/ezedike-evan/stellar-intel.git
cd stellar-intel
npm install
```

### stdio (default)

```bash
# Full tool set, from the workspace package
npx tsx packages/mcp/src/index.ts

# In-repo dev server (off-ramp tools only, stdio only)
npx tsx scripts/mcp/server.ts
```

Point any MCP-capable client at either `tsx` command as a stdio server.

### Streamable HTTP

The same tool set is served over streamable HTTP behind a flag; stdio stays
the default:

```bash
npx tsx packages/mcp/src/index.ts --transport http --host 127.0.0.1 --port 3000
```

This binds `http://<host>:<port>/mcp`; point an MCP client at that URL.
Sessions are managed per agent (each initialization gets its own session ID),
so multiple hosted agents can use the server concurrently. The in-repo dev
server at [`scripts/mcp/server.ts`](../scripts/mcp/server.ts) is stdio-only.

The server applies safe mainnet defaults for the `NEXT_PUBLIC_*` config values,
so an agent does not need the web app's `.env` to invoke it. The two
`intel.anchor.*` tools additionally call the Stellar Intel HTTP API at
`NEXT_PUBLIC_APP_URL` (default `http://localhost:3000`), so they need a
running app instance — `npm run dev` locally, or point `NEXT_PUBLIC_APP_URL`
at a deployed instance.

## Tools

### `intel.offramp.quote` (#135)

Returns the best net-received quote for a corridor + amount.

- **Input:** `{ from: string, to: string, amount: string }`
- **Output:** `{ anchor, quoteId, netReceived, expiresAt }`

```jsonc
// input
{ "from": "USDC", "to": "NGN", "amount": "100" }
// output
{
  "anchor": "cowrie",
  "quoteId": "<64-hex sha256>",
  "netReceived": "156800",
  "expiresAt": "2026-…Z"
}
```

### `intel.offramp.prepare` (#136)

Returns an **unsigned** intent envelope plus an unsigned Stellar transaction for
an agent to sign. The `intentHash` is the canonical SHA-256 the agent signs.

- **Input:** an off-ramp intent without a signature
  `{ type: "offramp", sourceAsset, destinationAsset, amount, sender, recipient }`
- **Output:** `{ unsignedEnvelope: { intent, intentHash }, unsignedTx }`

### `intel.execute` (#819)

Carries a prepared intent through to signed execution. **Stellar Intel never
signs anything here** — the non-custodial invariant holds all the way through:
the calling agent signs `unsignedEnvelope.intentHash` (an off-chain attestation
of consent) and the `unsignedTx` from `intel.offramp.prepare` (a real Stellar
transaction signature) with its own wallet, entirely outside this server. This
tool only verifies the signed material still matches the intent it was
prepared for, then submits the transaction to Horizon.

Verification, in order: the `intentHash` is recomputed from `intent` and must
match; `signature` must verify against `intentHash` under `intent.sender`'s
public key; the decoded `signedTx` must be signed, sourced from
`intent.sender`, carry exactly one payment operation to the routed anchor
account for `intent.amount`/`intent.sourceAsset`, and memo-hash `intentHash`.
Any mismatch is rejected before anything reaches Horizon.

- **Input:**
  `{ unsignedEnvelope: { intent, intentHash }, signature, signedTx }` — the
  exact `unsignedEnvelope` from `intel.offramp.prepare`, a base64 ed25519
  signature over `intentHash` from the sender's key, and the base64 XDR of
  `unsignedTx` after the sender has signed it.
- **Output:** `{ status: "submitted", hash, ledger, corridorId, anchorId }`

```jsonc
// input
{
  "unsignedEnvelope": { "intent": { "type": "offramp", "..." }, "intentHash": "<64-hex>" },
  "signature": "<base64 ed25519 sig over intentHash>",
  "signedTx": "<base64 signed transaction XDR>"
}
// output
{
  "status": "submitted",
  "hash": "<64-hex tx hash>",
  "ledger": 12345,
  "corridorId": "usdc-ngn",
  "anchorId": "cowrie"
}
```

Only the off-ramp intent surface is supported today, matching `quote`/`prepare`
above. Per #819, broader intent types (beyond off-ramp) are deferred until the
universal intent collapse work lands, so the tool doesn't ship off-ramp-only
assumptions baked into a wider surface prematurely.

### `intel.anchor.reputation` (packages/mcp only)

Returns 7/30/90-day rolling percentile scorecards for an anchor, fetched from
the Stellar Intel API (`/api/reputation/{anchor}`).

- **Input:** `{ anchor: string }` — anchor identifier (e.g. `cowrie`,
  `flutterwave`)
- **Output:** `{ anchorId, scorecards }` where `scorecards` maps each window
  (`7`, `30`, `90`) to either an `ok` scorecard
  (`{ state: "ok", window, sampleSize, fillRate, settleMs: { p50, p95 }, slippage: { p50, p95 }, computedAt, lastPublisherTxTimestamp }`)
  or `{ state: "insufficient_data", window, sampleSize, computedAt, lastPublisherTxTimestamp }`
  when the window has too few samples to score.

```jsonc
// input
{ "anchor": "cowrie" }
// output (abridged)
{
  "anchorId": "cowrie",
  "scorecards": {
    "7": {
      "state": "ok",
      "window": 7,
      "sampleSize": 42,
      "fillRate": 0.97,
      "settleMs": { "p50": 41000, "p95": 92000 },
      "slippage": { "p50": 0.001, "p95": 0.004 },
      "computedAt": "2026-…Z",
      "lastPublisherTxTimestamp": "2026-…Z"
    },
    "30": { "state": "insufficient_data", "window": 30, "sampleSize": 3, "computedAt": "2026-…Z", "lastPublisherTxTimestamp": null }
  }
}
```

### `intel.anchor.health` (packages/mcp only)

Returns the current health of an anchor, fetched from the Stellar Intel API
(`/api/v1/anchors/{id}/health`). The anchor is looked up by home or service
domain; passing an `asset` the anchor does not support is an error.

- **Input:** `{ domain: string, asset?: string }` — anchor domain (e.g.
  `anclap.com`) and an optional asset code to check (e.g. `USDC`, `NGN`)
- **Output:**
  `{ anchorId, status, consecutiveFailures, degraded, lastCheckedAt, lastError, stale }`

```jsonc
// input
{ "domain": "anclap.com", "asset": "USDC" }
// output
{
  "anchorId": "anclap",
  "status": "healthy",
  "consecutiveFailures": 0,
  "degraded": false,
  "lastCheckedAt": "2026-…Z",
  "lastError": null,
  "stale": false
}
```

## Tests

- `tests/mcp-offramp.spec.ts` — unit tests for the off-ramp tool cores,
  including the acceptance check that the returned envelope signs correctly
  with a provided keypair (#136).
- `tests/mcp-e2e.spec.ts` — spawns the server as a subprocess and exercises the
  tools through a real MCP client, asserting valid responses and a clean exit
  (#137).
- `tests/mcp-http-e2e.spec.ts` — the same end-to-end pass over the streamable
  HTTP transport.

```bash
npm run test -- tests/mcp-offramp.spec.ts tests/mcp-e2e.spec.ts tests/mcp-http-e2e.spec.ts
```
