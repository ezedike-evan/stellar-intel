# Cookbook

> End-to-end recipes. Copy a block, change the inputs, ship something.
> Every recipe is runnable — the first five work today against the public
> deployment; the last five target v2 scope and are labelled accordingly.

---

## Table of contents

1. [Off-ramp $100 USDC → NGN](#1-off-ramp-100-usdc--ngn)
2. [Embed the widget](#2-embed-the-widget)
3. [Read a TrustScore from TypeScript](#3-read-a-trustscore-from-typescript)
4. [Compare three anchors for a corridor](#4-compare-three-anchors-for-a-corridor)
5. [Agent off-ramp via MCP](#5-agent-off-ramp-via-mcp)
6. [Consume the oracle from a Soroban contract _(v2)_](#6-consume-the-oracle-from-a-soroban-contract-v2)
7. [On-ramp NGN → USDC _(v2)_](#7-on-ramp-ngn--usdc-v2)
8. [Multi-anchor split routing _(v2)_](#8-multi-anchor-split-routing-v2)
9. [Build a per-wallet scorecard badge _(v2)_](#9-build-a-per-wallet-scorecard-badge-v2)
10. [Reputation-gated treasury payout _(v2)_](#10-reputation-gated-treasury-payout-v2)

---

## 1. Off-ramp $100 USDC → NGN

End-to-end: quote, sign with Freighter, submit, hand off the SEP-24
interactive URL, poll until fulfilled.

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
  beneficiary: {
    kind: 'bank-account',
    country: 'NG',
    bankCode: '058',
    accountNumber: '0123456789',
    accountName: 'Adaora Nnamdi',
  },
  minNetLanded: '140500.00',
});

const best = quote.routes[0];
const sign = await client.offramp.sign({ intent: quote.intent, routeId: best.id, signer });
const sub = await client.offramp.submit(sign);

window.location.href = sub.interactiveUrl; // KYC + anchor finalisation

const final = await client.offramp.poll(sub.intentHash, { timeoutMs: 10 * 60_000 });
console.log(final.state, final.txHash); // 'fulfilled', 'a91b…'
```

Running this against the staging deployment and the testnet anchor set:
`$ npm run example:offramp`.

---

## 2. Embed the widget

Drop an iframe into a third-party site — the user signs from their own
Freighter and Stellar Intel handles routing.

```html
<iframe
  src="https://stellar-intel.vercel.app/widget/offramp?asset=USDC&country=NG&amount=100"
  title="Send USDC to a Nigerian bank account"
  width="420"
  height="680"
  style="border:0; border-radius:12px; box-shadow:0 1px 8px rgba(0,0,0,.08)"
  allow="clipboard-read; clipboard-write"
  referrerpolicy="no-referrer"
></iframe>
```

`postMessage` events fired back to the parent:

- `stellarintel:quote-ready` — rates displayed.
- `stellarintel:intent-signed` — user signed.
- `stellarintel:intent-fulfilled` — terminal success.
- `stellarintel:intent-failed` — terminal failure with `reason`.

Styling: CSS custom properties `--si-radius`, `--si-accent`, `--si-bg`
are honoured when set on the iframe element.

---

## 3. Read a TrustScore from TypeScript

Direct Soroban read, zero fees.

```ts
import { OracleClient } from '@stellarintel/sdk/oracle';

const oracle = new OracleClient({
  contractId: 'CA…', // see docs/DEPLOYMENTS.md
  network: 'mainnet',
});

const cowrie = await oracle.getScore('cowrie');
if (!cowrie) throw new Error('unknown anchor');
console.log(`${cowrie.anchorId}: ${cowrie.trustScore} (${cowrie.confidence})`);
```

Run once a minute is fine; reads are cached per-SDK-instance for 30
seconds with `stale-while-revalidate`.

---

## 4. Compare three anchors for a corridor

Batch read + net landed delta.

```ts
const [rep, quote] = await Promise.all([
  oracle.getScoresBatch(['cowrie', 'bitso', 'click']),
  client.offramp.quote({
    sourceAsset,
    sourceAmount: '100.00',
    targetAsset: { code: 'NGN' },
    country: 'NG',
  }),
]);

const byAnchor = Object.fromEntries(rep.filter(Boolean).map((r) => [r.anchorId, r]));

for (const route of quote.routes) {
  const r = byAnchor[route.anchorId];
  console.log(
    route.anchorId.padEnd(8),
    'net:',
    route.netLanded.padStart(12),
    'trust:',
    r?.trustScore ?? '—',
    'conf:',
    r?.confidence ?? '—'
  );
}
```

---

## 5. Agent off-ramp via MCP

The same sequence of tools an AI agent walks. You can run this from
Claude Code after `claude mcp add stellar-intel -- npx -y @stellarintel/mcp`.

```
> List anchors serving USDC→NGN, top three by TrustScore.
  [agent: stellar_intel.list_anchors country=NG pair=USDC_NGN]

> Price off-ramping 100 USDC on the highest-ranked anchor.
  [agent: stellar_intel.price_offramp ...]

> If the net landed value is above 140500 NGN, sign and submit. Otherwise stop.
  [agent: stellar_intel.sign_intent → stellar_intel.submit_intent]

> Hand me the interactive URL, then poll every 15 seconds until the
  intent is in a terminal state and tell me the result.
```

Agent safety notes in [`docs/MCP.md § Agent safety`](MCP.md#agent-safety-notes).

---

## 6. Consume the oracle from a Soroban contract _(v2)_

Price-gate any swap on anchor reputation.

```rust
#![no_std]
use soroban_sdk::{contract, contractimpl, Address, Env, Symbol};

mod oracle {
    soroban_sdk::contractimport!(file = "stellar_intel_oracle.wasm");
}

const MIN: u32 = 7500; // 75.00 TrustScore

#[contract]
pub struct ReputableSwap;

#[contractimpl]
impl ReputableSwap {
    pub fn swap(env: Env, oracle_id: Address, anchor: Symbol) {
        let client = oracle::Client::new(&env, &oracle_id);
        let s = client.get_score(&anchor).expect("unknown anchor");
        assert!(s.trust_score >= MIN, "below reputation floor");
        // …proceed…
    }
}
```

Full contract example (deployable, with tests) ships alongside the
oracle release at `examples/reputable-swap/`.

---

## 7. On-ramp NGN → USDC _(v2)_

Mirror of recipe 1 — user deposits local currency at the anchor,
receives USDC.

```ts
const quote = await client.onramp.quote({
  user: await signer.publicKey(),
  sourceAsset: { code: 'NGN' },
  sourceAmount: '141000.00',
  targetAsset: { code: 'USDC', issuer: 'GA5Z…' },
  country: 'NG',
});
// …same sign/submit/poll sequence as recipe 1…
```

---

## 8. Multi-anchor split routing _(v2)_

The router determines when splitting across two anchors beats the
best single-anchor quote, and returns a ranked list of split plans.

```ts
const quote = await client.offramp.quote({
  sourceAsset,
  sourceAmount: '10000.00', // large enough to exhaust top anchor's liquidity
  targetAsset: { code: 'NGN' },
  country: 'NG',
  splitting: 'auto', // default: 'single' until v2
});

// quote.routes[0].legs === [{ anchorId: 'cowrie', amount: '6000' },
//                           { anchorId: 'bitso',  amount: '4000' }]
```

The UI surfaces the split plan explicitly; the user signs a single
intent that the router fans out to the two anchors, committing only
when both legs quote fresh.

---

## 9. Build a per-wallet scorecard badge _(v2)_

A small React component that shows the TrustScore of the anchor behind
a given `txHash`.

```tsx
import { useTxAnchor, useAnchorScore } from '@stellarintel/sdk/react';

export function ScorecardBadge({ txHash }: { txHash: string }) {
  const { anchorId } = useTxAnchor(txHash);
  const { score } = useAnchorScore(anchorId);
  if (!score) return null;
  return (
    <span className="badge" data-confidence={score.confidence}>
      {anchorId}: {score.trustScore.toFixed(0)}
    </span>
  );
}
```

---

## 10. Reputation-gated treasury payout _(v2)_

A CLI script a treasury ops engineer can drop into their payout pipeline
to refuse any route below a score floor.

```ts
#!/usr/bin/env node
import { StellarIntel } from '@stellarintel/sdk';

const FLOOR = 80;
const client = new StellarIntel({ network: 'mainnet' });

for (const payout of readPayoutCSV(process.argv[2])) {
  const quote = await client.offramp.quote(payout);
  const best = quote.routes.find((r) => r.trustScore >= FLOOR);
  if (!best) {
    console.error(`SKIP ${payout.beneficiary.accountNumber}: no route ≥ ${FLOOR}`);
    continue;
  }
  // queue the intent for the signing bridge…
}
```

Pair with `scripts/protect-main.sh` style hygiene for the signing key
(HSM in prod, never in `.env`).
