# Standing Orders & Recurring Intents

**Last reviewed:** 2026-11-22

Stellar Intel supports standing orders for recurring remittance and scheduled payouts. A user signs a standing authorization once with Freighter to define the bounds of future payments (cadence, per-period cap, anchor allowlist, and expiration). Because standard Stellar wallets do not currently support automated pre-authorized execution without user presence, each due payment generates a reminder and requires exactly one signature to confirm and execute.

---

## 1. Feature Flag & Status

Recurring intents are flag-gated and **off by default** in production:

- Governed by `flags.recurringIntents` in `lib/flags.ts` (environment variable `NEXT_PUBLIC_RECURRING_INTENTS=on`).
- When disabled, recurring routes return `404 Not Found`.
- When enabled, it activates `/recurring`, `/api/recurring/*`, and the due banner on `/offramp`.

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

When an authorization is `due`, the UI displays a reminder on `/recurring` and a banner on `/offramp`. The user can confirm the cycle:

1. The server compiles an off-ramp intent for the due amount with an approved anchor from `anchorAllowlist`.
2. The user signs the generated intent transaction in Freighter.
3. The execution is recorded and linked to the authorization cycle via `POST /api/recurring/{id}/executions`.

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

Registers a new standing authorization.

- **Body:** `{ authorization: SignedStandingAuthorization }`
- **Response (201):** `{ id: string, status: "active", termsHash: string }`
- **Errors:** `400 VALIDATION_ERROR`, `401 UNAUTHORIZED`, `409 DUPLICATE_AUTHORIZATION`, `429 RATE_LIMITED`.

### `GET /api/recurring/{id}`

Retrieves a standing authorization record along with its current evaluated state.

- **Response (200):** `{ id, status, authorization, state }`
- **Errors:** `404 NOT_FOUND`.

### `GET /api/recurring/due`

Lists all authorizations currently in the `due` phase for the connected sender wallet.

- **Query:** `?sender=G...`
- **Response (200):** `{ due: DueReminder[] }`

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

Records a confirmed payment execution for an authorized cycle.

- **Body:** `{ cycleNumber, periodIndex, amount, anchorId, intentHash, transactionId }`
- **Response (200):** `{ ok: true, executionId: string }`
- **Errors:** `400 VALIDATION_ERROR`, `403 FORBIDDEN`, `409 DUPLICATE_CYCLE`.
