import { Networks, TransactionBuilder } from '@stellar/stellar-sdk'
import type { Transaction, FeeBumpTransaction } from '@stellar/stellar-sdk'
import { getWebAuthEndpoint } from './sep1'
import type { Sep10Auth } from '@/types'

// ─── Typed error ──────────────────────────────────────────────────────────────

export type ChallengeErrorCode = 'FETCH_FAILED' | 'MISSING_FIELD' | 'WRONG_NETWORK' | 'INVALID_XDR'

export class ChallengeError extends Error {
  constructor(
    message: string,
    public readonly code: ChallengeErrorCode
  ) {
    super(message)
    this.name = 'ChallengeError'
  }
}

// ─── Challenge types ──────────────────────────────────────────────────────────

export interface Sep10Challenge {
  transaction: string
  network_passphrase: string
  parsed: Transaction | FeeBumpTransaction
}

// ─── fetchSep10Challenge ──────────────────────────────────────────────────────

export async function fetchSep10Challenge(
  webAuthEndpoint: string,
  publicKey: string,
  homeDomain: string
): Promise<Sep10Challenge> {
  const url = new URL(webAuthEndpoint)
  url.searchParams.set('account', publicKey)
  url.searchParams.set('home_domain', homeDomain)

  let res: Response
  try {
    res = await fetch(url.toString())
  } catch (err) {
    throw new ChallengeError(
      `Network error fetching challenge from ${webAuthEndpoint}: ${String(err)}`,
      'FETCH_FAILED'
    )
  }

  if (!res.ok) {
    throw new ChallengeError(
      `Challenge fetch failed: HTTP ${res.status} from ${webAuthEndpoint}`,
      'FETCH_FAILED'
    )
  }

  const data = (await res.json()) as Record<string, unknown>

  const transaction = data['transaction']
  if (!transaction || typeof transaction !== 'string') {
    throw new ChallengeError(
      `Missing "transaction" field in challenge response from ${webAuthEndpoint}`,
      'MISSING_FIELD'
    )
  }

  const network_passphrase = data['network_passphrase']
  if (!network_passphrase || typeof network_passphrase !== 'string') {
    throw new ChallengeError(
      `Missing "network_passphrase" field in challenge response from ${webAuthEndpoint}`,
      'MISSING_FIELD'
    )
  }

  if (network_passphrase !== Networks.PUBLIC) {
    throw new ChallengeError(
      `Challenge is for wrong network: "${network_passphrase}". Expected Stellar mainnet.`,
      'WRONG_NETWORK'
    )
  }

  let parsed: Transaction | FeeBumpTransaction
  try {
    parsed = TransactionBuilder.fromXDR(transaction, network_passphrase)
  } catch {
    throw new ChallengeError(
      `Challenge XDR is not parseable from ${webAuthEndpoint}`,
      'INVALID_XDR'
    )
  }

  return { transaction, network_passphrase, parsed }
}

// ─── Challenge fetch ──────────────────────────────────────────────────────────

export async function fetchChallenge(
  webAuthEndpoint: string,
  publicKey: string
): Promise<{ transaction: string; network_passphrase: string }> {
  const url = new URL(webAuthEndpoint)
  url.searchParams.set('account', publicKey)

  const res = await fetch(url.toString())
  if (!res.ok) {
    throw new Error(`Challenge fetch failed: HTTP ${res.status} from ${webAuthEndpoint}`)
  }

  const data = (await res.json()) as Record<string, unknown>

  const transaction = data['transaction']
  if (!transaction || typeof transaction !== 'string') {
    throw new Error(`Missing "transaction" field in challenge response from ${webAuthEndpoint}`)
  }

  const network_passphrase = data['network_passphrase']
  if (!network_passphrase || typeof network_passphrase !== 'string') {
    throw new Error(
      `Missing "network_passphrase" field in challenge response from ${webAuthEndpoint}`
    )
  }

  if (network_passphrase !== Networks.PUBLIC) {
    throw new Error(
      `Challenge is for wrong network: "${network_passphrase}". Expected Stellar mainnet.`
    )
  }

  return { transaction, network_passphrase }
}

// ─── Challenge signing ────────────────────────────────────────────────────────

export async function signChallenge(
  challengeXdr: string,
  networkPassphrase: string
): Promise<string> {
  const { signTransaction } = await import('@stellar/freighter-api')
  const result = await signTransaction(challengeXdr, { networkPassphrase })

  if (result.error) {
    throw new Error('User rejected signing')
  }

  return result.signedTxXdr
}

// ─── JWT exchange ─────────────────────────────────────────────────────────────

export async function submitChallenge(
  webAuthEndpoint: string,
  signedXdr: string
): Promise<string> {
  const res = await fetch(webAuthEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction: signedXdr }),
  })

  if (!res.ok) {
    throw new Error(`JWT exchange failed: HTTP ${res.status} from ${webAuthEndpoint}`)
  }

  const data = (await res.json()) as Record<string, unknown>
  const token = data['token']

  if (!token || typeof token !== 'string') {
    throw new Error(`Missing "token" field in JWT response from ${webAuthEndpoint}`)
  }

  return token
}

// ─── Full auth orchestrator ───────────────────────────────────────────────────

export async function authenticate(
  anchorDomain: string,
  publicKey: string
): Promise<Sep10Auth> {
  const webAuthEndpoint = await getWebAuthEndpoint(anchorDomain)
  if (!webAuthEndpoint) {
    throw new Error(`Anchor "${anchorDomain}" does not support SEP-10 authentication.`)
  }
  const { transaction, network_passphrase } = await fetchChallenge(webAuthEndpoint, publicKey)
  const signedXdr = await signChallenge(transaction, network_passphrase)
  const jwt = await submitChallenge(webAuthEndpoint, signedXdr)

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

  return { jwt, anchorDomain, publicKey, expiresAt }
}
