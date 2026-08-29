# Intent API

**Last reviewed:** 2026-08-26

The off-ramp intent is the core primitive of Stellar Intel. A user expresses
_what_ they want — "withdraw this USDC to this corridor" — and MAY sign it with
their Stellar key. When a signature is supplied the server verifies it over the
canonical payload before routing; unsigned intents are still accepted (the
signature is an optional attestation, not a gate). The user never hands over a
key; they sign a canonical payload.

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

When a `signature` + `publicKey` are supplied, the server recomputes the
canonical hash and verifies the Ed25519 signature (`lib/intent/verify.ts`,
`verifyOptionalIntentAttestation`) before routing — a forged or tampered signed
intent is rejected at the boundary (401). Supplying only one of the two is a 400.
Omitting both is allowed and routes the intent unattested.

## Replay protection

`lib/intent/replay.ts` (`registerIntentReplay`) implements nonce + deadline
replay protection and is available for callers that maintain a nonce. It is
**not yet wired into `POST /api/intent/offramp`** — the off-ramp path is instead
idempotent by construction (`quoteId = sha256(canonical intent)`, honoured by
`Idempotency-Key`). Wiring replay into the signed path is tracked as follow-up
work; until then, do not rely on the endpoint to reject a re-submitted envelope.

## Endpoint

```http
POST /api/intent/offramp
Content-Type: application/json

<SignedIntentEnvelope>
```

- **200** — intent accepted for routing (signature verified when one was supplied).
- **400** — schema validation failed, or only one of `signature`/`publicKey` was supplied.
- **401** — a supplied signature did not verify.

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

## Canonical Intent V1 — versioned superset

`CanonicalIntentV1Schema` in `types/intent.ts` is the **versioned superset** that
covers all intent kinds in one discriminated union. It is what `POST /api/intent/offramp`
parses after #817. Off-ramp-only clients that omit `kind` are accepted unchanged; the
endpoint injects `kind: "offramp"` automatically.

### Common fields (all kinds)

| Field              | Type           | Description                                            |
| ------------------ | -------------- | ------------------------------------------------------ |
| `schemaVersion`    | `1` (literal)  | Schema version. Defaults to `1` when omitted.          |
| `kind`             | see below      | Discriminant: `"offramp"`, `"chained"`, `"recurring"`. |
| `sourceAsset`      | string         | Asset code being sold (e.g. `"USDC"`).                 |
| `destinationAsset` | string         | Asset or fiat code being received (e.g. `"NGN"`).      |
| `amount`           | decimal string | Sell amount; positive, up to 7 decimal places.         |
| `sender`           | string         | Stellar public key of the originating account.         |
| `recipient`        | string         | Destination address or account for the payout.         |

### `kind: "offramp"` (single off-ramp)

Backwards-compatible with legacy clients that send `type: "offramp"` or omit `kind`.
No additional fields beyond the common base.

```jsonc
{
  "schemaVersion": 1,
  "kind": "offramp",
  "sourceAsset": "USDC",
  "destinationAsset": "NGN",
  "amount": "100.00",
  "sender": "GAB...",
  "recipient": "0800-123-456",
}
```

### `kind: "chained"` (multi-hop)

Expresses a sequence of atomic swaps: on-ramp, swap, or yield. Asset continuity
across hops is validated by the solver before execution. Requires at least 2 hops.

Additional field:

| Field  | Type    | Description                                        |
| ------ | ------- | -------------------------------------------------- |
| `hops` | `Hop[]` | Ordered list of hops (minimum 2). See `IntentHop`. |

Each `IntentHop`:

| Field        | Type                             | Description                                 |
| ------------ | -------------------------------- | ------------------------------------------- |
| `kind`       | `"on-ramp"`, `"swap"`, `"yield"` | Executor category for this hop.             |
| `sellAsset`  | `{ code, issuer? }`              | Asset sold going into this hop.             |
| `buyAsset`   | `{ code, issuer? }`              | Asset received out of this hop.             |
| `minReceive` | decimal string                   | Floor on the amount received from this hop. |

```jsonc
{
  "schemaVersion": 1,
  "kind": "chained",
  "sourceAsset": "XLM",
  "destinationAsset": "NGN",
  "amount": "500.00",
  "sender": "GAB...",
  "recipient": "0800-123-456",
  "hops": [
    {
      "kind": "on-ramp",
      "sellAsset": { "code": "XLM" },
      "buyAsset": { "code": "USDC", "issuer": "GA5..." },
      "minReceive": "14.5",
    },
    {
      "kind": "swap",
      "sellAsset": { "code": "USDC", "issuer": "GA5..." },
      "buyAsset": { "code": "NGN" },
      "minReceive": "11000",
    },
  ],
}
```

### `kind: "recurring"` (scheduled)

Repeats a payment on a cron schedule. The endpoint will reject this kind with
`501 NOT_IMPLEMENTED` until the scheduler service is wired up.

Additional field:

| Field      | Type             | Description                                                |
| ---------- | ---------------- | ---------------------------------------------------------- |
| `schedule` | `IntentSchedule` | POSIX cron expression and optional termination conditions. |

`IntentSchedule` fields:

| Field   | Type    | Description                                                   |
| ------- | ------- | ------------------------------------------------------------- |
| `cron`  | string  | 5-field POSIX cron expression (e.g. `"0 9 * * 1"` = Mondays). |
| `count` | integer | Optional: cancel after this many executions.                  |
| `until` | RFC3339 | Optional: cancel after this timestamp.                        |

```jsonc
{
  "schemaVersion": 1,
  "kind": "recurring",
  "sourceAsset": "USDC",
  "destinationAsset": "NGN",
  "amount": "100.00",
  "sender": "GAB...",
  "recipient": "0800-123-456",
  "schedule": {
    "cron": "0 9 * * 1",
    "count": 12,
  },
}
```

## Related

- [`docs/CANONICAL_JSON.md`](CANONICAL_JSON.md) — the exact canonicalization rules.
- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — where the intent sits in the flow.
- [`docs/ANCHOR_REPUTATION.md`](ANCHOR_REPUTATION.md) — how outcomes feed scoring.
