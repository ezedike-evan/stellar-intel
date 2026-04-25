import type { Anchor, Corridor, Sep1TomlData, StellarAsset } from '@/types'
import { USDC_ISSUER } from '../config'
// ─── USDC asset ───────────────────────────────────────────────────────────────

/** USDC on Stellar mainnet (Circle issuer). */
export const USDC_ASSET: StellarAsset = {
  code: 'USDC',
  issuer: USDC_ISSUER,
  name: 'USD Coin',
}

// ─── Anchors ──────────────────────────────────────────────────────────────────

/**
 * MoneyGram — all five corridors (USDC → NGN / KES / GHS / MXN / BRL).
 * Confirmed live SEP-24 anchor. USDC withdraw enabled, max $2,500/tx.
 * Cash pickup at MoneyGram agent locations worldwide.
 */
const MONEYGRAM: Anchor = {
  id: 'moneygram',
  name: 'MoneyGram',
  homeDomain: 'stellar.moneygram.com',
  corridors: ['usdc-ngn', 'usdc-kes', 'usdc-ghs', 'usdc-mxn', 'usdc-brl'],
  assetCode: 'USDC',
  assetIssuer: USDC_ISSUER,
}

/**
 * Cowrie Exchange — Nigeria corridor (USDC → NGN).
 * Uses SEP-6 (TRANSFER_SERVER), not SEP-24. Included for comparison.
 */
const COWRIE: Anchor = {
  id: 'cowrie',
  name: 'Cowrie Exchange',
  homeDomain: 'cowrie.exchange',
  corridors: ['usdc-ngn'],
  assetCode: 'USDC',
  assetIssuer: USDC_ISSUER,
}

/**
 * Flutterwave - Nigeria, Kenya, and Ghana corridors (USDC -> NGN / KES / GHS).
 */
const FLUTTERWAVE: Anchor = {
  id: 'flutterwave',
  name: 'Flutterwave',
  homeDomain: 'flutterwave.com',
  corridors: ['usdc-ngn', 'usdc-kes', 'usdc-ghs'],
  assetCode: 'USDC',
  assetIssuer: USDC_ISSUER,
}

/**
 * Anclap — Argentina and Peru corridors (USDC → ARS / PEN).
 * Confirmed live SEP-24 anchor. 2% withdrawal fee.
 */
const ANCLAP: Anchor = {
  id: 'anclap',
  name: 'Anclap',
  homeDomain: 'anclap.com',
  corridors: ['usdc-ars', 'usdc-pen'],
  assetCode: 'USDC',
  assetIssuer: USDC_ISSUER,
}

/** All supported anchors. */
export const KNOWN_ANCHORS: Anchor[] = [MONEYGRAM, COWRIE, FLUTTERWAVE, ANCLAP] as const
export const ANCHORS = KNOWN_ANCHORS

export interface DiscoveredAnchor extends Anchor {
  sep1: Sep1TomlData
  transferServerSep24: string
  webAuthEndpoint: string
}

/** Maps anchor ID → home domain for quick lookup during SEP-1 resolution. */
export const ANCHOR_HOME_DOMAINS: Record<string, string> = {
  moneygram: 'stellar.moneygram.com',
  cowrie: 'cowrie.exchange',
  flutterwave: 'flutterwave.com',
  anclap: 'anclap.com',
} as const

// ─── Corridors ────────────────────────────────────────────────────────────────

const CORRIDOR_NGN: Corridor = {
  id: 'usdc-ngn',
  from: 'USDC',
  to: 'NGN',
  countryCode: 'NG',
  countryName: 'Nigeria',
}

const CORRIDOR_KES: Corridor = {
  id: 'usdc-kes',
  from: 'USDC',
  to: 'KES',
  countryCode: 'KE',
  countryName: 'Kenya',
}

const CORRIDOR_GHS: Corridor = {
  id: 'usdc-ghs',
  from: 'USDC',
  to: 'GHS',
  countryCode: 'GH',
  countryName: 'Ghana',
}

const CORRIDOR_MXN: Corridor = {
  id: 'usdc-mxn',
  from: 'USDC',
  to: 'MXN',
  countryCode: 'MX',
  countryName: 'Mexico',
}

const CORRIDOR_BRL: Corridor = {
  id: 'usdc-brl',
  from: 'USDC',
  to: 'BRL',
  countryCode: 'BR',
  countryName: 'Brazil',
}

const CORRIDOR_ARS: Corridor = {
  id: 'usdc-ars',
  from: 'USDC',
  to: 'ARS',
  countryCode: 'AR',
  countryName: 'Argentina',
}

const CORRIDOR_PEN: Corridor = {
  id: 'usdc-pen',
  from: 'USDC',
  to: 'PEN',
  countryCode: 'PE',
  countryName: 'Peru',
}

/** All supported corridors. */
export const CORRIDORS: Corridor[] = [
  CORRIDOR_NGN,
  CORRIDOR_KES,
  CORRIDOR_GHS,
  CORRIDOR_MXN,
  CORRIDOR_BRL,
  CORRIDOR_ARS,
  CORRIDOR_PEN,
] as const

// ─── Lookup helpers ───────────────────────────────────────────────────────────

/**
 * Returns the anchor with the given ID.
 * Throws a descriptive error if the ID is not found.
 */
export function getAnchorById(id: string): Anchor {
  const anchor = KNOWN_ANCHORS.find((a) => a.id === id)
  if (!anchor) {
    throw new Error(
      `Unknown anchor: "${id}". Valid IDs: ${KNOWN_ANCHORS.map((a) => a.id).join(', ')}`
    )
  }
  return anchor
}

/**
 * Returns all anchors that serve the given corridor.
 * Returns an empty array if no anchors support the corridor.
 */
export function getAnchorsByCorridorId(corridorId: string): Anchor[] {
  return KNOWN_ANCHORS.filter((a) => a.corridors.includes(corridorId))
}

/**
 * Resolves SEP-1 details for every known anchor that serves the corridor.
 * Failed anchors are omitted so callers can continue with the live subset.
 */
export async function discoverAnchorsForCorridor(corridorId: string): Promise<DiscoveredAnchor[]> {
  const { resolveToml } = await import('./sep1')
  const corridorAnchors = KNOWN_ANCHORS.filter((anchor) => anchor.corridors.includes(corridorId))

  const results = await Promise.allSettled(
    corridorAnchors.map(async (anchor): Promise<DiscoveredAnchor> => {
      const sep1 = await resolveToml(anchor.homeDomain)

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
