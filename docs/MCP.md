# Stellar Intel — MCP Server

**Last reviewed:** 2026-08-26

The MCP server exposes Stellar Intel's off-ramp routing to MCP-capable agents
over stdio. It lives in [`scripts/mcp`](../scripts/mcp) and reuses the same
routing + canonical-hashing logic as the web app (`lib/mcp/offramp.ts`).

**Scope:** Stellar Intel abstracts anchors, not chains. These tools answer
"what's my best fiat exit price, and which Stellar anchor should I trust to
execute it" — not "move this value across chains." For cross-chain pay/bridge
intents, an agent should reach for ROZO instead. See
[docs/AGENT_POSITIONING.md](AGENT_POSITIONING.md) for the full comparison.

## Running

```bash
npx tsx scripts/mcp/server.ts
```

The server applies safe mainnet defaults for the `NEXT_PUBLIC_*` config values,
so an agent does not need the web app's `.env` to invoke it.

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

## Tests

- `tests/mcp-offramp.spec.ts` — unit tests for both tool cores, including the
  acceptance check that the returned envelope signs correctly with a provided
  keypair (#136).
- `tests/mcp-e2e.spec.ts` — spawns the server as a subprocess and exercises both
  tools through a real MCP client, asserting valid responses and a clean exit
  (#137).

```bash
npm run test -- tests/mcp-offramp.spec.ts tests/mcp-e2e.spec.ts
```
