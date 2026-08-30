# @stellarintel/mcp

[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

An [MCP](https://modelcontextprotocol.io) server for
[Stellar Intel](https://github.com/ezedike-evan/stellar-intel), built on
[`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
and served over stdio (the default) or streamable HTTP.

## Status

`createServer()` (`src/server.ts`) stands up the MCP server and registers
three tools, all backed directly by
[`lib/mcp/offramp.ts`](https://github.com/ezedike-evan/stellar-intel/blob/main/lib/mcp/offramp.ts)
in the main app (imported at build time — see below), so this package and the
in-repo dev server at
[`scripts/mcp/server.ts`](https://github.com/ezedike-evan/stellar-intel/blob/main/scripts/mcp)
(see [`docs/MCP.md`](https://github.com/ezedike-evan/stellar-intel/blob/main/docs/MCP.md))
share the exact same logic:

- `intel.offramp.quote` (`readOnlyHint`) — live net-received quote for a
  corridor + amount. The rate is sourced from the routed anchor's own current
  price (SEP-38 firm quote, falling back to SEP-24/SEP-6 fee-adjusted live
  FX), not a static table — it can return `RATE_UNAVAILABLE` if the anchor
  can't currently be quoted.
- `intel.offramp.prepare` (`readOnlyHint`) — unsigned intent envelope +
  unsigned Stellar transaction for agent signing. Read-only: nothing is
  submitted on-chain until `intel.execute` is called.
- `intel.execute` (`destructiveHint`, `idempotentHint: false`) — carries a
  prepared, agent-signed intent through to execution. Verifies the signed
  transaction still matches the intent it was prepared for, then submits it
  to Horizon; Stellar Intel never signs anything — the calling agent's own
  wallet signs the intent hash and the transaction before calling this tool.
  It is the only tool in this server marked destructive in `tools/list`.

### Rate limiting

Every tool call is counted against a per-client bucket before the handler runs,
so one agent in a loop cannot exhaust anchor quotas for everyone — the cost of a
tool call is paid at the anchor, not here.

The limiter is the one the REST surface already uses
([`lib/api/rate-limit.ts`](https://github.com/ezedike-evan/stellar-intel/blob/main/lib/api/rate-limit.ts)),
not a second implementation: same fixed windows, same Postgres-backed shared
state, same per-instance fallback when no database is configured.

- **Client identity** — the Streamable HTTP session id where there is one,
  otherwise the forwarded client IP, otherwise a single local key. A stdio
  server is a subprocess of exactly one client, so per-client and per-process
  are the same thing there.
- **Buckets** — `mcp.tools:<tool name>`, so one tool being exhausted does not
  throttle the others, and MCP traffic is counted separately from the `v1.*`
  REST buckets.
- **Limits** — `MCP_RATE_LIMIT_MAX` (default 60) requests per
  `MCP_RATE_LIMIT_WINDOW_MS` (default 60000).
- **When the limit is hit** — the call is refused *before* the handler runs, so
  it never reaches an anchor. The result is `isError` with a text body leading
  `RATE_LIMITED:` (the same `CODE: message` shape the other tools use) and a
  structured payload under the `stellarintel/rateLimit` `_meta` key carrying
  `code`, `tool`, `retryAfter`, `limit`, `resetAt` and `shared` — so a client
  can tell "you were throttled" from "the anchor is down" without parsing prose.

### Build

This package's `tsc` build reaches across the workspace into the main app's
`lib/`, `constants/`, and `types/` trees (via `rootDir`/`paths` in
`tsconfig.json`) so it reuses the same off-ramp logic instead of duplicating
it, then rewrites the `@/` path aliases to real relative `require()`s with
[`tsc-alias`](https://www.npmjs.com/package/tsc-alias) so the published
`dist/` is self-contained and runnable with plain `node` outside this
monorepo. `main`/`bin` point at `dist/packages/mcp/src/index.js` — the
mirrored path is a side effect of `rootDir` spanning the repo root.

## Install

```bash
npm install @stellarintel/mcp
```

## Usage

The same binary runs over either transport; stdio is the default. Both
transports expose the exact same tool set.

### stdio (default)

```bash
npm run build   # tsc -> dist/
npm start       # node dist/packages/mcp/src/index.js, stdio transport
npm run dev     # same, via ts-node, no build step
```

Point any MCP-capable client (Claude Desktop, an agent framework, etc.) at
the built `dist/packages/mcp/src/index.js` as a stdio command.

### Streamable HTTP

```bash
node dist/packages/mcp/src/index.js --transport http [--host 127.0.0.1] [--port 3000]
```

The server binds to `http://<host>:<port>/mcp` and any MCP client can reach it
with just that URL (no local install needed):

```jsonc
{
  "mcpServers": {
    "stellar-intel": { "url": "http://127.0.0.1:3000/mcp" },
  },
}
```

Sessions are managed per agent (each initialization gets its own session ID),
so multiple hosted agents can use the server concurrently.

## Documentation

Full API reference, quickstart guides, and integration docs are available in the
[Stellar Intel Developer Portal](https://stellar-intel.vercel.app/docs).

## Related

- [`@stellarintel/publisher`](https://www.npmjs.com/package/@stellarintel/publisher) — off-chain publisher for the reputation oracle this server will eventually expose.
