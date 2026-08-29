/**
 * Shared validation patterns.
 *
 * Centralised so the same rule is applied everywhere and cannot drift between
 * routes, schemas, and config validators.
 */

/**
 * A Stellar ed25519 public key (account id): `G` followed by 55 base32 chars.
 * Uses the RFC 4648 base32 alphabet (`A-Z2-7`) — it intentionally rejects the
 * digits `0`, `1`, `8`, and `9`, which are not valid strkey characters.
 */
export const STELLAR_PUBKEY_PATTERN = /^G[A-Z2-7]{55}$/;

/** A positive decimal amount, e.g. `100` or `100.5` (unbounded precision). */
export const AMOUNT_PATTERN = /^\d+(\.\d+)?$/;

/** A positive decimal amount with at most 7 fractional digits (Stellar precision). */
export const AMOUNT_7DP_PATTERN = /^\d+(\.\d{1,7})?$/;

/** A signed decimal amount, e.g. `-1.5`, `0`, `100.25`. */
export const SIGNED_AMOUNT_PATTERN = /^-?\d+(\.\d+)?$/;
