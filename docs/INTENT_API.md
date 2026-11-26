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

## Slippage bounds

A withdrawal can carry a **floor**: the least the user agreed to receive. Stellar Intel
signs that floor into the intent, checks the anchor's settled amount against it when the
outcome is recorded, and keeps a public, hash-pinned record of every shortfall.

Source of truth: [`lib/reputation/slippage.ts`](../lib/reputation/slippage.ts) (evaluation),
[`slippage-detect.ts`](../lib/reputation/slippage-detect.ts),
[`slippage-evidence.ts`](../lib/reputation/slippage-evidence.ts),
[`slippage-verify.ts`](../lib/reputation/slippage-verify.ts) and
[`slippage-compliance.ts`](../lib/reputation/slippage-compliance.ts).

### The `minReceive` field (SLP002)

`minReceive` is a decimal string (`AMOUNT_PATTERN`, at most 40 characters) in the
**destination** currency, for example `"152000.00"` NGN. A missing, malformed or zero
floor means "no floor": the outcome is never judged for slippage. A floor is only
accepted on withdrawals (`direction: "withdraw"`); sending one with a deposit is a
**400**.

### Signing the floor into the outcome (SLP004)

When a user executes a rate in the web app, the floor is
`totalReceived × (1 − MIN_RECEIVE_TOLERANCE)` (2 %), rounded to two decimals. It is the
same floor the execute drawer enforces before payment. The app signs it with Freighter
as part of an `offramp-outcome` intent (`OutcomeIntentSchema`, strict):

```jsonc
{
  "type": "offramp-outcome",
  "sourceAsset": "USDC",
  "destinationAsset": "NGN",
  "amount": "100",
  "sender": "G…", // the signing wallet
  "recipient": "cowrie", // the anchor id
  "anchorId": "cowrie",
  "corridor": "usdc-ngn",
  "transactionId": "…", // the SEP-24 transaction id
  "minReceive": "152000.00",
}
```

`intentHash` is the [canonical hash](CANONICAL_JSON.md) of that object, and the
outcome's `signature` is the wallet's signature over `intentHash`. Without a floor, the
app signs the same intent without `minReceive` and sends no `outcomeIntent`, so the
append body is the same as before slippage bounds existed.

`POST /api/reputation/append` accepts `minReceive` and `outcomeIntent` and checks the
binding before anything is stored:

- `minReceive` without `outcomeIntent` → **400** (`minReceive must be covered by the signed outcomeIntent`);
- `outcomeIntent.minReceive`, `sender`, `anchorId` and `corridor` must equal the append
  body's `minReceive`, `publicKey`, `anchorId` and `corridor` → otherwise **400**;
- `hashIntent(outcomeIntent)` must equal `intentHash` → otherwise **400**
  (`outcomeIntent does not hash to intentHash`). Because the signature over `intentHash`
  is verified first, a floor the sender did not sign cannot be recorded.

### Detection on append (SLP008)

After the outcome row is inserted, the append route runs `detectSlippageBreach`. It
applies only to an **attested withdrawal** with a signer, and compares the row's
`deliveredAmount` (the reported `amountOut`) with `minReceive` in exact decimal
arithmetic (`evaluateSlippage`, 7 places, BigInt):

| Result           | When                                                            |
| ---------------- | --------------------------------------------------------------- |
| `not_applicable` | not `completed`, no usable floor, or no usable delivered amount |
| `met`            | `amountOut >= minReceive`                                       |
| `breach`         | `amountOut < minReceive`                                        |

On a breach, `shortfall = minReceive − amountOut` and
`shortfallBps = floor(shortfall × 10000 / minReceive)`. Evidence is built, hashed and
stored as a breach record with status `detected`. The 201 response gets a `slippage`
field: `not_applicable`, `met`, `breach`, or `unrecorded` if the breach could not be
written. A failure there never undoes the recorded outcome.

### Breach statuses and verification (SLP009)

| Status     | Meaning                                                                       |
| ---------- | ----------------------------------------------------------------------------- |
| `detected` | Recorded from the sender's report; not yet tied to a Stellar payment.         |
| `verified` | The Stellar payment was found on Horizon and written into `evidence.onChain`. |
| `rejected` | The payment could not be found; `rejectionReason` says why.                   |

The reconcile cron (`GET /api/reputation/reconcile`) runs `verifyDetectedBreaches`,
which takes up to 50 `detected` breaches per run. For each one it loads the outcome's
`stellarTransactionId` from Horizon and looks for a `payment`, `path_payment_strict_send`
or `path_payment_strict_receive` **from the signer in the corridor's source asset**.
Rejection reasons:

| `rejectionReason`        | Cause                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `no_stellar_transaction` | The outcome carries no `stellarTransactionId`.                                          |
| `transaction_not_found`  | Horizon answered **404** for the transaction.                                           |
| `transaction_failed`     | The transaction exists but `successful` is `false`.                                     |
| `payment_not_found`      | No payment from the signer in the corridor's source asset (or the corridor is unknown). |

Any other error, from Horizon or the store, leaves the breach `detected`, and the next run
tries it again. On `verified`, the evidence gains `onChain` and is hashed again, so
**`evidenceHash` changes on verification**. On `rejected`, the evidence and hash stay as
they were.

### The evidence object

Evidence is built field by field. It never spreads the outcome row or the intent, so the
recipient's bank or mobile number can never end up in it.

| Field                                | Type            | Notes                                                                                                                                                                                    |
| ------------------------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v`                                  | `1`             | Evidence format version.                                                                                                                                                                 |
| `networkPassphrase`                  | string          | Stellar network the payment was made on.                                                                                                                                                 |
| `intentHash`                         | string          | 64 lowercase hex characters.                                                                                                                                                             |
| `anchorId`, `corridor`               | string          | From the signed outcome.                                                                                                                                                                 |
| `signerAccount`                      | string          | The `G…` account that signed the outcome.                                                                                                                                                |
| `minReceive`                         | string          | The signed floor.                                                                                                                                                                        |
| `anchorReported.anchorTransactionId` | string \| null  | The SEP-24 transaction id from `outcomeIntent.transactionId`.                                                                                                                            |
| `anchorReported.amountOut`           | string          | The delivered amount the sender reported.                                                                                                                                                |
| `anchorReported.reportedBy`          | `"sender"`      | Always `sender` today; see [Trust model](#trust-model).                                                                                                                                  |
| `shortfall`, `shortfallBps`          | string, integer | As computed above.                                                                                                                                                                       |
| `onChain`                            | object \| null  | `null` until verified, then `txHash`, `ledger`, `closedAt`, `successful`, `from`, `to`, `assetCode` (`XLM` for native), `assetIssuer` (`null` for native), `amount`, `memoType`, `memo`. |
| `detectedAt`                         | string          | ISO 8601 time of detection.                                                                                                                                                              |

### Reproducing `evidenceHash`

`evidenceHash` uses the same canonicalisation as intents
([CANONICAL_JSON.md](CANONICAL_JSON.md)): sort object keys recursively → `JSON.stringify`
with no whitespace → SHA-256 → lowercase hex.

`GET /api/v1/slippage-breaches/{intentHash}` returns both `evidence` and
`canonicalEvidence`, the exact string that was hashed. To check a record independently:

```js
import { createHash } from 'node:crypto';

const sortKeys = (v) =>
  Array.isArray(v)
    ? v.map(sortKeys)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sortKeys(v[k])])
        )
      : v;

const res = await fetch(`https://stellar-intel.vercel.app/api/v1/slippage-breaches/${intentHash}`);
const body = await res.json();
const canonical = JSON.stringify(sortKeys(body.evidence));

console.assert(canonical === body.canonicalEvidence, 'canonical form differs');
const hash = createHash('sha256').update(canonical, 'utf8').digest('hex');
console.assert(hash === body.evidenceHash, 'evidenceHash does not match');
```

For a `verified` breach, also look up `evidence.onChain.txHash` on Horizon and check that
the payment matches.

### Public slippage routes (SLP010)

All three are versioned v1 routes (scope `quotes:read`, 60 requests per window).

| Route                                        | Returns                                                                                                                                                                      |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/slippage-breaches`              | `{ breaches: [...] }`, public summaries. Filters: `anchorId` (a known anchor), `status` (`detected` \| `verified` \| `rejected`), `limit` (1–500, default 100). Cached 60 s. |
| `GET /api/v1/slippage-breaches/{intentHash}` | One summary plus `evidence` and `canonicalEvidence`. **400** for a hash that is not 64 lowercase hex characters, **404** when there is no breach. Cached 300 s.              |
| `GET /api/v1/slippage-compliance`            | The compliance metric below. `window`: `30` (default), `90` or `all`. Cached 300 s.                                                                                          |

A summary has `intentHash`, `anchorId`, `corridor`, `minReceive`, `amountOut`,
`shortfall`, `shortfallBps`, `status`, `rejectionReason`, `stellarTransactionId`,
`evidenceHash`, `detectedAt` and `verifiedAt`. The list leaves out `signerAccount` and
`evidence`. The detail route includes `evidence` (and so `signerAccount`) so that the
hash can be reproduced. All three return **503** (`store_unavailable`) when a store is
not configured.

### Compliance metric and the v3 gate (SLP011 / SLP012)

```jsonc
{
  "window": 30,
  "eligibleIntents": 12840,
  "breaches": 31,
  "verifiedBreaches": 27,
  "compliancePct": 99.76,
  "gate": { "targetPct": 99.5, "minIntents": 10000, "met": true },
}
```

- **Eligible intent:** an attested, completed, undisputed withdrawal created inside the
  window that has both a `minReceive` and a `deliveredAmount`. A row whose date cannot be
  parsed is left out of every window, including `all`.
- **Breach:** a breach on an eligible intent that is not `rejected`. A breach that is
  still only `detected` already counts. Each intent counts at most once.
- `compliancePct = (eligibleIntents − breaches) / eligibleIntents × 100`, rounded to two
  decimals. It is `null` when nothing is eligible.
- **v3 gate:** `met` only when `compliancePct >= 99.5` **and** `eligibleIntents >= 10000`.
  A perfect score over a handful of intents does not meet it.

### Webhook: `intent.slippage_breach` (SLP014)

The append route emits this event when it detects a breach, after the outcome's own
events. Payload:

```jsonc
{
  "intentHash": "…",
  "anchorId": "cowrie",
  "corridor": "usdc-ngn",
  "minReceive": "152000.00",
  "amountOut": "150000.00",
  "shortfall": "2000",
  "shortfallBps": 131,
  "evidenceHash": "…",
  "status": "detected",
  "detectedAt": "2026-11-26T10:00:00.000Z",
}
```

`status` is always `detected`; verification does not send a second event. The idempotency
key is `intent.slippage_breach:{intentHash}`, so a subscriber sees one event per intent.
`signerAccount`, `evidence` and `anchorTransactionId` are not included; fetch the detail
route for them. Delivery and signing are covered in [WEBHOOKS.md](WEBHOOKS.md).

### Trust model

- **`amountOut` is reported by the sender.** It is the anchor's SEP-24/SEP-6
  `amount_out` as the sender's client read it from the anchor and sent it to the append
  route (`reportedBy: "sender"`). Stellar Intel does not fetch it from the anchor itself.
- **The floor and its binding are cryptographic.** `minReceive`, `sender`, `anchorId`,
  `corridor` and the anchor transaction id are covered by the sender's signature over
  `intentHash`, so nobody else can attach or change a floor.
- **Only the on-chain payment is verified independently.** The server checks on Horizon
  that the signer paid the corridor's source asset in a successful transaction.
  `verified` means "this payment happened", not "the anchor confirmed this `amountOut`".
- **Evidence is tamper-evident, not proof of fault.** Anyone can recompute
  `evidenceHash`, so a published record cannot be changed silently. Whether the anchor
  actually under-delivered still rests on the sender's report.

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

## On-ramp — `POST /api/v1/intent/onramp`

> **Status.** The `OnrampIntent` schema below is shipped
> (`OnrampIntentSchema` in [`types/intent.ts`](../types/intent.ts), re-exported
> from [`lib/intent/onramp-schema.ts`](../lib/intent/onramp-schema.ts)). The
> endpoint itself is **not live yet**; the request body is final, the response
> fields are the planned contract. The full deposit flow — preflight/trustline,
> SEP-10, interactive deposit, payment, tracking — is in
> [`docs/ONRAMP.md`](ONRAMP.md).

The on-ramp intent is the mirror image of the off-ramp intent: the user pays in
fiat and the anchor credits a Stellar asset. It is a distinct schema with
`type: "onramp"` (not a `CanonicalIntentV1` `kind`), and it carries the
Stellar `destination` that the anchor credits, which the off-ramp's free-form
`recipient` does not.

### Payload — `OnrampIntent`

| Field              | Type   | Required | Rule                                                                   |
| ------------------ | ------ | -------- | ---------------------------------------------------------------------- |
| `type`             | string | yes      | Literal `"onramp"` — the off-ramp discriminator is rejected.           |
| `sourceAsset`      | string | yes      | Non-empty; the fiat paid in (e.g. `NGN`).                              |
| `destinationAsset` | string | yes      | Non-empty; the Stellar asset bought (e.g. `USDC`).                     |
| `amount`           | string | yes      | Positive decimal string (`/^\d+(\.\d+)?$/`, `parseFloat > 0`).         |
| `sender`           | string | yes      | Non-empty; the fiat rail's reference (bank account, wallet, agent id). |
| `destination`      | string | yes      | Stellar public key (`G…`, 56 chars); rejects muxed `M…` accounts.      |
| `depositMethod`    | enum   | yes      | `bank_transfer`, `cash`, `mobile_money` or `card`.                     |
| `memo`             | string | no       | Non-empty when present; attributing memo for pooled-account anchors.   |
| `memoType`         | enum   | no       | `text`, `id` or `hash`; required together with `memo`.                 |

Memo rules (enforced by `superRefine`): `memo` and `memoType` must be supplied
together; a `text` memo must be at most 28 bytes once UTF-8 encoded; an `id`
memo must be an unsigned 64-bit integer; a `hash` memo must be 64 lowercase
hex characters. A `type` of `"offramp"` is rejected, as is a non-`G…`
`destination`.

```jsonc
// request
{
  "type": "onramp",
  "sourceAsset": "NGN",
  "destinationAsset": "USDC",
  "amount": "150000.00",
  "sender": "NG123456789012345678",
  "destination": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  "depositMethod": "bank_transfer",
}
// response (planned)
{
  "intentId": "onramp_intent_9a4f21",
  "status": "pending_trustline",
  "unsignedChangeTrustXdr": "AAAAAgAAAABn...",
  "handoffUrl": "https://cowrie.exchange/sep24/deposit?transaction_id=...",
  "createdAt": "2026-10-17T12:05:00Z",
}
```

The planned response returns a `handoffUrl` (the anchor's hosted SEP-24
deposit page) and, when the destination lacks a trustline for the asset, an
`unsignedChangeTrustXdr` for the user to sign. `unsignedChangeTrustXdr` is
`null` when no trustline change is needed. Neither field is produced today.

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
- [`docs/WEBHOOKS.md`](WEBHOOKS.md) — webhook delivery, including `intent.slippage_breach`.
- [`docs/ONRAMP.md`](ONRAMP.md) — the on-ramp flow and its planned endpoints.
- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — where the intent sits in the flow.
- [`docs/ANCHOR_REPUTATION.md`](ANCHOR_REPUTATION.md) — how outcomes feed scoring.
