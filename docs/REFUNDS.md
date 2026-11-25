# Refund Guarantees

**Last reviewed:** 2026-11-22

This document defines the refund guarantee architecture, tracking lifecycle, verification rules, release-gate metrics, and dispute escalation path for covered transfers and off-ramps on Stellar Intel.

## 1. What a refund guarantee is (and is not)

Stellar Intel is **non-custodial by construction** (see [`docs/NON_CUSTODY.md`](NON_CUSTODY.md)). Stellar Intel never holds user funds, anchor funds, or private keys, and does not custody fiat or crypto balances. Consequently, Stellar Intel cannot directly execute a monetary payout or take money from an anchor's reserve to refund a user.

Instead, a **refund guarantee** is an architectural and cryptographic enforcement mechanism:

- **What it is:** A tamper-evident tracking and verification system that monitors anchor settlement failures, enforces an on-chain proof of refund requirement, tracks user-signed acknowledgements, degrades delinquent anchor reputation scores, gates anchors from routing recommendations, and auto-escalates unresolved obligations into public disputes.
- **What it is not:** A custodial escrow, an insurance pool, or a direct settlement intermediary.

When an anchor accepts user funds on Stellar but fails to complete the corresponding fiat settlement or off-ramp payout, the anchor owes an unconditional refund to the user's originating Stellar account.

## 2. When a refund case opens

A refund case is automatically initiated by detection heuristics in `lib/refunds/detect.ts` whenever any of four conditions are met:

1. `anchor_refunded`: The anchor's API or status callback explicitly signals that a refund was initiated or processed.
2. `anchor_error_after_payment`: The anchor reports a terminal error, cancellation, or permanent failure after the user's on-chain Stellar payment transaction has been confirmed on the ledger.
3. `expired_after_payment`: The off-ramp intent or quote window expired after the user's payment transaction was confirmed, but before the anchor completed fulfillment.
4. `slippage_breach`: The final execution payout breached guaranteed price or minimum payout terms beyond allowable slippage limits, obligating a full return of principal.

## 3. Case lifecycle (`owed → refunded → acknowledged`)

Each refund case follows a deterministic, three-state lifecycle managed in `lib/refunds/store.ts`:

```
 [Detection]
      │
      ▼
   ┌──────┐      Anchor executes on-chain refund      ┌──────────┐
   │ owed │ ─────────────────────────────────────────► │ refunded │
   └──────┘                                           └──────────┘
      │                                                     │
      │ Overdue (> 7 days)                                  │ User signs receipt
      ▼                                                     ▼
┌───────────┐                                        ┌──────────────┐
│  Dispute  │                                        │ acknowledged │
│ Escalation│                                        └──────────────┘
└───────────┘
```

- **`owed`**: The case is opened immediately upon failure detection. The anchor owes the full transaction principal back to the user's Stellar account.
- **`refunded`**: The anchor broadcasts an on-chain refund transaction returning the assets to the user's account, and Stellar Intel verifies the transaction on-chain.
- **`acknowledged`**: The recipient user cryptographically signs an acknowledgement payload verifying that the refund was received.

## 4. Signed acknowledgement

To prevent disputes where an anchor claims a refund was made while the user claims non-receipt, the system supports user-signed acknowledgements via `RefundAckPayload` (`lib/refunds/store.ts`).

### Schema

```typescript
export interface RefundAckPayload {
  caseId: string; // UUID of the refund case
  intentHash: string; // SHA-256 hash of original payment intent
  userAddress: string; // Stellar G... address of recipient
  amount: string; // Refunded amount as decimal string (e.g. "100.00")
  asset: string; // Asset identifier (e.g. "USDC:GA5ZSEJY..." or "native")
  txHash: string; // 64-character hex hash of on-chain refund tx
  acknowledgedAt: string; // ISO 8601 UTC timestamp
}
```

### Canonical digest and signing

The payload is normalized and digested using canonical JSON via `hashRefundAck(payload)`:

- Keys are sorted lexicographically.
- Whitespace is stripped.
- The string is hashed with SHA-256.

The user signs this 32-byte digest using their Ed25519 key (e.g., via Freighter or client wallet).

### Example acknowledgement submission

```bash
curl -X POST https://stellar-intel.vercel.app/api/refunds/ack \
  -H "Content-Type: application/json" \
  -d '{
    "payload": {
      "caseId": "550e8400-e29b-41d4-a716-446655440000",
      "intentHash": "7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069",
      "userAddress": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      "amount": "50.0000000",
      "asset": "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      "txHash": "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b",
      "acknowledgedAt": "2026-11-22T10:00:00.000Z"
    },
    "signature": "3b6a27bc...ed25519_hex_signature..."
  }'
```

## 5. On-chain verification

When an anchor or user submits a refund transaction hash, `lib/refunds/verify.ts` inspects the transaction directly on the Stellar ledger via RPC/Horizon:

- **`verified`**: The transaction is confirmed on-chain with `tx_SUCCESS`, originated from or was authorized by the anchor's distribution account, paid the exact asset and amount, and targeted the user's destination account.
- **`mismatch`**: The transaction exists on-chain, but the recipient, asset, or amount does not match the refund case obligation.
- **`unverifiable`**: The transaction hash is not found on the ledger within the verification window, or ledger RPC queries fail repeatedly.

Only cases whose refund transaction is `verified` transition from `owed` to `refunded`.

## 6. Release-gate metric

Anchor reliability is continually evaluated via `lib/refunds/metrics.ts` to gate routing recommendations:

- `REFUND_GATE_WINDOW_DAYS = 30`: Rolling 30-day window used to evaluate anchor refund compliance.
- `REFUND_ACK_GRACE_MS = 72 * 60 * 60 * 1000` (72 hours): Grace period allowed for user acknowledgement before an unacknowledged refund affects metrics.
- `REFUND_OWED_OVERDUE_MS = 7 * 24 * 60 * 60 * 1000` (7 days): Maximum allowed window for an anchor to execute a refund once `owed`.

An anchor with any overdue `owed` refund past 7 days fails the release gate, triggering immediate de-ranking and routing exclusion.

Metrics are publicly queryable via `GET /api/v1/refunds/summary`.

## 7. Escalation

Handled by `lib/refunds/escalate.ts`:

1. If a refund case remains in `owed` status for longer than `REFUND_OWED_OVERDUE_MS` (7 days), the system automatically files a formal dispute in the reputation system (`lib/reputation/disputes.ts`).
2. The dispute is assigned category `refund_owed` and initialized at level `anchor`.
3. If the anchor fails to resolve the refund during their response window (`LEVEL_WINDOW_MS.anchor = 72h`), the dispute automatically escalates to `review` (maintainer adjudication) and subsequently to `appeal`.
4. While an overdue refund or dispute is active, the anchor's composite reputation score drops sharply (`lib/reputation/composite.ts`), and their corridor offers are suppressed in directory routing.

## 8. API and webhooks

### Endpoints

- `POST /api/refunds/ack`: Submit user-signed acknowledgement for a verified refund.
- `GET /api/refunds/{intentHash}`: Fetch refund case status, on-chain verification state, and acknowledgement receipt for a given intent.
- `GET /api/v1/refunds/summary`: Retrieve global and per-anchor refund metrics, breach rates, and release-gate status.

### Webhooks

Integrators and anchors can subscribe to webhook notifications for refund events (see [`docs/WEBHOOKS.md`](WEBHOOKS.md)):

- `refund.detected`: Emitted immediately when a payment failure opens a case (`owed`).
- `refund.acknowledged`: Emitted when a user submits a valid signed acknowledgement (`acknowledged`).
