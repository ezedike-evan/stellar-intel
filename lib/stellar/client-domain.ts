import { Keypair } from '@stellar/stellar-sdk';

/**
 * The server's SEP-10 `client_domain` identity (#1327).
 *
 * With `client_domain`, an anchor's challenge carries a `manage_data` operation
 * sourced by our signing key, which the anchor expects us — and only us — to
 * sign so it can attribute the session to us. That is the one legitimate
 * server-held signing key besides the publisher's: it is never a user's key, and
 * the only thing it ever signs is a sequence-0 authentication challenge that can
 * never be submitted to the ledger, so it can never move funds. See
 * docs/NON_CUSTODY.md and the guard in tests/custody-boundary.spec.ts.
 *
 * The originally-scoped prerequisite (ANC058) that was to provide these helpers
 * was not present upstream, so this minimal environment-backed implementation
 * lives here, isolated in its own module to keep the custody-boundary exemption
 * narrow and reviewable.
 */

/**
 * Our own `client_domain` value — the domain an anchor attributes a challenge to.
 * Read from `CLIENT_DOMAIN`; null (unconfigured) when unset.
 */
export function getClientDomain(): string | null {
  const domain = process.env.CLIENT_DOMAIN?.trim();
  return domain ? domain.toLowerCase() : null;
}

/**
 * The keypair that signs `client_domain` operations, loaded from the
 * `CLIENT_DOMAIN_SIGNING_SECRET` (an `S…` seed) the server holds. Returns null
 * when unconfigured or when the secret is malformed, so callers fail closed
 * (503) rather than crash. Never returns or logs the seed itself.
 */
export function getClientDomainKeypair(): Keypair | null {
  const secret = process.env.CLIENT_DOMAIN_SIGNING_SECRET?.trim();
  if (!secret) return null;
  try {
    return Keypair.fromSecret(secret);
  } catch {
    return null;
  }
}
