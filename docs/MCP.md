# Stellar Intel — MCP Server

The MCP server exposes Stellar Intel's off-ramp routing to MCP-capable agents
over stdio. It lives in [`scripts/mcp`](../scripts/mcp) and reuses the same
routing + canonical-hashing logic as the web app (`lib/mcp/offramp.ts`).

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
