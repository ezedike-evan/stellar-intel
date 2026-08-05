# @stellarintel/sdk

TypeScript client for the [Stellar Intel](https://github.com/ezedike-evan/stellar-intel)
API. Retries and idempotency keys are **on by default**, not opt-in.

> **Not yet published to npm.** The `@stellarintel` scope is unclaimed. See
> [Publishing](#publishing) — that is a human step, not a code one.

## Install

```bash
npm install @stellarintel/sdk
```

## A quote in a few lines

```ts
import { StellarIntelClient } from '@stellarintel/sdk';

const client = new StellarIntelClient();

const { rates, bestRateId } = await client.getRates('usdc-ngn');
const best = rates.find((r) => r.anchorId === bestRateId);

console.log(`${best?.anchorName}: ${best?.exchangeRate} NGN per USDC`);
```

## Submitting an off-ramp intent

`submitOfframpIntent` returns an **unsigned** transaction. Nothing moves until
you sign and submit it — the SDK never holds a key and never signs.

```ts
const { unsignedTx, quoteId, route } = await client.submitOfframpIntent({
  sourceAsset: 'USDC',
  destinationAsset: 'NGN',
  amount: '100',
  sender: 'GABC…',
  recipient: 'GDEF…',
});

// Sign `unsignedTx` with Freighter, a keypair, or your own signer, then submit.
```

## Retries and idempotency

Both are defaults, because the failure they prevent — a retried request
creating a second intent — is one a caller cannot see happening.

- **Retried:** `429`, `500`, `502`, `503`, `504`, and transport failures.
  Retried on **status code alone**: a 502 from an intermediary carries no error
  envelope but is exactly as transient as a 429 that does.
- **Not retried:** every other status. A `400` means the request was wrong;
  sending it again does not make it right.
- **Backoff:** `Retry-After` when the server sends it, otherwise
  `min(2^attempt × 500ms, 8s)`. The server knows when its window resets;
  guessing shorter just burns another request against the same limit.
- **Idempotency:** one fresh UUID per logical call, **reused across that call's
  own retries**. So a retry replays the original response
  (`Idempotency-Replayed: true`) instead of creating a second intent. Pass your
  own with `{ idempotencyKey }` if you need to control it.

```ts
const client = new StellarIntelClient({
  baseUrl: 'https://stellar-intel.vercel.app',
  maxRetries: 3,
  timeoutMs: 10_000,
});
```

## Errors

Three types, because they call for different handling:

| Error                       | Meaning                                                               |
| --------------------------- | --------------------------------------------------------------------- |
| `StellarIntelApiError`      | The API returned its envelope. Carries `code`, `requestId`, `status`. |
| `StellarIntelResponseError` | Non-2xx with no envelope — usually an intermediary. Carries `body`.   |
| `StellarIntelNetworkError`  | No response at all: transport failure, abort, timeout.                |

```ts
import { StellarIntelApiError } from '@stellarintel/sdk';

try {
  await client.submitOfframpIntent(intent);
} catch (err) {
  if (err instanceof StellarIntelApiError && err.code === 'NO_ROUTE') {
    // No anchor can serve this corridor right now.
  }
  throw err;
}
```

## API version pinning

Every request carries `API-Version`, pinned to the version this SDK release was
built against. That is deliberate: the server's supported-version list currently
holds one entry, so an unpinned client silently follows whatever ships. A pinned
one gets a `400` it can act on.

`tests/sdk-spec-sync.spec.ts` asserts the pin matches both the server constant
and the committed spec, so the three cannot drift apart.

## Why the types are hand-written

The obvious approach is generating them from `public/openapi.json`, and that was
the plan. `openapi-typescript@7` peers on **TypeScript ^5.x** and this repository
is on **TypeScript 6**, so adding it means `--legacy-peer-deps` and a generator
running against a compiler it does not claim to support.

Rather than force that, the wire types are hand-written and the **drift
protection is kept as a test**: `tests/sdk-spec-sync.spec.ts` asserts that every
operation this SDK calls exists in the committed spec, that the version pin
matches, and — the one that matters most — that **no `/api/v1` operation exists
in the spec without an SDK method**. A route rename or a new endpoint fails CI
here rather than at a consumer's runtime, which is the property generation was
wanted for.

Revisit when `openapi-typescript` supports TypeScript 6.

## A note on `getRates`

It calls the **unversioned** `/api/rates/{corridor}`. That is the only rate
comparison endpoint that exists; the `/api/v1` namespace does not mirror it yet.
Stated here rather than implied, because every other method on this client is
under `/api/v1` and inherits its hardening contract.

## Publishing

Not yet published. Two human steps, in order:

1. **Claim the `@stellarintel` npm scope.** It is unclaimed today — as are
   `@stellarintel/mcp`, PyPI `stellarintel`, and crates.io
   `stellar-intel-reputation`.
2. **Configure npm trusted publishing** for this repository, so
   `.github/workflows/publish-npm-sdk.yml` can publish with provenance via OIDC
   rather than a stored `NPM_TOKEN`.

Then push a `sdk-v*` tag.

## License

MIT
