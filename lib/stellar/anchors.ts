// constants/anchors.ts is the single source of truth for anchor and corridor data.
// This module re-exports that registry verbatim and adds SEP-1 resolution helpers
// that belong in lib/stellar (network calls, dynamic imports) rather than in
// constants. It must never declare its own anchor list — read through the
// canonical export below so the two can never drift.
export * from '@/constants/anchors';

import { ANCHORS, CORRIDORS } from '@/constants/anchors';
import anchorHealthData from '@/constants/anchor-health.json';
import type { Anchor, Corridor, ResolvedAnchor } from '@/types';

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

/**
 * Returns all anchors that serve the given corridor.
 * Anchors auto-flagged `degraded` by the nightly validator are excluded so they
 * stay hidden from selectors (rate solicitation, off-ramp options).
 * Returns an empty array if no anchors support the corridor.
 */
export function getAnchorsByCorridorId(corridorId: string): Anchor[] {
  return ANCHORS.filter((a) => a.corridors.includes(corridorId) && !isAnchorDegraded(a.id));
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
