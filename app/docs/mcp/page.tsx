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

      {/* Not-yet-published notice */}
      <section className="rounded-xl border border-amber-500/30 bg-amber-50 p-6 dark:bg-amber-950/20">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-amber-900 dark:text-amber-200">
          <svg
            className="h-5 w-5 shrink-0"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-7h-2v5h2V9z" />
          </svg>
          The MCP package is not published yet
        </h2>
        <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">
          <code className="text-xs">@stellarintel/mcp</code> is not yet on npm — running{' '}
          <code className="text-xs">npm install @stellarintel/mcp</code> returns 404 today. The
          server is built, and publication is tracked in{' '}
          <a
            href="https://github.com/ezedike-evan/stellar-intel/issues/806"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline underline-offset-2"
          >
            #806
          </a>{' '}
          for status updates. Until it ships, run it from this repository (see{' '}
          <a href="#installation" className="font-medium underline underline-offset-2">
            Installation
          </a>{' '}
          below).
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">Overview</h2>
        <p className="text-secondary-text">
          The MCP server exposes Stellar Intel&apos;s off-ramp routing to MCP-capable agents over
          stdio. It reuses the same routing and canonical-hashing logic as the web app.
        </p>
        <p className="text-secondary-text">
          The server ships as <code className="text-accent">@stellarintel/mcp</code>, which is not
          yet published to npm. It runs from this repository today.
        </p>
      </section>

      <section id="installation" className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">Installation</h2>
        <p className="text-secondary-text">
          The package is not on npm yet, so install it from this repository:
        </p>
        <CodeBlock
          language="bash"
          code={`git clone https://github.com/ezedike-evan/stellar-intel
cd stellar-intel
npm install`}
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">Running the Server</h2>
        <CodeBlock
          language="bash"
          code={`# Build and run the MCP package over stdio (from the repo root)
npm run build --workspace=@stellarintel/mcp   # tsc -> dist/
npm start --workspace=@stellarintel/mcp       # node dist/packages/mcp/src/index.js

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
              href="https://github.com/ezedike-evan/stellar-intel/issues/806"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              Publication status tracking issue (#806) →
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
