# `@stellarintel/sdk` — SDK

> A typed TypeScript client for the Stellar Intel Intent API, the Soroban
> oracle, and canonical JSON + Ed25519 signing. The same package powers
> the web UI, the MCP server, and external integrators.

Status: **wave 2.3 / v2.x** — draft published; surface stable within v1,
minor additions continuing into v2.

---

## Table of contents

- [Install](#install)
- [Quick start](#quick-start)
- [Modules](#modules)
- [Recipes](#recipes)
  - [Quote → sign → submit](#quote--sign--submit)
  - [React hook: live rate table](#react-hook-live-rate-table)
  - [Read-only reputation](#read-only-reputation)
  - [Corridor-gated routing](#corridor-gated-routing)
- [Errors](#errors)
- [Version compatibility](#version-compatibility)

---

## Install

```bash
npm install @stellarintel/sdk @stellar/freighter-api
# optional peers for Soroban reads:
npm install @stellar/stellar-sdk
```

Tree-shakeable, ESM-first. A CJS build ships alongside for older tooling.

---

## Quick start

```ts
import { StellarIntel } from '@stellarintel/sdk';

const client = new StellarIntel({
  apiBase: 'https://stellar-intel.vercel.app/api/v1',
  network: 'mainnet',
});

const quotes = await client.offramp.quote({
  user: 'GD3Z…',
  sourceAsset: { code: 'USDC', issuer: 'GA5Z…' },
  sourceAmount: '100.00',
  targetAsset: { code: 'NGN' },
  country: 'NG',
});

console.log(quotes.routes[0].netLanded); // "141230.00"
```

---

## Modules

| Module          | What it does                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------------- |
| `StellarIntel`  | Top-level client. Bundles the three modules below.                                                 |
| `offramp`       | Off-ramp intents — quote, sign, submit, poll.                                                      |
| `onramp` _(v2)_ | On-ramp intents. Same shape as `offramp`.                                                          |
| `swap` _(v2)_   | Cross-asset swaps. Routes through Stellar DEX + Soroswap/Aquarius.                                 |
| `reputation`    | Read access to anchor TrustScores. Back-ends: oracle first, API fallback.                          |
| `canonical`     | Pure helpers: `canonicalize(intent)`, `hashIntent(intent)`.                                        |
| `signer`        | Adapters: `FreighterSigner`, `Sep10Signer`, `HwWalletSigner`. Implement `Signer` to roll your own. |
| `oracle`        | `OracleClient` — direct Soroban reads (`getScore`, `getScoresBatch`).                              |
| `types`         | Every shape. Re-export of the public type surface.                                                 |

Imports are designed to be ergonomic:

```ts
import { StellarIntel } from '@stellarintel/sdk';
import { hashIntent } from '@stellarintel/sdk/canonical';
import { OracleClient } from '@stellarintel/sdk/oracle';
import type { OfframpIntent } from '@stellarintel/sdk/types';
```

---

## Recipes

### Quote → sign → submit

```ts
import { StellarIntel, FreighterSigner } from '@stellarintel/sdk';

const client = new StellarIntel({ network: 'mainnet' });
const signer = new FreighterSigner();

const quote = await client.offramp.quote({
  user: await signer.publicKey(),
  sourceAsset: { code: 'USDC', issuer: 'GA5Z…' },
  sourceAmount: '100.00',
  targetAsset: { code: 'NGN' },
  country: 'NG',
});

const bestRoute = quote.routes[0];

const signed = await client.offramp.sign({
  intent: quote.intent, // server returns the canonicalised intent
  routeId: bestRoute.id,
  signer,
});

const submitted = await client.offramp.submit(signed);
window.location.href = submitted.interactiveUrl;
```

The `signer` is the only agent of trust. `FreighterSigner` forwards the
digest to the browser extension; the SDK never sees the secret key.

### React hook: live rate table

```tsx
import { useOfframpQuote } from '@stellarintel/sdk/react';

export function RateTable() {
  const { data, error, isLoading } = useOfframpQuote({
    sourceAsset: { code: 'USDC', issuer: 'GA5Z…' },
    sourceAmount: '100.00',
    targetAsset: { code: 'NGN' },
    country: 'NG',
    refreshMs: 30_000,
  });

  if (error) return <ErrorState error={error} />;
  if (isLoading || !data) return <Skeleton rows={5} />;

  return (
    <table>
      <tbody>
        {data.routes.map((r) => (
          <tr key={r.id}>
            <td>{r.anchorId}</td>
            <td>{r.netLanded}</td>
            <td>{r.trustScore.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

Under the hood the hook uses SWR with the fetcher the rest of the SDK
uses, so the cache is shared — multiple components rendering the same
corridor dedupe automatically.

### Read-only reputation

```ts
import { OracleClient } from '@stellarintel/sdk/oracle';

const oracle = new OracleClient({
  contractId: 'CA…',
  network: 'mainnet',
});

const top = await oracle.getScoresBatch(['cowrie', 'bitso', 'click']);
top
  .filter((a): a is NonNullable<typeof a> => a !== null)
  .sort((a, b) => b.trustScore - a.trustScore)
  .forEach((a) => console.log(a.anchorId, a.trustScore, a.confidence));
```

### Corridor-gated routing

```ts
async function bestReputableRoute(corridor) {
  const quotes = await client.offramp.quote(corridor);
  return quotes.routes.find((r) => r.trustScore >= 75 && r.confidence !== 'low');
}
```

Do not handroll reputation filters in component code. The SDK provides
the `routes` list already sorted by net landed value; composing a
reputation gate on top keeps callers terse.

---

## Errors

Every SDK method throws one of:

| Class                    | Retryable? | Notes                                                 |
| ------------------------ | ---------- | ----------------------------------------------------- |
| `ValidationError`        | no         | Your input failed schema. `.details` has the pointer. |
| `SignatureError`         | no         | Signer rejected or returned a malformed signature.    |
| `RouteStaleError`        | yes        | Quote expired — re-quote.                             |
| `RateDriftError`         | yes        | Anchor moved below your `minNetLanded`.               |
| `AnchorUnavailableError` | yes        | SEP-24 handshake failed. Pick another route.          |
| `RateLimitError`         | yes        | Back off per `retryAfter`.                            |
| `ServerError`            | yes        | Generic 5xx.                                          |

Retryable errors carry a `.retryable === true` flag so wrappers can
retry generically without a `switch`. The SDK does **not** retry on your
behalf — the caller decides the budget.

---

## Version compatibility

- SDK major aligns with Intent API major. `@stellarintel/sdk@1.x` speaks
  to `/api/v1`. A `v2` API release ships a `@stellarintel/sdk@2.0` in
  lockstep; the old SDK stays compatible with `/api/v1` indefinitely.
- Soroban oracle interface is versioned by contract ID, not by package
  version; the SDK accepts `contractId` explicitly so a single SDK
  version can talk to multiple oracle deployments (mainnet, testnet,
  forks).
- Browser baseline: evergreen. Node baseline: 20 LTS.
