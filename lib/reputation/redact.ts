import { createHash } from 'crypto';

// ─── Intent shape (with PII) ──────────────────────────────────────────────────

/**
 * A raw payment intent that may contain PII fields such as recipient details.
 * These fields must never reach the outcome log.
 */
export interface RawIntent {
  /** Stellar public key of the recipient — PII */
  recipientAccount?: string;
  /** Full name of the recipient — PII */
  recipientName?: string;
  /** Email address of the recipient — PII */
  recipientEmail?: string;
  /** Phone number of the recipient — PII */
  recipientPhone?: string;
  /** Bank account number — PII */
  bankAccount?: string;
  /** Generic account field (e.g. from SEP-24 request) — PII */
  account?: string;
  // ── Non-PII fields ──
  amount: string;
  assetCode: string;
  assetIssuer?: string;
  corridorId: string;
  anchorId: string;
  [key: string]: unknown;
}

// ─── Redacted row (safe to write) ────────────────────────────────────────────

/**
 * The shape written to the outcome log.
 * Contains only the intent hash and non-PII routing metadata.
 */
export interface RedactedIntent {
  intentHash: string;
  assetCode: string;
  corridorId: string;
  anchorId: string;
}

// ─── PII field registry ───────────────────────────────────────────────────────

/**
 * Exhaustive list of field names considered PII.
 * Used by the unit test to assert zero PII fields survive redaction.
 */
export const PII_FIELDS = [
  'recipientAccount',
  'recipientName',
  'recipientEmail',
  'recipientPhone',
  'bankAccount',
  'account',
  'email',
  'phone',
  'name',
  'address',
] as const;

export type PiiField = (typeof PII_FIELDS)[number];

// ─── Core functions ───────────────────────────────────────────────────────────

/**
 * Produces a stable SHA-256 hex digest of the full intent (including PII).
 * The hash is the only representation of the recipient that enters the log.
 */
export function hashIntent(intent: RawIntent): string {
  const stable = JSON.stringify(intent, Object.keys(intent).sort());
  return createHash('sha256').update(stable).digest('hex');
}

/**
 * Strips all PII from a raw intent and returns a row safe to write to the
 * outcome log. Only the intent hash and non-PII routing fields are kept.
 */
export function redactIntent(intent: RawIntent): RedactedIntent {
  return {
    intentHash: hashIntent(intent),
    assetCode: intent.assetCode,
    corridorId: intent.corridorId,
    anchorId: intent.anchorId,
  };
}
