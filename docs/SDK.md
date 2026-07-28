# SDK

> **Status: roadmap (v4).** A first-class typed client `@stellarintel/sdk` is a
> v4 "Universal" deliverable (see [`docs/ROADMAP.md`](ROADMAP.md)). It is **not yet
> published to npm** — the npm badge in the README is aspirational. Until it ships,
> use the HTTP API directly (below). The MCP package
> ([`packages/mcp/`](../packages/mcp/), `@stellarintel/mcp`) is the agent-facing
> surface that exists today.

## `stellar-intel-reputation` (Rust, on-chain)

Unlike the other SDKs on this page, `stellar-intel-reputation` is not an HTTP
wrapper — it's the architecturally distinct one. It reads the deployed
Soroban reputation contract ([`contracts/reputation/`](../contracts/reputation/),
interface documented in [`docs/ORACLE_SPEC.md`](ORACLE_SPEC.md)) directly
on-chain from inside another Soroban contract's execution context, with no
API round trip.

Source lives in this repo today at
[`crates/stellar-intel-reputation/`](../crates/stellar-intel-reputation/)
and is publish-ready for crates.io (`cargo publish --dry-run` runs in CI);
until the maintainer wires up a `CARGO_REGISTRY_TOKEN`, depend on it directly:

```toml
[dependencies]
stellar-intel-reputation = { git = "https://github.com/ezedike-evan/stellar-intel", package = "stellar-intel-reputation" }
# once published: stellar-intel-reputation = "0.2"
```

```rust,ignore
use stellar_intel_reputation::ReputationReader;

let reader = ReputationReader::new(&env, oracle_contract_id);
let score = reader.corridor_score(anchor_id, corridor);
```

Source and full method list: [`crates/stellar-intel-reputation/README.md`](../crates/stellar-intel-reputation/README.md).
A runnable example consumer contract lives at
[`examples/consumer-contract/`](../examples/consumer-contract/).

## Today: call the HTTP API

Every capability the SDK will wrap is already reachable over HTTP. See
[`docs/COOKBOOK.md`](COOKBOOK.md) for runnable examples and
[`docs/INTENT_API.md`](INTENT_API.md) for the intent contract.

```ts
// Minimal typed fetch wrapper you can drop in today.
const BASE = 'https://stellar-intel.vercel.app';

export async function getRates(corridorId: string, amount: string) {
  const res = await fetch(`${BASE}/api/rates/${corridorId}?amount=${amount}`);
  if (!res.ok) throw new Error(`rates ${res.status}`);
  return res.json();
}

export async function getReputation(anchorId: string) {
  const res = await fetch(`${BASE}/api/reputation/${anchorId}`);
  if (!res.ok) throw new Error(`reputation ${res.status}`);
  return res.json();
}

export async function submitOfframpIntent(signedEnvelope: unknown) {
  const res = await fetch(`${BASE}/api/intent/offramp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(signedEnvelope),
  });
  if (!res.ok) throw new Error(`intent ${res.status}`);
  return res.json();
}
```

Types you can import from the repo today: `OfframpIntent`, `SignedIntentEnvelope`,
`IntentV1` ([`types/intent.ts`](../types/intent.ts)) and the reputation types
([`types/reputation.ts`](../types/reputation.ts)).

## Planned `@stellarintel/sdk` surface (v4)

- Typed wrappers for the rates, intent, and reputation APIs.
- React hooks (the app's `hooks/useAnchorRates.ts` is the reference pattern).
- A signing helper that builds → canonicalizes → hashes → signs an intent via a
  wallet adapter.
- Three reference integrations (web, agent, wallet).

When it ships, this document becomes the SDK reference; the HTTP recipes above
remain valid as the underlying transport.
