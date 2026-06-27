# Intent API

The off-ramp intent is the core primitive of Stellar Intel. A user expresses
_what_ they want — "withdraw this USDC to this corridor" — signs it with their
Stellar key, and the server verifies the signature before routing it. The user
never hands over a key; they sign a canonical payload.

Source of truth: [`types/intent.ts`](../types/intent.ts),
[`lib/intent/`](../lib/intent/), and the route
[`app/api/intent/offramp/route.ts`](../app/api/intent/offramp/route.ts).

## Payload — `OfframpIntent`

The inner object describing one off-ramp operation
(`OfframpIntentSchema` in `types/intent.ts`):

| Field        | Type   | Rule                                              |
| ------------ | ------ | ------------------------------------------------- |
| `anchorId`   | string | Non-empty; an id from `constants/anchors.ts`.     |
| `corridorId` | string | Non-empty; a corridor id (e.g. `usdc-ngn`).       |
| `amount`     | string | Positive decimal, ≤ 7 dp (`/^\d+(\.\d{1,7})?$/`). |
| `publicKey`  | string | Stellar public key (`G…`, 56 chars).              |

## Signed envelope — `SignedIntentEnvelope`

The wire format the server accepts (`SignedIntentEnvelopeSchema`). Construction:

1. **Canonicalize** the `intent` — keys sorted recursively, then `JSON.stringify`
   (see [`docs/CANONICAL_JSON.md`](CANONICAL_JSON.md) and `lib/intent/`).
2. **Hash** the canonical bytes — SHA-256 → `hash` (lowercase hex, 64 chars).
3. **Sign** the canonical JSON bytes — Ed25519 via Freighter → `signature` (base64).
4. Include the matching Stellar `publicKey` returned by Freighter.

```jsonc
{
  "intent": {
    "anchorId": "cowrie",
    "corridorId": "usdc-ngn",
    "amount": "100",
    "publicKey": "GAB…",
  },
  "hash": "<64-char lowercase hex sha-256 of canonical intent>",
  "signature": "<base64 ed25519 signature>",
  "publicKey": "GAB…",
}
```

The schema enforces `envelope.publicKey === intent.publicKey`. The server
recomputes the canonical hash and verifies the Ed25519 signature before doing any
routing — a forged or tampered intent is rejected at the boundary.

## Replay protection

`lib/intent/replay.ts` guards against a previously-signed envelope being
re-submitted. Treat each signed envelope as single-use.

## Endpoint

```
POST /api/intent/offramp
Content-Type: application/json

<SignedIntentEnvelope>
```

- **200** — signature verified, intent accepted for routing.
- **400** — schema validation failed (bad amount, key mismatch, malformed hash).
- **401/422** — signature did not verify, or a replay was detected.

```bash
curl -sX POST https://stellar-intel.vercel.app/api/intent/offramp \
  -H 'content-type: application/json' \
  -d @signed-intent.json
```

## `IntentV1` — canonical router primitive

`types/intent.ts` also exports `IntentV1Schema` / `IntentV1` (re-exported from
`lib/intent/schema.ts`), the richer canonical intent the router consumes. The
off-ramp envelope above is the v1 path wired into the UI today; `IntentV1` is the
shape the multi-anchor router (see [`docs/ROADMAP.md`](ROADMAP.md), Wave 1.2 /
v2.2) scores and splits across anchors.

## Related

- [`docs/CANONICAL_JSON.md`](CANONICAL_JSON.md) — the exact canonicalization rules.
- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — where the intent sits in the flow.
- [`docs/ANCHOR_REPUTATION.md`](ANCHOR_REPUTATION.md) — how outcomes feed scoring.
