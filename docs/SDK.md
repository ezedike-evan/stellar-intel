# SDK

> **Status: built in-tree, not yet published.** All four SDKs exist in this
> repository; none is on a public registry yet (the registry scopes are
> unclaimed — see each package's README for the publishing steps):
>
> | Package                    | Language   | Path                                                                      |
> | -------------------------- | ---------- | ------------------------------------------------------------------------- |
> | `@stellarintel/sdk`        | TypeScript | [`packages/sdk/`](../packages/sdk/)                                       |
> | `stellarintel`             | Python     | [`packages/python-sdk/`](../packages/python-sdk/)                         |
> | `stellar-intel-client`     | Rust       | [`crates/stellar-intel-client/`](../crates/stellar-intel-client/)         |
> | `stellar-intel-reputation` | Rust       | [`crates/stellar-intel-reputation/`](../crates/stellar-intel-reputation/) |
>
> The MCP package ([`packages/mcp/`](../packages/mcp/), `@stellarintel/mcp`) is
> the agent-facing surface alongside them.

**Last reviewed:** 2026-09-25

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
# once published: stellar-intel-reputation = "0.3"
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

### Option 1: use the hosted API directly

No package installation is required. The hosted API is available at
`https://stellar-intel.vercel.app`:

```bash
curl -sS "https://stellar-intel.vercel.app/api/rates/usdc-ngn?amount=100"
```

### Option 2: install the Rust client from this repository

The HTTP client exists today, but is not yet published to crates.io. Add it as
a Git dependency:

```toml
[dependencies]
stellar-intel-client = { git = "https://github.com/ezedike-evan/stellar-intel", package = "stellar-intel-client" }
```

See [`crates/stellar-intel-client/README.md`](../crates/stellar-intel-client/README.md)
for usage, retries, and error handling.

### Option 3: drop in a typed fetch wrapper (TypeScript)

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

## Using `@stellarintel/sdk` from the repo

The TypeScript client is built at [`packages/sdk/`](../packages/sdk/)
(`0.1.0`) — typed wrappers for the rates, intent, and reputation APIs with
retries and idempotency keys on by default. It is not on npm yet (the
`@stellarintel` scope is unclaimed; `packages/sdk/README.md` documents the two
human publishing steps, after which a `sdk-v*` tag triggers
`.github/workflows/publish-npm-sdk.yml`). Until then, consume it from the
repository:

```bash
git clone https://github.com/ezedike-evan/stellar-intel
cd stellar-intel/packages/sdk && npm install && npm run build
# then, from your project:
npm install /path/to/stellar-intel/packages/sdk
```

```ts
import { StellarIntelClient } from '@stellarintel/sdk';

const client = new StellarIntelClient();
const { rates, bestRateId } = await client.getRates('usdc-ngn');
```

See [`packages/sdk/README.md`](../packages/sdk/README.md) for the full method
list, error handling, and the hardening contract. The HTTP recipes above
remain valid as the underlying transport.
