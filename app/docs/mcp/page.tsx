import { CodeBlock } from '@/components/docs/CodeBlock';

export default function McpPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-primary-text">MCP Tool Docs</h1>
        <p className="mt-2 text-lg text-secondary-text">
          Use Stellar Intel through AI agents via the Model Context Protocol (MCP) server.
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">Overview</h2>
        <p className="text-secondary-text">
          The MCP server exposes Stellar Intel&apos;s off-ramp routing and anchor intelligence to
          MCP-capable agents over stdio or streamable HTTP. It reuses the same routing and
          canonical-hashing logic as the web app.
        </p>
        <p className="text-secondary-text">
          The server lives in the repository as the{' '}
          <code className="text-accent">@stellarintel/mcp</code> workspace package (
          <code>packages/mcp</code>). <strong>It is not yet published to npm</strong> —{' '}
          <code>npm install @stellarintel/mcp</code> currently fails with a 404, so run it from a
          clone of the repository as shown below.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">Installation</h2>
        <CodeBlock
          language="bash"
          code={`git clone https://github.com/ezedike-evan/stellar-intel.git
cd stellar-intel
npm install`}
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">Running the Server</h2>
        <CodeBlock
          language="bash"
          code={`# Full tool set, from the workspace package (stdio transport)
npx tsx packages/mcp/src/index.ts

# Streamable HTTP instead of stdio — binds http://127.0.0.1:3000/mcp
npx tsx packages/mcp/src/index.ts --transport http --port 3000

# In-repo dev server (off-ramp tools only, stdio only)
npx tsx scripts/mcp/server.ts`}
        />
        <p className="text-sm text-secondary-text">
          Point any MCP-capable client (Claude Desktop, an agent framework, etc.) at the{' '}
          <code>tsx</code> command as a stdio server, or at the <code>/mcp</code> URL when using the
          HTTP transport. The <code>intel.anchor.*</code> tools call the Stellar Intel HTTP API at{' '}
          <code>NEXT_PUBLIC_APP_URL</code> (default <code>http://localhost:3000</code>), so they
          need a running app instance.
        </p>
      </section>

      <section className="space-y-6">
        <h2 className="text-xl font-semibold text-primary-text">Available Tools</h2>

        <div className="rounded-xl border border-border p-5">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-primary-text">
            <span className="rounded bg-accent-subtle px-2 py-0.5 text-xs font-medium text-accent">
              TOOL
            </span>
            intel.offramp.quote
          </h3>
          <p className="mt-2 text-sm text-secondary-text">
            Returns the best net-received quote for a corridor + amount. The rate is sourced from
            the routed anchor&apos;s current price (SEP-38 firm quote, falling back to SEP-24/SEP-6
            fee-adjusted live FX) — it can return <code>RATE_UNAVAILABLE</code> if the anchor cannot
            currently be quoted.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <h4 className="mb-2 text-sm font-medium text-primary-text">Input</h4>
              <CodeBlock
                language="json"
                code={`{
  "from": "USDC",
  "to": "NGN",
  "amount": "100"
}`}
              />
            </div>
            <div>
              <h4 className="mb-2 text-sm font-medium text-primary-text">Output</h4>
              <CodeBlock
                language="json"
                code={`{
  "anchor": "cowrie",
  "quoteId": "<64-hex sha256>",
  "netReceived": "156800",
  "expiresAt": "2026-…Z"
}`}
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border p-5">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-primary-text">
            <span className="rounded bg-accent-subtle px-2 py-0.5 text-xs font-medium text-accent">
              TOOL
            </span>
            intel.offramp.prepare
          </h3>
          <p className="mt-2 text-sm text-secondary-text">
            Returns an <strong>unsigned</strong> intent envelope plus an unsigned Stellar
            transaction for an agent to sign. The <code>intentHash</code> is the canonical SHA-256
            hash the agent signs.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <h4 className="mb-2 text-sm font-medium text-primary-text">Input</h4>
              <p className="mb-2 text-xs text-secondary-text">
                An off-ramp intent without a signature:
              </p>
              <CodeBlock
                language="json"
                code={`{
  "type": "offramp",
  "sourceAsset": "USDC",
  "destinationAsset": "NGN",
  "amount": "100",
  "sender": "GABC…",
  "recipient": "GBDEST…"
}`}
              />
            </div>
            <div>
              <h4 className="mb-2 text-sm font-medium text-primary-text">Output</h4>
              <CodeBlock
                language="json"
                code={`{
  "unsignedEnvelope": {
    "intent": { … },
    "intentHash": "<sha256-hex>"
  },
  "unsignedTx": "<base64-xdr>"
}`}
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border p-5">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-primary-text">
            <span className="rounded bg-accent-subtle px-2 py-0.5 text-xs font-medium text-accent">
              TOOL
            </span>
            intel.execute
          </h3>
          <p className="mt-2 text-sm text-secondary-text">
            Carries a prepared intent through to execution.{' '}
            <strong>Stellar Intel never signs anything</strong> — the calling agent signs the{' '}
            <code>intentHash</code> and the <code>unsignedTx</code> from{' '}
            <code>intel.offramp.prepare</code> with its own wallet before calling this tool. The
            server verifies the signed material still matches the prepared intent, then submits the
            transaction to Horizon; any mismatch is rejected before anything reaches the network.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <h4 className="mb-2 text-sm font-medium text-primary-text">Input</h4>
              <CodeBlock
                language="json"
                code={`{
  "unsignedEnvelope": {
    "intent": { "type": "offramp", … },
    "intentHash": "<64-hex sha256>"
  },
  "signature": "<base64 ed25519 sig over intentHash>",
  "signedTx": "<base64 signed transaction XDR>"
}`}
              />
            </div>
            <div>
              <h4 className="mb-2 text-sm font-medium text-primary-text">Output</h4>
              <CodeBlock
                language="json"
                code={`{
  "status": "submitted",
  "hash": "<64-hex tx hash>",
  "ledger": 12345,
  "corridorId": "usdc-ngn",
  "anchorId": "cowrie"
}`}
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border p-5">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-primary-text">
            <span className="rounded bg-accent-subtle px-2 py-0.5 text-xs font-medium text-accent">
              TOOL
            </span>
            intel.anchor.reputation
          </h3>
          <p className="mt-2 text-sm text-secondary-text">
            Returns 7/30/90-day rolling percentile scorecards for an anchor. Each scorecard shows
            state (<code>ok</code> or <code>insufficient_data</code>), sample size, fill rate,
            settlement latency percentiles (p50/p95), and slippage percentiles (p50/p95). Available
            from the <code>packages/mcp</code> server only.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <h4 className="mb-2 text-sm font-medium text-primary-text">Input</h4>
              <CodeBlock language="json" code={`{ "anchor": "cowrie" }`} />
            </div>
            <div>
              <h4 className="mb-2 text-sm font-medium text-primary-text">Output (abridged)</h4>
              <CodeBlock
                language="json"
                code={`{
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
    }
  }
}`}
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border p-5">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-primary-text">
            <span className="rounded bg-accent-subtle px-2 py-0.5 text-xs font-medium text-accent">
              TOOL
            </span>
            intel.anchor.health
          </h3>
          <p className="mt-2 text-sm text-secondary-text">
            Returns the current status, consecutive failure count, degraded flag, last check
            timestamp, last error message, and staleness flag for a given anchor domain and optional
            asset. Available from the <code>packages/mcp</code> server only.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <h4 className="mb-2 text-sm font-medium text-primary-text">Input</h4>
              <CodeBlock
                language="json"
                code={`{
  "domain": "anclap.com",
  "asset": "USDC"
}`}
              />
            </div>
            <div>
              <h4 className="mb-2 text-sm font-medium text-primary-text">Output</h4>
              <CodeBlock
                language="json"
                code={`{
  "anchorId": "anclap",
  "status": "healthy",
  "consecutiveFailures": 0,
  "degraded": false,
  "lastCheckedAt": "2026-…Z",
  "lastError": null,
  "stale": false
}`}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">Security Model</h2>
        <div className="rounded-xl border border-border bg-bg-subtle p-5">
          <p className="text-sm text-secondary-text">
            <strong>Non-custodial by design.</strong> The MCP server never holds signing keys. It
            can <em>prepare</em> intents and unsigned transactions, and <code>intel.execute</code>{' '}
            only <em>verifies</em> material the sender&apos;s own wallet has already signed — the
            intent hash and the transaction itself — before submitting to Horizon. Nothing can be
            spent without a signature produced outside this server, and signed material that no
            longer matches the prepared intent is rejected.
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">Testing</h2>
        <p className="text-secondary-text">Tests are located in the main app repository:</p>
        <CodeBlock
          language="bash"
          code={`# Unit tests
npm run test -- tests/mcp-offramp.spec.ts

# E2E tests (spawns server + real MCP client, stdio and HTTP)
npm run test -- tests/mcp-e2e.spec.ts tests/mcp-http-e2e.spec.ts`}
        />
      </section>

      <section className="rounded-xl border border-border bg-bg-subtle p-6">
        <h2 className="text-lg font-semibold text-primary-text">Related resources</h2>
        <ul className="mt-3 space-y-2 text-sm">
          <li>
            <a
              href="https://github.com/ezedike-evan/stellar-intel/blob/main/docs/MCP.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              MCP docs in repository →
            </a>
          </li>
          <li>
            <a
              href="https://github.com/ezedike-evan/stellar-intel/tree/main/packages/mcp"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              @stellarintel/mcp package source (not yet on npm) →
            </a>
          </li>
          <li>
            <a href="/docs/quickstart" className="text-accent hover:underline">
              Quickstart guide →
            </a>
          </li>
        </ul>
      </section>
    </div>
  );
}
