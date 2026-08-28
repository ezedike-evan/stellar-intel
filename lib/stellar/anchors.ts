// constants/anchors.ts is the single source of truth for anchor and corridor data.
// This module re-exports that registry verbatim and adds SEP-1 resolution helpers
// that belong in lib/stellar (network calls, dynamic imports) rather than in
// constants. It must never declare its own anchor list — read through the
// canonical export below so the two can never drift.
export * from '@/constants/anchors';

import { ANCHORS, CORRIDORS } from '@/constants/anchors';
import anchorHealthData from '@/constants/anchor-health.json';
import type { Anchor, Corridor, ResolvedAnchor, Sep1TomlData } from '@/types';

// ─── Anchor health (stale-anchor auto-disable, #495) ───────────────────────────

/**
 * Per-anchor health record maintained by the nightly validator
 * (scripts/validate-anchors.mjs). An anchor that fails TOML resolution for
 * `thresholdNights` consecutive nights is flagged `degraded` so the UI can hide it
 * — the anchor stays in the registry so the flag can clear once it recovers.
 */
export interface AnchorHealth {
  /** Consecutive nightly validation failures; reset to 0 on the next success. */
  consecutiveFailures: number;
  /** True once `consecutiveFailures` reaches the configured threshold. */
  degraded: boolean;
  /** ISO timestamp of the last nightly check, or null if never checked. */
  lastCheckedAt: string | null;
  /** Outcome of the last check ('ok' | 'fail' | 'unknown'). */
  lastStatus: string;
  /** Failure reason from the last check, or null on success. */
  lastError: string | null;
}

interface AnchorHealthLedger {
  thresholdNights: number;
  updatedAt: string | null;
  anchors: Record<string, AnchorHealth>;
}

const ANCHOR_HEALTH = anchorHealthData as AnchorHealthLedger;

/** Returns the nightly health record for an anchor, or undefined if untracked. */
export function getAnchorHealth(id: string): AnchorHealth | undefined {
  return ANCHOR_HEALTH.anchors[id];
}

/**
 * True when an anchor has been auto-flagged `degraded` by the nightly validator
 * after repeated TOML failures. Degraded anchors are hidden from the corridor
 * selectors below but remain in the registry.
 */
export function isAnchorDegraded(id: string): boolean {
  return ANCHOR_HEALTH.anchors[id]?.degraded === true;
}

/** IDs of every anchor currently flagged degraded. */
export function getDegradedAnchorIds(): string[] {
  return Object.keys(ANCHOR_HEALTH.anchors).filter((id) => ANCHOR_HEALTH.anchors[id]?.degraded);
}

// ─── Asset-issuer validation (#489) ─────────────────────────────────────────────

/**
 * Outcome of comparing an anchor's registered asset issuer against the issuer it
 * advertises for the same asset code in its resolved stellar.toml.
 *
 * - `match`        — the toml lists `assetCode` under the canonical issuer.
 * - `mismatch`     — the toml lists `assetCode` under a *different* issuer: a
 *                    look-alike asset reusing a trusted code (e.g. "USDC").
 * - `missing`      — the toml advertises no issuer for `assetCode` to compare.
 */
export type AnchorIssuerStatus = 'match' | 'mismatch' | 'missing';

/** Result of {@link validateAnchorAssetIssuer}. */
export interface AnchorIssuerValidation {
  anchorId: string;
  assetCode: string;
  /** Canonical issuer the anchor is registered to settle (USDC_ISSUER for USDC anchors). */
  expectedIssuer: string;
  /** Issuer advertised for `assetCode` in the resolved toml CURRENCIES, or null if absent. */
  advertisedIssuer: string | null;
  status: AnchorIssuerStatus;
}

/**
 * Validates that an anchor settles the canonical issuer for its registered asset
 * rather than a look-alike that merely reuses the asset code. Compares the
 * anchor's registered `assetIssuer` (e.g. USDC_ISSUER) against the issuer the
 * anchor publishes for the same code in its stellar.toml `[[CURRENCIES]]`.
 *
 * Pure and synchronous so it can be reused by the app, the nightly validator, and
 * tests. A `mismatch` is the security-relevant case — the anchor advertises a
 * trusted code under an impostor issuer.
 */
export function validateAnchorAssetIssuer(
  anchor: Pick<Anchor, 'id' | 'assetCode' | 'assetIssuer'>,
  currencies: Sep1TomlData['CURRENCIES']
): AnchorIssuerValidation {
  const advertisedIssuer =
    currencies.find(
      (currency) => currency.code === anchor.assetCode && typeof currency.issuer === 'string'
    )?.issuer ?? null;

  let status: AnchorIssuerStatus;
  if (advertisedIssuer === null) status = 'missing';
  else if (advertisedIssuer === anchor.assetIssuer) status = 'match';
  else status = 'mismatch';

  return {
    anchorId: anchor.id,
    assetCode: anchor.assetCode,
    expectedIssuer: anchor.assetIssuer,
    advertisedIssuer,
    status,
  };
}

// ─── Lookup helpers ───────────────────────────────────────────────────────────

/**
 * Returns the anchor with the given ID.
 * Throws a descriptive error if the ID is not found.
 */
export function getAnchorById(id: string): Anchor {
  const anchor = ANCHORS.find((a) => a.id === id);
  if (!anchor) {
    throw new Error(`Unknown anchor: "${id}". Valid IDs: ${ANCHORS.map((a) => a.id).join(', ')}`);
  }
  return anchor;
}

/**
 * Resolves SEP-1 details for the anchor with the given ID.
 * Throws if the anchor is unknown or TOML resolution fails.
 */
export async function getResolvedAnchorByDomain(homeDomain: string): Promise<ResolvedAnchor> {
  const anchor = ANCHORS.find((a) => a.homeDomain === homeDomain);
  if (!anchor) throw new Error(`No anchor found for domain "${homeDomain}"`);
  return getResolvedAnchorById(anchor.id);
}

export async function getResolvedAnchorById(id: string): Promise<ResolvedAnchor> {
  const anchor = getAnchorById(id);
  const { resolveToml } = await import('./sep1');
  // Use serviceDomain if provided, otherwise fall back to homeDomain
  const domainToResolve = anchor.serviceDomain || anchor.homeDomain;
  const result = await resolveToml(domainToResolve);
  if (!result.ok) throw new Error(result.error);
  return { ...anchor, ...result.data };
}

// SEPs that indicate transfer capability (deposit/withdrawal/send)
// SEP-6: programmatic transfer, SEP-24: interactive transfer,
// SEP-31: cross-border payment
const TRANSFER_SEPS: ReadonlyArray<NonNullable<Anchor['seps']>[number]> = [
  'sep6',
  'sep24',
  'sep31',
];

/**
 * Returns true if the anchor supports at least one transfer SEP
 * (SEP-6, SEP-24, or SEP-31). Issuer-only anchors that lack all
 * three are excluded from corridor selectors and the rate engine.
 */
export function transferCapable(anchor: Anchor): boolean {
  return anchor.seps?.some((sep) => TRANSFER_SEPS.includes(sep)) ?? false;
}

/**
 * Returns all anchors that serve the given corridor.
 * Anchors auto-flagged `degraded` by the nightly validator are excluded so they
 * stay hidden from selectors (rate solicitation, off-ramp options).
 * Excludes issuer-only anchors that lack transfer SEPs.
 * Returns an empty array if no anchors support the corridor.
 */
export function getAnchorsByCorridorId(corridorId: string): Anchor[] {
  return ANCHORS.filter((a) => a.corridors.includes(corridorId) && !isAnchorDegraded(a.id)).filter(
    transferCapable
  );
}

/**
 * Resolves SEP-1 details for every known, non-degraded anchor that serves the
 * corridor. Failed anchors are omitted so callers can continue with the live subset.
 * For each anchor, uses serviceDomain if available, otherwise falls back to homeDomain.
 */
export async function discoverAnchorsForCorridor(corridorId: string): Promise<ResolvedAnchor[]> {
  const { resolveToml } = await import('./sep1');
  const corridorAnchors = ANCHORS.filter(
    (anchor) => anchor.corridors.includes(corridorId) && !isAnchorDegraded(anchor.id)
  );

  const results = await Promise.allSettled(
    corridorAnchors.map(async (anchor): Promise<ResolvedAnchor> => {
      // Use serviceDomain if provided, otherwise fall back to homeDomain
      const domainToResolve = anchor.serviceDomain || anchor.homeDomain;
      const result = await resolveToml(domainToResolve);
      if (!result.ok) throw new Error(result.error);
      const sep1 = result.data;
      if (!sep1.TRANSFER_SERVER_SEP0024 || !sep1.WEB_AUTH_ENDPOINT) {
        throw new Error(`Anchor "${anchor.id}" does not support SEP-24 or SEP-10.`);
      }
      // Flag look-alike assets: an anchor that advertises our trusted code under a
      // different issuer is settling an impostor asset. We surface it loudly rather
      // than drop it — the registry's canonical issuer still governs downstream
      // SEP-38 identifiers, so the warning is for operators/CI to act on.
      const issuerCheck = validateAnchorAssetIssuer(anchor, sep1.CURRENCIES);
      if (issuerCheck.status === 'mismatch') {
        // eslint-disable-next-line no-console
        console.warn(
          `[anchors] ${anchor.id} advertises a look-alike ${anchor.assetCode} issuer ` +
            `(${issuerCheck.advertisedIssuer}); expected ${issuerCheck.expectedIssuer}`
        );
      }
      return {
        ...anchor,
        ...sep1,
      };
    })
  );

  return results
    .filter((result): result is PromiseFulfilledResult<ResolvedAnchor> => {
      return result.status === 'fulfilled';
    })
    .map((result) => result.value);
}

/**
 * Returns the corridor with the given ID.
 * Throws a descriptive error if the ID is not found.
 */
export function getCorridorById(id: string): Corridor {
  const corridor = CORRIDORS.find((c) => c.id === id);
  if (!corridor) {
    throw new Error(
      `Unknown corridor: "${id}". Valid IDs: ${CORRIDORS.map((c) => c.id).join(', ')}`
    );
  }
  return corridor;
}

/**
 * Returns true if the given string is a valid corridor ID.
 * Used to validate query parameters in API routes.
 */
export function isValidCorridorId(id: string): boolean {
  return CORRIDORS.some((c) => c.id === id);
}
