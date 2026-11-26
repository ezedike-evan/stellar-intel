# Standing Orders & Recurring Intents

**Last reviewed:** 2026-11-26

Stellar Intel supports standing orders for recurring remittance and scheduled payouts. A user signs a standing authorization once with Freighter to define the bounds of future payments (cadence, per-period cap, anchor allowlist, and expiration). Because standard Stellar wallets do not currently support automated pre-authorized execution without user presence, each due payment generates a reminder and requires exactly one signature to confirm and execute.

---

## 1. Feature Flag & Status

Recurring intents are flag-gated and **off by default** in production:

- Governed by `flags.recurringIntents` in `lib/flags.ts` (environment variable `NEXT_PUBLIC_RECURRING_INTENTS=on`).
- When disabled, recurring routes return `404 Not Found`.
- When enabled, it activates `/api/recurring/*` and the due-payment banner on `/offramp`. A dedicated `/recurring` management page is not built yet.

---

## 2. Why There Is No Auto-Execution

Mainstream Stellar wallets (including Freighter) do not yet expose a non-custodial wallet pre-authorization primitive or custom account contract signer policy UI. Without an upstream wallet standard for pre-authorization, a server cannot hold funds or sign transactions on the user's behalf without custodial custody or held credentials.

Stellar Intel implements a pragmatic, fully non-custodial model:

1. **One signed standing authorization** defines the approved corridor, amount, cadence, allowlisted anchors, and per-period spending cap.
2. **The server tracks schedules and enforces limits** deterministically.
3. **One user signature** confirms each payment when it becomes due.

---

## 3. Standing Authorization Model

A standing authorization is created by signing a `StandingAuthorizationTerms` payload with Ed25519:

```typescript
export interface StandingAuthorizationTerms {
  type: 'recurring-authorization';
  version: 1;
  sender: string; // Stellar G... public key of the sender
  corridorId: string; // Lowercase corridor (e.g. "usdc-ngn")
  sourceAsset: string; // Asset code (e.g. "USDC")
  destinationAsset: string; // Target fiat/asset (e.g. "NGN")
  amount: string; // Target payment amount per cycle
  perPeriodCap: string; // Maximum cumulative amount allowed in a single period
  period: 'daily' | 'weekly' | 'biweekly' | 'monthly'; // Recurrence period
  startAt: string; // ISO 8601 start timestamp
  stopAt: string; // ISO 8601 hard expiration timestamp
  anchorAllowlist: string[]; // List of approved anchor IDs (1 to 10 anchors)
  nonce: string; // 32-character hex nonce for replay protection
}
```

The signed payload submitted to `POST /api/recurring` wraps these terms with:

- `terms`: The `StandingAuthorizationTerms` object.
- `termsHash`: 64-character hex SHA-256 hash of canonical JSON-encoded terms.
- `signature`: Base64-encoded Ed25519 signature over the terms hash.
- `publicKey`: The signer's Stellar public key (must match `terms.sender`).

---

## 4. Server-Side Limit & Constraint Enforcement

Whenever an execution is evaluated or attempted against an authorization, the server checks the terms against previous executions in the period window:

| Code                     | Cause                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `not_started`            | Current timestamp is prior to `startAt`.                                                             |
| `stop_date_passed`       | Current timestamp is at or after `stopAt`.                                                           |
| `authorization_inactive` | Authorization status is `paused` or `cancelled`.                                                     |
| `corridor_mismatch`      | Proposed payment corridor differs from `corridorId`.                                                 |
| `asset_mismatch`         | Proposed source or destination asset does not match the terms.                                       |
| `anchor_not_allowed`     | Proposed anchor ID is not present in `anchorAllowlist`.                                              |
| `period_cap_exceeded`    | Cumulative confirmed payments in the current period plus the proposed amount exceeds `perPeriodCap`. |

---

## 5. Due Reminders and Authorization Phases

The state of a standing authorization transitions through discrete phases based on schedule and execution history:

- `scheduled`: Current time is before `startAt`.
- `due`: The current period is active, has remaining cap, and has not yet been executed. A `DueReminder` is generated.
- `confirmed_this_period`: Payment for the current period has already been executed.
- `cap_reached`: The cumulative spend for the current period has reached `perPeriodCap`.
- `paused`: The standing order was temporarily paused by the sender.
- `cancelled`: The standing order was permanently cancelled by the sender.
- `completed`: The schedule has ended (`stopAt` reached or passed).

---

## 6. Confirming Payments (One Signature)

When an authorization is `due`, the banner on `/offramp` shows a reminder for each standing order this browser created, and links to `/offramp` prefilled with the corridor, the amount, the order id and the cycle. Confirming the cycle:

1. The rate table is limited to the order's `anchorAllowlist`, and an amount above the remaining per-period cap is refused before any signing.
2. The user signs the off-ramp intent in Freighter. In recurring mode the intent also names `recurringAuthorizationId` and `cycleNumber`.
3. The client posts that signed intent to `POST /api/recurring/{id}/executions`, which records the cycle after the server re-checks the signature, the due cycle and the limits above.

---

## 7. Pausing, Resuming, and Cancelling (Control Messages)

Only the account that signed the authorization (`sender`) may modify its status. Status changes require a signed `RecurringControl` message to prevent spoofing and unauthorized tampering:

```typescript
export interface RecurringControl {
  type: 'recurring-control';
  action: 'pause' | 'resume' | 'cancel';
  authorizationId: string; // UUID of the standing authorization
  sender: string; // Stellar public key of the sender
  sourceAsset: string; // Must match authorization terms
  destinationAsset: string; // Must match authorization terms
  amount: string; // Must match authorization terms
  nonce: string; // 32-character hex replay nonce
  deadline: string; // ISO 8601 deadline for submission
}
```

### State Transitions

- **`pause`**: Transitions an `active` order to `paused`. Paused orders produce no due reminders and cannot execute.
- **`resume`**: Transitions a `paused` order back to `active`.
- **`cancel`**: Transitions an `active` or `paused` order to `cancelled`. Cancellation is permanent and cannot be undone.

Any other transition (e.g., resuming a cancelled order or pausing an already completed order) is rejected with `409 INVALID_TRANSITION`.

---

## 8. HTTP API Reference

All routes require `flags.recurringIntents` to be enabled; otherwise they return `404 Not Found`.

### `POST /api/recurring`

Registers a new standing authorization. The request body is the signed authorization itself.

- **Body:** `SignedStandingAuthorization`: `{ terms, termsHash, signature, publicKey }`
- **Response (201):** `{ id, termsHash, state }`. `id` is a random UUID that only the creator learns; keep it, because there is no listing endpoint.
- **Errors:**
  - `400 INVALID_JSON`: the body is not JSON.
  - `400 VALIDATION_ERROR`: the body fails the schema.
  - `401 UNAUTHORIZED`: the terms do not hash to `termsHash`, or the signature does not verify.
  - `422` with the policy code upper-cased: `UNKNOWN_CORRIDOR`, `ANCHOR_NOT_IN_CORRIDOR`, `AMOUNT_EXCEEDS_CAP`, `STOP_IN_PAST`, `START_TOO_OLD`, `WINDOW_TOO_LONG`.
  - `409 DUPLICATE_AUTHORIZATION`: the same signed terms were already registered.
  - `429 RATE_LIMITED`.

### `GET /api/recurring/{id}`

Retrieves a standing authorization with its current state and execution history. The signature is never returned.

- **Response (200):** `{ id, termsHash, terms, status, state, executions }`
- **Errors:** `404 NOT_FOUND` for a malformed or unknown id. `429 RATE_LIMITED`.

### `GET /api/recurring/due`

Returns the due reminders for authorization ids the caller already holds. There is deliberately no lookup by wallet.

- **Query:** `?ids=<uuid>,<uuid>` (at most 20)
- **Response (200):** `{ reminders: DueReminder[] }`. Only orders whose phase is `due` are returned; unknown ids are skipped.
- **Errors:** `400 VALIDATION_ERROR` when `ids` is missing, has more than 20 entries or contains a non-UUID. `429 RATE_LIMITED`.

### `POST /api/recurring/{id}/control`

Applies a signed control message (`pause`, `resume`, or `cancel`).

- **Body:**
  ```json
  {
    "control": {
      "type": "recurring-control",
      "action": "pause",
      "authorizationId": "6c42a2d4-...",
      "sender": "GA5Z...",
      "sourceAsset": "USDC",
      "destinationAsset": "NGN",
      "amount": "100",
      "nonce": "c9a2f7...",
      "deadline": "2026-11-22T17:00:00.000Z"
    },
    "signature": "base64...",
    "publicKey": "GA5Z..."
  }
  ```
- **Response (200):**
  ```json
  {
    "id": "6c42a2d4-...",
    "status": "paused",
    "state": { "phase": "paused", "due": null, "nextDueAt": null, "missedPeriods": 0 }
  }
  ```
- **Errors:**
  - `400 VALIDATION_ERROR`: Malformed body or schema mismatch.
  - `401 UNAUTHORIZED`: Invalid signature over control hash.
  - `403 FORBIDDEN`: Mismatch between signer, path ID, or terms.
  - `404 NOT_FOUND`: Unknown authorization ID or feature flag disabled.
  - `409 INVALID_TRANSITION`: Transition not allowed or order is already completed.
  - `409 REPLAY_DETECTED`: Nonce has already been used.
  - `410 DEADLINE_EXPIRED`: Control deadline is in the past.
  - `429 RATE_LIMITED`: Exceeded rate limit (20 req/window).

### `POST /api/recurring/{id}/executions`

Confirms the payment for the due cycle with one signature over an off-ramp outcome intent that names the order and the cycle.

- **Body:** `{ intent, signature, publicKey }`, where `intent` is `{ type: "offramp-outcome", sourceAsset, destinationAsset, amount, sender, recipient, anchorId, corridor, transactionId, recurringAuthorizationId, cycleNumber, minReceive? }`
- **Response (201):** `{ execution, state }`. Repeating a confirmed intent answers `200` with the same shape.
- **Errors:**
  - `400 VALIDATION_ERROR`: malformed body.
  - `401 UNAUTHORIZED`: the signature does not verify over the intent's hash.
  - `403 FORBIDDEN`: the intent names another order, or `publicKey`, `intent.sender` and the terms' sender differ.
  - `404 NOT_FOUND`: unknown id, or the feature flag is off.
  - `409 NOT_DUE`: no payment is due now. `409 CYCLE_MISMATCH`: the intent names another cycle. `409 DUPLICATE_CYCLE`: the cycle is already confirmed.
  - `422` with the enforcement code upper-cased, for example `PERIOD_CAP_EXCEEDED` or `ANCHOR_NOT_ALLOWED`. The rejected attempt is recorded in the order's history.
  - `429 RATE_LIMITED`.
