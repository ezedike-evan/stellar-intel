// Anchor and corridor data lives in constants/anchors.ts — the single source of truth.
// This module re-exports that data and adds SEP-1 resolution helpers that belong
// in lib/stellar (network calls, dynamic imports) rather than in constants.
export * from '@/constants/anchors'

import { ANCHORS, CORRIDORS } from '@/constants/anchors'
import type { Anchor, Corridor, Sep1TomlData } from '@/types'

export interface DiscoveredAnchor extends Anchor {
  sep1: Sep1TomlData
  transferServerSep24: string
  webAuthEndpoint: string
}

// ─── Lookup helpers ───────────────────────────────────────────────────────────

/**
 * Returns the anchor with the given ID.
 * Throws a descriptive error if the ID is not found.
 */
export function getAnchorById(id: string): Anchor {
  const anchor = ANCHORS.find((a) => a.id === id)
  if (!anchor) {
    throw new Error(
      `Unknown anchor: "${id}". Valid IDs: ${ANCHORS.map((a) => a.id).join(', ')}`
    )
  }
  return anchor
}

/**
 * Returns all anchors that serve the given corridor.
 * Returns an empty array if no anchors support the corridor.
 */
export function getAnchorsByCorridorId(corridorId: string): Anchor[] {
  return ANCHORS.filter((a) => a.corridors.includes(corridorId))
}

/**
 * Resolves SEP-1 details for every known anchor that serves the corridor.
 * Failed anchors are omitted so callers can continue with the live subset.
 */
export async function discoverAnchorsForCorridor(corridorId: string): Promise<DiscoveredAnchor[]> {
  const { resolveToml } = await import('./sep1')
  const corridorAnchors = ANCHORS.filter((anchor) => anchor.corridors.includes(corridorId))

  const results = await Promise.allSettled(
    corridorAnchors.map(async (anchor): Promise<DiscoveredAnchor> => {
      const result = await resolveToml(anchor.homeDomain)
      if (!result.ok) throw new Error(result.error)
      const sep1 = result.data
      if (!sep1.TRANSFER_SERVER_SEP0024 || !sep1.WEB_AUTH_ENDPOINT) {
        throw new Error(`Anchor "${anchor.id}" does not support SEP-24 or SEP-10.`)
      }
      return {
        ...anchor,
        sep1,
        transferServerSep24: sep1.TRANSFER_SERVER_SEP0024,
        webAuthEndpoint: sep1.WEB_AUTH_ENDPOINT,
      }
    })
  )

  return results
    .filter((result): result is PromiseFulfilledResult<DiscoveredAnchor> => {
      return result.status === 'fulfilled'
    })
    .map((result) => result.value)
}

/**
 * Returns the corridor with the given ID.
 * Throws a descriptive error if the ID is not found.
 */
export function getCorridorById(id: string): Corridor {
  const corridor = CORRIDORS.find((c) => c.id === id)
  if (!corridor) {
    throw new Error(
      `Unknown corridor: "${id}". Valid IDs: ${CORRIDORS.map((c) => c.id).join(', ')}`
    )
  }
  return corridor
}

/**
 * Returns true if the given string is a valid corridor ID.
 * Used to validate query parameters in API routes.
 */
export function isValidCorridorId(id: string): boolean {
  return CORRIDORS.some((c) => c.id === id)
}
