// ─── Outcome log schema (Issue #127 / #218) ───────────────────────────────────
//
// The append-only outcome row written after every terminal intent. This is the
// source-of-truth log the rolling scorecard and the delivered-rate reconciler
// (#130) read from — distinct from the derived aggregate row in `aggregate.ts`.

export const OUTCOME_STATUSES = ['completed', 'partial', 'refunded', 'expired', 'error'] as const;
export type OutcomeStatus = (typeof OUTCOME_STATUSES)[number];

export interface OutcomeLogRow {
  /** SHA-256 of the canonical intent — the row's primary key. */
  intentHash: string;
  anchorId: string;
  corridor: string;
  /** Quoted exchange rate (decimal string) at intent time. */
  quotedRate: string;
  /** Actual delivered rate, backfilled by the reconciler; null until settled. */
  deliveredRate: string | null;
  quotedAmount: string;
  /** Actual delivered amount, backfilled by the reconciler; null until settled. */
  deliveredAmount: string | null;
  /** Wall-clock seconds from submission to terminal state; null when unknown. */
  settleSeconds: number | null;
  outcome: OutcomeStatus;
  /** RFC 3339 timestamp when the row was created. */
  createdAt: string;
  /** Stellar tx hash used by the reconciler to look up the on-chain payment. */
  stellarTransactionId: string | null;
  /** RFC 3339 timestamp when the reconciler backfilled delivery; null until then. */
  reconciledAt: string | null;
  /** Set to true when an admin marks this outcome as disputed (#164). */
  disputed: boolean;
  /** Human-readable reason supplied by the admin when disputing; null when not disputed. */
  disputedReason: string | null;
  /** RFC 3339 timestamp when the publisher mirrored this outcome to the Soroban oracle; null until published. */
  publishedAt: string | null;
  /** Tx hash of the `submit_outcome` call that published this row on-chain; null until published. */
  oracleTxHash: string | null;
}

// ─── Uptime / quote-latency / issuer-mismatch / toml-integrity probe ledger ────
// (Issue #D002 / #D005 / #D004 / #D003)
//
// Probe samples recorded into the health ledger. An `uptime` row captures one
// SEP-1 stellar.toml reachability check for an anchor; a `quote` row captures
// one SEP-38 quote round-trip for an anchor+corridor, timed independently of
// uptime so a slow-but-reachable anchor is distinguishable from a down one.
// An `issuer-mismatch` row captures one comparison of an anchor's stellar.toml
// advertised issuer against the issuer its live SEP-38 /info response actually
// returns for the same asset. A `toml-integrity` row captures one schema
// validation of an anchor's stellar.toml (missing SIGNING_KEY, malformed
// TRANSFER_SERVER*/URLs, or drift vs. the last known-good snapshot) — an
// anchor can silently break its toml without ever going offline, which
// `uptime` alone would never catch. Each of these is a distinct,
// higher-severity failure mode from ordinary unreachability, so each gets its
// own kind rather than being folded into `uptime`.
// All kinds carry a classified failure type so the dashboard can distinguish
// DNS/TLS issues, plain HTTP errors/timeouts, and semantic mismatches/integrity
// failures from each other.

export const PROBE_FAILURE_TYPES = [
  'dns',
  'tls',
  'http',
  'timeout',
  'mismatch',
  'integrity',
  'unknown',
] as const;
export type ProbeFailureType = (typeof PROBE_FAILURE_TYPES)[number];

export const PROBE_KINDS = ['uptime', 'quote', 'issuer-mismatch', 'toml-integrity'] as const;
export type ProbeKind = (typeof PROBE_KINDS)[number];

export interface ProbeLedgerRow {
  /** Anchor home domain that was probed. */
  domain: string;
  /** Which check this row represents: stellar.toml reachability, a SEP-38 quote round-trip, an issuer-mismatch comparison, or a toml-integrity validation. */
  kind: ProbeKind;
  /** Corridor ID (e.g. 'usdc-ngn') for `quote` rows; null for `uptime`/`issuer-mismatch`/`toml-integrity` rows. */
  corridor: string | null;
  /** True when the probe succeeded (toml resolved, a quote was returned, the issuer matched, or the toml validated clean). */
  reachable: boolean;
  /** Round-trip time in milliseconds (0 when unreachable, or for `issuer-mismatch`/`toml-integrity` rows). */
  latencyMs: number;
  /** Classified failure reason; null when reachable. */
  failureType: ProbeFailureType | null;
  /** Raw error message, or a mismatch/integrity description for `issuer-mismatch`/`toml-integrity` rows; null when reachable. */
  error: string | null;
  /** ISO 8601 timestamp of the probe. */
  probedAt: string;
}

/** p50/p95 latency over a rolling window of an anchor+corridor's reachable quote samples. */
export interface LatencyPercentiles {
  p50Ms: number;
  p95Ms: number;
  /** Number of reachable samples the percentiles were computed over. */
  sampleCount: number;
}
