# Intent API

**Last reviewed:** 2026-10-19

The off-ramp intent is the core primitive of Stellar Intel. A user expresses
_what_ they want — "withdraw this USDC to this corridor" — and MAY sign it with
their Stellar key. When a signature is supplied the server verifies it over the
canonical payload before routing; unsigned intents are still accepted (the
signature is an optional attestation, not a gate). The user never hands over a
key; they sign a canonical payload.

Source of truth: [`lib/intent/offramp.ts`](../lib/intent/offramp.ts),
[`types/intent.ts`](../types/intent.ts), [`lib/intent/`](../lib/intent/), and the route
[`app/api/intent/offramp/route.ts`](../app/api/intent/offramp/route.ts).

## Payload — `IntentSchema`

The off-ramp intent payload parsed by `POST /api/intent/offramp`.
Source of truth: `IntentSchema` in [`lib/intent/offramp.ts`](../lib/intent/offramp.ts).

| Field              | Type   | Rule                                                                                              |
| ------------------ | ------ | ------------------------------------------------------------------------------------------------- |
| `type`             | string | Literal `'offramp'`.                                                                              |
| `sourceAsset`      | string | Asset code being sold (min length 1, e.g. `"USDC"`).                                              |
| `destinationAsset` | string | Destination fiat/asset code being received (min length 1, e.g. `"NGN"`).                          |
| `amount`           | string | Positive decimal string matching `AMOUNT_PATTERN` from `lib/patterns.ts` (`/^\d+(\.\d{1,7})?$/`). |
| `sender`           | string | Originating Stellar address or account (min length 1).                                            |
| `recipient`        | string | Payout destination identifier (min length 1).                                                     |

Signed intents MAY also include the optional replay-protection fields:

- `nonce` (optional string): exactly 32 hex characters (`/^[0-9a-f]{32}$/i`), providing 128 bits of randomness.
- `deadline` (optional string): ISO 8601 datetime string (`z.iso.datetime()`).

Both fields are part of the canonical intent schema and covered by the signature when present.

## Signed envelope — Wire format

The route accepts a **flat JSON object** containing the intent fields above, plus optional top-level `signature` and `publicKey` attestation fields. Both attestation fields must be supplied together:

| Field       | Type   | Rule                                                            |
| ----------- | ------ | --------------------------------------------------------------- |
| `signature` | string | Optional base64-encoded Ed25519 signature over the intent hash. |
| `publicKey` | string | Optional Stellar public key (`G…`, 56 chars).                   |

### Construction

1. **Canonicalize** the intent — sort keys recursively, then serialize with `canonicalJson` (in [`lib/intent/hash.ts`](../lib/intent/hash.ts); see [`docs/CANONICAL_JSON.md`](CANONICAL_JSON.md)).
2. **Hash** the canonical JSON bytes — compute SHA-256 via `hashIntent` ([`lib/intent/hash.ts`](../lib/intent/hash.ts)) to produce `intentHash` (a 64-character lowercase hex string).
3. **Sign** the hex hash — sign the hex string via Freighter's `signMessage` ([`lib/intent/sign.ts`](../lib/intent/sign.ts)), which returns a base64 signature and the signer's public key.
4. **Submit** the flat payload containing the intent fields together with `signature` and `publicKey`.

### Verification

On the server, `verifyOptionalIntentAttestation` in [`lib/intent/verify.ts`](../lib/intent/verify.ts) reads `signature` and `publicKey` off the root of the raw request body:

- If neither is provided, the intent is accepted as an unattested intent (`attested: false`).
- If only one is provided, the request is rejected with **400** (`VALIDATION_ERROR`).
- If both are present, the server recalculates `hashIntent(intent)` and calls `verifyIntentSignature`:
  - It decodes the 64-char hex hash into raw bytes (`Buffer.from(intentHash, 'hex')`) and verifies the Ed25519 signature (`keypair.verify(messageBytes, sigBytes)`).
  - It also accepts SEP-53 domain-separated messages (`keypair.verifyMessage(intentHash, sigBytes)`), matching Freighter's `signMessage`.
  - If neither verifies, the request is rejected with **401** (`UNAUTHORIZED`).

```jsonc
{
  "type": "offramp",
  "sourceAsset": "USDC",
  "destinationAsset": "NGN",
  "amount": "100.00",
  "sender": "GBBD67IFNZMSW54QOX7SZOCBWW5HDKG54G7QOWPHNHOC4YDTQG2Z4O2U",
  "recipient": "08012345678",
  "nonce": "a1b2c3d4e5f60718293a4b5c6d7e8f90",
  "deadline": "2026-10-19T12:00:00Z",
  "signature": "<base64 ed25519 signature>",
  "publicKey": "GBBD67IFNZMSW54QOX7SZOCBWW5HDKG54G7QOWPHNHOC4YDTQG2Z4O2U",
}
```

## Replay protection

`lib/intent/replay.ts` (`registerIntentReplay`) implements nonce + deadline
replay protection and is enforced on every **signed** off-ramp intent, on both
`POST /api/intent/offramp` and `POST /api/v1/intent/offramp`.

A signed intent (one that supplied a verified `signature` + `publicKey`) MUST
also include `nonce` (32 lowercase hex characters — 128 bits of randomness) and
`deadline` (RFC 3339 datetime). Both fields are part of the canonical intent, so
they are covered by the signature. After the signature verifies:

- if `nonce` or `deadline` is missing, the request is rejected with **400**
  (`VALIDATION_ERROR` / `validation_error`);
- otherwise the pair is registered with `registerIntentReplay({ publicKey, nonce, deadline })`:
  - a `nonce` already seen for that `publicKey` is rejected with **409**
    (`REPLAY_DETECTED` / `replay_detected`);
  - a `deadline` that has already passed is rejected with **410**
    (`DEADLINE_EXPIRED` / `deadline_expired`).

**Unsigned** intents are unaffected: `nonce` and `deadline` are optional and, if
omitted, the intent still routes normally — it is not replay-checked. This
mirrors the off-ramp path's existing idempotency (`quoteId = sha256(canonical
intent)`, honoured by `Idempotency-Key`), which continues to apply independently
of replay protection.

## Endpoint

```http
POST /api/intent/offramp
Content-Type: application/json
Idempotency-Key: <optional-unique-string>
```

Request body:

```jsonc
{
  "type": "offramp",
  "sourceAsset": "USDC",
  "destinationAsset": "NGN",
  "amount": "100.00",
  "sender": "GBBD67IFNZMSW54QOX7SZOCBWW5HDKG54G7QOWPHNHOC4YDTQG2Z4O2U",
  "recipient": "08012345678",
}
```

- **200** — intent accepted for routing (signature verified when one was supplied).
- **400** — schema validation failed, only one of `signature`/`publicKey` was supplied,
  or a signed intent omitted `nonce`/`deadline`.
- **401** — a supplied signature did not verify.
- **409** — the signed intent's `nonce` has already been used for that `publicKey`.
- **410** — the signed intent's `deadline` has already passed.

Header:

- `Idempotency-Key` (optional string): When provided, repeated requests with the same key return the cached idempotent response (`lib/api/idempotency.ts`).

```bash
curl -sX POST https://stellar-intel.vercel.app/api/intent/offramp \
  -H 'content-type: application/json' \
  -H 'Idempotency-Key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d' \
  -d '{
    "type": "offramp",
    "sourceAsset": "USDC",
    "destinationAsset": "NGN",
    "amount": "100.00",
    "sender": "GBBD67IFNZMSW54QOX7SZOCBWW5HDKG54G7QOWPHNHOC4YDTQG2Z4O2U",
    "recipient": "08012345678"
  }'
```

## `IntentV1` — canonical router primitive

`types/intent.ts` also exports `IntentV1Schema` / `IntentV1` (re-exported from
`lib/intent/schema.ts`), the richer canonical intent the router consumes. The
off-ramp envelope above is the v1 path wired into the UI today; `IntentV1` is the
shape the multi-anchor router (see [Wave 1.2 — Router + Seeds](ROADMAP.md#wave-12--router--seeds))
scores and splits across anchors.

## Canonical Intent V1 — type definitions (not accepted by `/api/intent/offramp`)

`CanonicalIntentV1Schema` and its related schemas are defined in `types/intent.ts`
and re-exported from `lib/intent/schema.ts` for router and SDK use. They are not
accepted by `POST /api/intent/offramp`, which accepts only the flat `IntentSchema`
shape documented above. Sending `kind` without `type: "offramp"` to this endpoint
returns 400 `VALIDATION_ERROR`.

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

Represents a single off-ramp using the common fields, with `kind` set to `"offramp"`.

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

Represents a payment that repeats on a cron schedule.

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
