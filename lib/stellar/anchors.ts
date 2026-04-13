import type { Anchor, Corridor, StellarAsset } from '@/types'
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
 * Cowrie Exchange — Nigeria corridor (USDC → NGN).
 * SEP-24 anchor for Nigerian bank account withdrawals.
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
 * Flutterwave — Nigeria, Kenya, and Ghana corridors (USDC → NGN / KES / GHS).
 * SEP-24 anchor supporting bank transfer and mobile money.
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
 * Bitso — Mexico and Brazil corridors (USDC → MXN / BRL).
 * SEP-24 anchor for Latin American bank withdrawals.
 */
const BITSO: Anchor = {
  id: 'bitso',
  name: 'Bitso',
  homeDomain: 'bitso.com',
  corridors: ['usdc-mxn', 'usdc-brl'],
  assetCode: 'USDC',
  assetIssuer: USDC_ISSUER,
}

/** All supported anchors. */
export const ANCHORS: Anchor[] = [COWRIE, FLUTTERWAVE, BITSO] as const

/** Maps anchor ID → home domain for quick lookup during SEP-1 resolution. */
export const ANCHOR_HOME_DOMAINS: Record<string, string> = {
  cowrie: 'cowrie.exchange',
  flutterwave: 'flutterwave.com',
  bitso: 'bitso.com',
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

/** All supported corridors. */
export const CORRIDORS: Corridor[] = [
  CORRIDOR_NGN,
  CORRIDOR_KES,
  CORRIDOR_GHS,
  CORRIDOR_MXN,
  CORRIDOR_BRL,
] as const

// ─── Lookup helpers ───────────────────────────────────────────────────────────

/**
 * Returns the anchor with the given ID.
 * Throws a descriptive error if the ID is not found.
 */
export function getAnchorById(id: string): Anchor {
  const anchor = ANCHORS.find((a) => a.id === id)
  if (!anchor) {
    throw new Error(`Unknown anchor: "${id}". Valid IDs: ${ANCHORS.map((a) => a.id).join(', ')}`)
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
