import type { Metadata } from 'next';
import { CodeBlock } from '@/components/docs/CodeBlock';

export const metadata: Metadata = {
  title: 'Quickstart',
  description:
    'Make your first Stellar Intel API call in under 5 minutes — fetch off-ramp rates, check anchor reputation, and submit an intent using curl or the Rust client. No SDK required.',
};

export default function QuickstartPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-primary-text">Quickstart</h1>
        <p className="mt-2 text-lg text-secondary-text">
          Make your first API call in under 5 minutes. No SDK required.
        </p>
      </div>

      <section className="space-y-4 rounded-xl border border-border bg-bg-subtle p-6">
        <h2 className="text-xl font-semibold text-primary-text">Start here: no install required</h2>
        <p className="text-secondary-text">
          The hosted API is available today. Use the commands below with <code>curl</code>; piping
          the response to <code>jq</code> is optional. If you prefer a client library, the Rust
          client can be installed directly from this repository.
        </p>
        <CodeBlock
          language="toml"
          code={`[dependencies]
stellar-intel-client = { git = "https://github.com/ezedike-evan/stellar-intel", package = "stellar-intel-client" }`}
        />
        <p className="text-sm text-secondary-text">
          The published <code>@stellarintel/sdk</code> package is planned but is not available yet.
          Do not use <code>npm install @stellarintel/sdk</code> until it is published.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">1. Compare rates for a corridor</h2>
        <p className="text-secondary-text">
          Fetch live quotes for <strong>USDC to NGN</strong> (Nigeria Naira) across every integrated
          anchor.
        </p>
        <CodeBlock
          language="bash"
          code={`curl -sS "https://stellar-intel.vercel.app/api/rates/usdc-ngn?amount=100"`}
        />
        <p className="text-sm text-secondary-text">
          Returns one row per anchor with <code>exchangeRate</code>, <code>fee</code>,{' '}
          <code>totalReceived</code>, and the quote <code>source</code>.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">
          2. Check an anchor&apos;s reputation
        </h2>
        <p className="text-secondary-text">
          Get the composite reputation score for a specific anchor.
        </p>
        <CodeBlock
          language="bash"
          code={`curl -sS "https://stellar-intel.vercel.app/api/reputation/cowrie"`}
        />
        <p className="text-sm text-secondary-text">
          Returns scorecards, fill rate, settle latency, and sample counts.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">3. View the leaderboard</h2>
        <p className="text-secondary-text">
          See how all anchors rank by composite reputation score.
        </p>
        <CodeBlock
          language="bash"
          code={`curl -sS "https://stellar-intel.vercel.app/api/reputation/leaderboard?corridor=usdc-ngn"`}
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">4. Submit an off-ramp intent</h2>
        <p className="text-secondary-text">
          Build, canonicalize, and sign an intent on the client, then submit it to the server.
        </p>
        <CodeBlock
          language="bash"
          code={`# Build the intent, canonicalize, SHA-256, Ed25519-sign (client-side with Freighter).
# Then POST the signed envelope:
curl -sX POST https://stellar-intel.vercel.app/api/intent/offramp \\
  -H 'content-type: application/json' \\
  -d '{
    "type": "offramp",
    "sourceAsset": "USDC",
    "destinationAsset": "NGN",
    "amount": "100",
    "sender": "GABC…",
    "recipient": "GBDEST…"
  }'`}
        />
        <p className="text-sm text-secondary-text">
          On success, returns an unsigned Stellar transaction (XDR) and a quote ID.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-primary-text">5. Read public on-chain scores</h2>
        <p className="text-secondary-text">
          Consume the public reputation scores endpoint (versioned, rate-limited).
        </p>
        <CodeBlock
          language="bash"
          code={`curl -sS "https://stellar-intel.vercel.app/v1/public/scores"`}
        />
      </section>

      <section className="rounded-xl border border-border bg-bg-subtle p-6">
        <h2 className="text-lg font-semibold text-primary-text">Next steps</h2>
        <ul className="mt-3 space-y-2 text-sm text-secondary-text">
          <li>
            • Read about{' '}
            <a href="/docs/auth" className="text-accent hover:underline">
              authentication and rate limits
            </a>
          </li>
          <li>
            • Explore the{' '}
            <a href="/docs/api" className="text-accent hover:underline">
              interactive API reference
            </a>
          </li>
          <li>
            • Set up{' '}
            <a href="/docs/webhooks" className="text-accent hover:underline">
              webhook notifications
            </a>
          </li>
          <li>
            • Browse the{' '}
            <a href="/docs/sdks" className="text-accent hover:underline">
              SDK documentation
            </a>
          </li>
          <li>
            • Integrate with AI agents via{' '}
            <a href="/docs/mcp" className="text-accent hover:underline">
              MCP
            </a>
          </li>
        </ul>
      </section>
    </div>
  );
}
