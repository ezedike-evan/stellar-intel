# Disputes

**Last reviewed:** 2026-11-21

This document describes how a user contests a recorded outcome and how a maintainer resolves it. Every claim cites the source file that implements it.

## Who can file and how

A dispute is filed with `POST /api/reputation/dispute` ([`app/api/reputation/dispute/route.ts`](../app/api/reputation/dispute/route.ts)). The JSON body carries five fields.

| Field        | Rule                                                                                  |
| ------------ | ------------------------------------------------------------------------------------- |
| `intentHash` | Lowercase hex SHA-256, 64 characters.                                                 |
| `publicKey`  | A Stellar public key (`G...`, 56 characters).                                         |
| `signature`  | Ed25519 signature over the raw `intentHash` bytes, made with the key for `publicKey`. |
| `anchorId`   | The `id` of an anchor in `constants/anchors.ts`.                                      |
| `reason`     | Free text, 1 to 1000 characters.                                                      |

The route applies these checks in order.

1. A per-IP limit of 10 requests (bucket `api.reputation.dispute.ip`).
2. Body parsing and validation. Malformed JSON returns 400 `INVALID_JSON`; a body that fails the schema returns 422 `VALIDATION_ERROR`.
3. Signature verification through `verifyIntentSignature` ([`lib/intent/verify.ts`](../lib/intent/verify.ts)). A failure returns 403.
4. A durable reputation store must be configured. Without one the route returns the store-unavailable response from [`lib/api/store-guard.ts`](../lib/api/store-guard.ts).
5. An outcome must exist for the `intentHash` (404 `NOT_FOUND` otherwise), and `publicKey` must equal the outcome's `signerAccount`. Only the account that attested the outcome can dispute it; any other signer gets 403.
6. A per-signer quota of 10 disputes per 24 hours (429 `RATE_LIMITED` once exceeded).

A successful request returns 201 with the dispute record (`id`, `intentHash`, `publicKey`, `anchorId`, `reason`, `disputed: true`, `createdAt`). The record is stored with status `open` by `getDisputeStore()` ([`lib/reputation/disputes.ts`](../lib/reputation/disputes.ts)).

## What filing changes

Filing creates the dispute record and nothing else. The outcome row is not flagged `disputed`, and it keeps counting toward the anchor's scores while the dispute is open. The `disputed` flag on an outcome row is set only by the reconcile job, when the Horizon payment source does not match the account that signed the intent hash ([`app/api/reputation/reconcile/route.ts`](../app/api/reputation/reconcile/route.ts)). Rows flagged `disputed` are excluded from the corridor aggregates ([`lib/reputation/aggregate.ts`](../lib/reputation/aggregate.ts)).

## Resolution

A dispute is `open` until a maintainer resolves it. The status values are `open`, `accepted` and `rejected` (`DisputeStatus` in [`lib/reputation/disputes.ts`](../lib/reputation/disputes.ts)).

Maintainers use `/api/admin/disputes` ([`app/api/admin/disputes/route.ts`](../app/api/admin/disputes/route.ts)). Both methods require the `x-admin-key` header to match `ADMIN_SECRET_KEY` ([`lib/auth/admin.ts`](../lib/auth/admin.ts)); a missing or wrong key returns 401.

- `GET` lists every dispute, newest first, limited to 60 requests per window.
- `POST` takes `{ "id": "<dispute id>", "action": "accept" | "reject" }`, limited to 30 requests per window. It sets the status to `accepted` or `rejected`, records `resolvedAt`, and returns the updated dispute. An unknown id returns 404.

Resolving a dispute updates the dispute record only. It does not modify the outcome row.

## Storage

Disputes live in an in-memory store by default and in Postgres when `DATABASE_URL` is set. The table definition is the `SCHEMA_SQL` constant in [`lib/reputation/disputes.ts`](../lib/reputation/disputes.ts), which runs once per process.

## API summary

| Route                     | Method | Auth          | Purpose                     |
| ------------------------- | ------ | ------------- | --------------------------- |
| `/api/reputation/dispute` | POST   | Signed body   | File a dispute.             |
| `/api/admin/disputes`     | GET    | `x-admin-key` | List all disputes.          |
| `/api/admin/disputes`     | POST   | `x-admin-key` | Accept or reject a dispute. |

For how disputes relate to the settlement guarantee, see [`SETTLEMENT_SLA.md`](SETTLEMENT_SLA.md).
