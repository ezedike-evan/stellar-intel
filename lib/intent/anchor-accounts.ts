import { ANCHORS } from '@/constants';

// ─── Anchor payment destinations (Issue #941) ─────────────────────────────────
//
// The intent API previously hardcoded two destination accounts. Neither existed
// on mainnet — both returned 404 from Horizon — so the endpoint handed callers
// signed-ready payments that could only fail with op_no_destination, and one of
// them named an anchor absent from the registry entirely.
//
// There is no safe default here. For SEP-24 anchors the destination is issued by
// the anchor's interactive flow, not published as a static address, so for most
// anchors a static route simply does not exist. Rather than invent one, an
// unconfigured corridor now yields NO_ROUTE.
//
// Configure with ANCHOR_PAYMENT_ACCOUNTS as JSON mapping anchorId to a verified
// Stellar account:
//
//   ANCHOR_PAYMENT_ACCOUNTS='{"cowrie":"GABC…"}'
//
// Verify any address against Horizon before adding it. A typo here is a payment
// to a stranger.

export interface AnchorRoutingTarget {
  anchorId: string;
  anchorDomain: string;
  anchorAccount: string;
}

function parseConfiguredAccounts(): Record<string, string> {
  const raw = process.env['ANCHOR_PAYMENT_ACCOUNTS'];
  if (!raw?.trim()) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

    const out: Record<string, string> = {};
    for (const [anchorId, account] of Object.entries(parsed as Record<string, unknown>)) {
      // Reject anything that is not a Stellar public key outright. A malformed
      // entry must not silently become a routing target.
      if (typeof account === 'string' && /^G[A-Z2-7]{55}$/.test(account)) {
        out[anchorId] = account;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Anchors that serve `corridorId` **and** have a configured payment account,
 * in registry order.
 *
 * Returns an empty array when nothing is configured, which callers must treat
 * as "no route" rather than falling back to a default.
 */
export function routingTargetsForCorridor(corridorId: string): AnchorRoutingTarget[] {
  const accounts = parseConfiguredAccounts();

  return ANCHORS.filter((anchor) => anchor.corridors.includes(corridorId))
    .filter((anchor) => accounts[anchor.id] !== undefined)
    .map((anchor) => ({
      anchorId: anchor.id,
      anchorDomain: anchor.homeDomain,
      anchorAccount: accounts[anchor.id]!,
    }));
}

/** Anchors registered for a corridor, regardless of payment configuration. */
export function registeredAnchorsForCorridor(corridorId: string): string[] {
  return ANCHORS.filter((anchor) => anchor.corridors.includes(corridorId)).map((a) => a.id);
}
