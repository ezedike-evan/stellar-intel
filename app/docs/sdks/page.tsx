import { CodeBlock } from '@/components/docs/CodeBlock';

export default function SdksPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-primary-text">SDKs & Libraries</h1>
        <p className="mt-2 text-lg text-secondary-text">
          Client libraries for integrating Stellar Intel into your application.
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
          SDK packages are not published yet
        </h2>
        <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">
          None of the SDK packages exist on their registries yet:{' '}
          <code className="text-xs">@stellarintel/sdk</code>,{' '}
          <code className="text-xs">@stellarintel/mcp</code>, and{' '}
          <code className="text-xs">@stellarintel/publisher</code> are not on npm,{' '}
          <code className="text-xs">stellar-intel</code> is not on PyPI, and{' '}
          <code className="text-xs">stellar-intel-reputation</code> is not on crates.io — running
          their install commands returns 404 today. The packages are built, and publication is
          tracked in{' '}
          <a
            href="https://github.com/ezedike-evan/stellar-intel/issues/806"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline underline-offset-2"
          >
            #806
          </a>{' '}
          for status updates. Until they ship, use the HTTP API directly (examples below).
        </p>
      </section>

      {/* TypeScript SDK */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-accent-subtle p-2">
            <svg
              aria-hidden="true"
              className="h-6 w-6 text-accent"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M0 12v6.5l12 5.5 12-5.5V12l-12 5.5L0 12zm0-6.5L12 11 24 5.5 12 0 0 5.5z" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-semibold text-primary-text">TypeScript / JavaScript</h2>
            <p className="text-sm text-secondary-text">
              <code className="text-xs">@stellarintel/sdk</code> — Not yet published (npm, v4)
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-accent-subtle p-5 /50">
          <p className="text-sm font-medium text-accent">
            Status: Not published — The typed SDK is built but not yet on npm; it ships as a v4
            deliverable.
          </p>
          <p className="mt-1 text-sm text-accent dark:text-accent">
            Until it ships, use the HTTP API directly (examples below).
          </p>
        </div>

        <p className="text-secondary-text">
          You can use the HTTP API directly from any TypeScript or JavaScript application today:
        </p>
        <CodeBlock
          language="typescript"
          code={`// Minimal typed fetch wrapper
const BASE = 'https://stellar-intel.vercel.app';

export async function getRates(corridorId: string, amount = '100') {
  const res = await fetch(\`\${BASE}/api/rates/\${corridorId}?amount=\${amount}\`);
  if (!res.ok) throw new Error(\`rates \${res.status}\`);
  return res.json();
}

export async function getReputation(anchorId: string) {
  const res = await fetch(\`\${BASE}/api/reputation/\${anchorId}\`);
  if (!res.ok) throw new Error(\`reputation \${res.status}\`);
  return res.json();
}

export async function submitOfframpIntent(body: unknown) {
  const res = await fetch(\`\${BASE}/api/intent/offramp\`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(\`intent \${res.status}\`);
  return res.json();
}`}
        />
        <p className="text-sm text-secondary-text">
          Types can be imported from the repo: <code>OfframpIntent</code>,{' '}
          <code>SignedIntentEnvelope</code>,<code>IntentV1</code> in <code>types/intent.ts</code>.
        </p>
      </section>

      {/* Python SDK */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-accent-subtle p-2">
            <svg
              aria-hidden="true"
              className="h-6 w-6 text-status-up"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M11.9 0C10.07 0 8.54.37 7.5 1.12c-1.04.75-1.56 1.78-1.56 3v2.25c0 .87.26 1.48.78 1.86.52.37 1.2.56 2.03.56h3.9c.84 0 1.54.26 2.1.78.56.52.83 1.22.83 2.1v1.5H9.22c-.87 0-1.66.28-2.35.84-.67.56-1.01 1.3-1.01 2.22v4.22c0 .85.33 1.6 1 2.25.67.66 1.47 1.08 2.4 1.28.94.2 1.86.3 2.78.3 1.86 0 3.36-.42 4.52-1.28 1.16-.85 1.74-2 1.74-3.45v-2.06c0-.87-.27-1.56-.8-2.06-.54-.5-1.23-.75-2.08-.75h-4.1c-.86 0-1.57-.28-2.12-.84-.56-.56-.84-1.27-.84-2.1v-1.5h6.75c.87 0 1.6-.24 2.2-.72.6-.48.9-1.2.9-2.16v-4.5c0-.93-.34-1.7-1.03-2.3C15.6.32 14.4 0 12.65 0H11.9zm-.5 2.25c.4 0 .74.14 1.02.42.28.28.42.62.42 1.02 0 .4-.14.74-.42 1.02-.28.28-.64.42-1.04.42-.4 0-.74-.14-1.02-.42a1.38 1.38 0 01-.4-1.02c0-.4.14-.74.42-1.02.28-.28.63-.42 1.03-.42z" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-semibold text-primary-text">Python</h2>
            <p className="text-sm text-secondary-text">
              <code className="text-xs">stellar-intel</code> — Not yet published (PyPI)
            </p>
          </div>
        </div>

        <p className="text-secondary-text">
          You can use the HTTP API directly from any Python application today:
        </p>
        <CodeBlock
          language="python"
          code={`import httpx

BASE = "https://stellar-intel.vercel.app"

def get_rates(corridor_id: str, amount: str = "100") -> dict:
    resp = httpx.get(
        f"{BASE}/api/rates/{corridor_id}",
        params={"amount": amount}
    )
    resp.raise_for_status()
    return resp.json()

def get_reputation(anchor_id: str) -> dict:
    resp = httpx.get(f"{BASE}/api/reputation/{anchor_id}")
    resp.raise_for_status()
    return resp.json()

def get_leaderboard(corridor: str | None = None) -> dict:
    params = {}
    if corridor:
        params["corridor"] = corridor
    resp = httpx.get(
        f"{BASE}/api/reputation/leaderboard",
        params=params
    )
    resp.raise_for_status()
    return resp.json()`}
        />
      </section>

      {/* Rust SDK */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="rounded-sm bg-bg-sunken p-2">
            <svg
              aria-hidden="true"
              className="h-6 w-6 text-status-unknown dark:text-status-unknown"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M19.7 12.1c0 .4-.1.7-.1 1.1.1.4.2.8.4 1.1l.4.8c.2.4.4.8.5 1.2.2.4.3.8.3 1.2 0 .5-.2.9-.5 1.3-.3.4-.7.6-1.1.7-.4.1-.8.1-1.2 0h-.1c-.4 0-.8-.1-1.1-.2-.4-.1-.7-.3-1.1-.5l-.8-.4c-.8-.4-1.5-.7-2.4-.9-.8-.2-1.7-.3-2.6-.3-.9 0-2.1.1-2.9.3-.8.2-1.5.5-2.2.9l-.8.4c-.4.2-.7.3-1.1.5-.4.1-.7.2-1.1.2h-.1c-.4 0-.8 0-1.2-.1-.4-.1-.8-.3-1.1-.7-.3-.3-.4-.7-.4-1.1 0-.4.1-.8.2-1.2.1-.4.3-.8.5-1.2l.4-.8c.2-.4.4-.7.5-1.1.1-.4.2-.8.3-1.2V12c0-.8 0-1.5-.1-2.2 0-.7-.1-1.3-.2-2-.1-.7-.2-1.3-.4-1.9L3.5 5c-.2-.5-.4-.9-.5-1.3C2.9 3.3 2.9 3 3 2.7c.1-.3.3-.5.5-.7.2-.2.5-.3.8-.4.3-.1.6-.1.9 0 .3 0 .6.1.9.3l.6.3c.5.3 1 .5 1.5.7.5.2 1 .3 1.6.4.6.1 1.2.1 1.8.1h1.4c.6 0 1.2 0 1.8-.1.6-.1 1.1-.2 1.6-.4.5-.2 1-.4 1.5-.7l.6-.3c.3-.2.6-.3.9-.3.3 0 .6 0 .9.1.3.1.5.2.7.4.2.2.3.4.4.7.1.3 0 .6-.1.9-.2.4-.3.8-.5 1.3l-.3.7c-.2.6-.3 1.2-.4 1.9-.1.7-.2 1.3-.2 2-.1.7-.1 1.4-.1 2.2V12z" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-semibold text-primary-text">Rust</h2>
            <p className="text-sm text-secondary-text">
              <code className="text-xs">stellar-intel-reputation</code> — Not yet published
              (crates.io)
            </p>
          </div>
        </div>

        <p className="text-secondary-text">
          The <code>stellar-intel-reputation</code> crate provides a typed client for reading
          reputation data from the Soroban oracle contract on-chain. It is built but not yet
          published to crates.io — depend on it from this repository until then:
        </p>
        <CodeBlock
          language="toml"
          code={`[dependencies]
stellar-intel-reputation = { git = "https://github.com/ezedike-evan/stellar-intel", package = "stellar-intel-reputation" }
soroban-sdk = "22.0"`}
        />
        <CodeBlock
          language="rust"
          code={`use stellar_intel_reputation::ReputationReader;
use soroban_sdk::{Env, Address};

fn read_anchor_score(env: Env, contract_id: Address, anchor: Address) {
    let reader = ReputationReader::new(&env, &contract_id);
    let score = reader.score(&anchor);
    println!("Anchor score: {:?}", score);
}`}
        />
        <p className="text-sm text-secondary-text">
          For HTTP API access from Rust, use <code>reqwest</code>:
        </p>
        <CodeBlock
          language="rust"
          code={`use reqwest::Client;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = Client::new();
    let resp = client
        .get("https://stellar-intel.vercel.app/api/rates/usdc-ngn")
        .query(&[("amount", "100")])
        .send()
        .await?
        .json::<serde_json::Value>()
        .await?;
    println!("{:#}", resp);
    Ok(())
}`}
        />
      </section>

      {/* MCP Package */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-bg-sunken p-2 dark:bg-accent-subtle">
            <svg
              aria-hidden="true"
              className="h-6 w-6 text-accent dark:text-accent"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-semibold text-primary-text">MCP Server (TypeScript)</h2>
            <p className="text-sm text-secondary-text">
              <code className="text-xs">@stellarintel/mcp</code> — Not yet published (npm)
            </p>
          </div>
        </div>

        <p className="text-secondary-text">
          The MCP package exposes Stellar Intel&apos;s off-ramp routing to MCP-capable AI agents. It
          is built but not yet published to npm, so install and run it from this repository:
        </p>
        <CodeBlock
          language="bash"
          code={`git clone https://github.com/ezedike-evan/stellar-intel
cd stellar-intel
npm install
npm run build --workspace=@stellarintel/mcp
npm start --workspace=@stellarintel/mcp`}
        />
        <p className="text-sm text-secondary-text">
          See the{' '}
          <a href="/docs/mcp" className="text-accent hover:underline">
            MCP tool docs
          </a>{' '}
          for full usage.
        </p>
      </section>

      <section className="rounded-xl border border-border bg-bg-subtle p-6">
        <h2 className="text-lg font-semibold text-primary-text">Package summary</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-left font-medium text-primary-text">Package</th>
                <th className="px-3 py-2 text-left font-medium text-primary-text">Language</th>
                <th className="px-3 py-2 text-left font-medium text-primary-text">Status</th>
                <th className="px-3 py-2 text-left font-medium text-primary-text">Registry</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className="px-3 py-2 font-mono text-xs text-accent">@stellarintel/sdk</td>
                <td className="px-3 py-2 text-secondary-text">TypeScript</td>
                <td className="px-3 py-2">
                  <span className="rounded-full bg-bg-sunken px-2 py-0.5 text-xs text-status-unknown">
                    Not published
                  </span>
                </td>
                <td className="px-3 py-2 text-secondary-text">npm (v4)</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-xs text-accent">@stellarintel/mcp</td>
                <td className="px-3 py-2 text-secondary-text">TypeScript</td>
                <td className="px-3 py-2">
                  <span className="rounded-full bg-bg-sunken px-2 py-0.5 text-xs text-status-unknown">
                    Not published
                  </span>
                </td>
                <td className="px-3 py-2 text-secondary-text">npm</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-xs text-accent">@stellarintel/publisher</td>
                <td className="px-3 py-2 text-secondary-text">TypeScript</td>
                <td className="px-3 py-2">
                  <span className="rounded-full bg-bg-sunken px-2 py-0.5 text-xs text-status-unknown">
                    Not published
                  </span>
                </td>
                <td className="px-3 py-2 text-secondary-text">npm</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-xs text-accent">
                  stellar-intel-reputation
                </td>
                <td className="px-3 py-2 text-secondary-text">Rust</td>
                <td className="px-3 py-2">
                  <span className="rounded-full bg-bg-sunken px-2 py-0.5 text-xs text-status-unknown">
                    Not published
                  </span>
                </td>
                <td className="px-3 py-2 text-secondary-text">crates.io</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-xs text-accent">stellar-intel (Python)</td>
                <td className="px-3 py-2 text-secondary-text">Python</td>
                <td className="px-3 py-2">
                  <span className="rounded-full bg-bg-sunken px-2 py-0.5 text-xs text-status-unknown">
                    Not published
                  </span>
                </td>
                <td className="px-3 py-2 text-secondary-text">PyPI</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
