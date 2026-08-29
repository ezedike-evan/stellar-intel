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
          The MCP server exposes Stellar Intel&apos;s off-ramp routing to MCP-capable agents over
          stdio. It reuses the same routing and canonical-hashing logic as the web app.
        </p>
        <p className="text-secondary-text">
          The server is published on npm as <code className="text-accent">@stellarintel/mcp</code>.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">Installation</h2>
        <CodeBlock language="bash" code={`npm install @stellarintel/mcp`} />
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">Running the Server</h2>
        <CodeBlock
          language="bash"
          code={`# Build and run
npm run build   # tsc -> dist/
npm start       # node dist/index.js, stdio transport

# Or use tsx for development (no build step)
npx tsx scripts/mcp/server.ts`}
        />
        <p className="text-sm text-secondary-text">
          Point any MCP-capable client (Claude Desktop, an agent framework, etc.) at the built entry
          point as a stdio command.
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
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">Security Model</h2>
        <div className="rounded-xl border border-border bg-bg-subtle p-5">
          <p className="text-sm text-secondary-text">
            <strong>Non-custodial by design.</strong> The MCP server can only <em>prepare</em>{' '}
            intents and unsigned transactions — it never holds signing keys. An AI agent can price
            and compare routes autonomously, but the user must sign the final transaction in their
            wallet (Freighter) before execution. The agent cannot spend without a user signature.
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

# E2E tests (spawns server + real MCP client)
npm run test -- tests/mcp-e2e.spec.ts`}
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
              href="https://www.npmjs.com/package/@stellarintel/mcp"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              @stellarintel/mcp on npm →
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
