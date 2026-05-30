import { Keypair, StrKey, xdr, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import type { Transaction, FeeBumpTransaction } from '@stellar/stellar-sdk';
import axios, { AxiosInstance } from 'axios';

// Types
export interface Sep10AuthResult {
  jwt: string;
  expiresAt: Date;
}

export interface Sep10ChallengeResponse {
  transaction: string;
  network_passphrase?: string;
}

export interface Sep10TokenResponse {
  token: string;
  expires_in?: number;
}

// Custom Error Types
export class Sep10Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Sep10Error';
  }
}

export type ChallengeErrorCode = 'FETCH_FAILED' | 'MISSING_FIELD' | 'WRONG_NETWORK' | 'INVALID_XDR';

export class ChallengeError extends Sep10Error {
  constructor(message: string, public readonly code?: ChallengeErrorCode) {
    super(`Challenge request failed: ${message}`);
    this.name = 'ChallengeError';
  }
}

export class InvalidChallengeError extends Sep10Error {
  constructor(message: string) {
    super(`Invalid challenge received: ${message}`);
    this.name = 'InvalidChallengeError';
  }
}

export class SigningError extends Sep10Error {
  constructor(message: string) {
    super(`Failed to sign challenge: ${message}`);
    this.name = 'SigningError';
  }
}

export class TokenExchangeError extends Sep10Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(`Token exchange failed: ${message}`);
    this.name = 'TokenExchangeError';
  }
}

export class UserRejectedError extends Sep10Error {
  constructor() {
    super('User rejected the signature request');
    this.name = 'UserRejectedError';
  }
}

// ─── Challenge fetch ──────────────────────────────────────────────────────────

export async function fetchChallenge(
  webAuthEndpoint: string,
  publicKey: string,
  signal?: AbortSignal
): Promise<{ transaction: string; network_passphrase: string }> {
  const url = new URL(webAuthEndpoint);
  url.searchParams.set('account', publicKey);

  const res = await fetch(url.toString(), { signal });
  if (!res.ok) {
    throw new ChallengeError(
      `HTTP ${res.status} from ${webAuthEndpoint}`,
      'FETCH_FAILED'
    );
  }

  const data = (await res.json()) as Record<string, unknown>;

  const transaction = data['transaction'];
  if (!transaction || typeof transaction !== 'string') {
    throw new ChallengeError(
      `Missing "transaction" field in challenge response from ${webAuthEndpoint}`,
      'MISSING_FIELD'
    );
  }

  const network_passphrase = (data['network_passphrase'] as string) || Networks.PUBLIC;

  return { transaction, network_passphrase };
}

// ─── Challenge signing (with secret key) ──────────────────────────────────────

export async function signChallengeWithSecret(
  challengeXdr: string,
  secretKey: string,
  publicKey: string,
  networkPassphrase: string
): Promise<string> {
  let transaction: xdr.TransactionEnvelope;
  try {
    transaction = xdr.TransactionEnvelope.fromXDR(challengeXdr, 'base64');
  } catch (error) {
    throw new InvalidChallengeError('Failed to decode transaction XDR');
  }

  try {
    const keypair = Keypair.fromSecret(secretKey);
    const sourceAccount = transaction.v1().tx().sourceAccount();
    
    const accountId = StrKey.encodeEd25519PublicKey(sourceAccount.ed25519());
    if (accountId !== publicKey) {
      throw new InvalidChallengeError('Challenge is not for the provided account');
    }

    const signature = keypair.signDecorated(transaction.v1().tx().hash());
    const signatures = transaction.v1().signatures();
    signatures.push(signature);
    
    const newTx = new xdr.TransactionEnvelope.envelopeTypeTx(
      new xdr.TransactionV1Envelope({
        tx: transaction.v1().tx(),
        signatures: signatures,
      })
    );
    
    return newTx.toXDR('base64');
  } catch (error) {
    if (error instanceof InvalidChallengeError) {
      throw error;
    }
    throw new SigningError(error instanceof Error ? error.message : 'Unknown signing error');
  }
}

// ─── Challenge signing (with Freighter wallet) ────────────────────────────────

export async function signChallengeWithFreighter(
  challengeXdr: string,
  networkPassphrase: string
): Promise<string> {
  const { signTransaction } = await import('@stellar/freighter-api');
  const result = await signTransaction(challengeXdr, { networkPassphrase });

  if (result.error) {
    throw new UserRejectedError();
  }

  return result.signedTxXdr;
}

// ─── JWT exchange ─────────────────────────────────────────────────────────────

export async function submitChallenge(
  webAuthEndpoint: string,
  signedXdr: string,
  signal?: AbortSignal
): Promise<{ token: string; expiresAt: Date }> {
  const res = await fetch(webAuthEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction: signedXdr }),
    signal,
  });

  if (!res.ok) {
    let errorMessage = `JWT exchange failed: HTTP ${res.status}`;
    try {
      const errorData = await res.json();
      errorMessage = errorData.message || errorMessage;
    } catch {
      // Use default error message
    }
    throw new TokenExchangeError(errorMessage, res.status);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const token = data['token'];
  
  if (!token || typeof token !== 'string') {
    throw new TokenExchangeError('No token received from anchor');
  }

  const expiresIn = (data['expires_in'] as number) || 3600;
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  return { token, expiresAt };
}

// ─── Main authenticate function (secret key version) ─────────────────────────

export async function authenticateWithSecret(
  anchorUrl: string,
  publicKey: string,
  secretKey: string,
  options?: {
    timeout?: number;
    networkPassphrase?: string;
    httpClient?: AxiosInstance;
  }
): Promise<Sep10AuthResult> {
  const timeout = options?.timeout || 10000;
  const networkPassphrase = options?.networkPassphrase || Networks.PUBLIC;
  const httpClient = options?.httpClient || axios.create({ timeout });

  // Step 1: Request challenge
  let challengeResponse: Sep10ChallengeResponse;
  try {
    const response = await httpClient.get(`${anchorUrl}/auth`, {
      params: { account: publicKey },
      timeout,
    });
    challengeResponse = response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new ChallengeError(
        error.response?.data?.message || error.message || 'Network error',
        'FETCH_FAILED'
      );
    }
    throw new ChallengeError(String(error), 'FETCH_FAILED');
  }

  if (!challengeResponse.transaction) {
    throw new InvalidChallengeError('No transaction envelope in challenge');
  }

  // Step 2: Sign challenge
  const signedTransaction = await signChallengeWithSecret(
    challengeResponse.transaction,
    secretKey,
    publicKey,
    challengeResponse.network_passphrase || networkPassphrase
  );

  // Step 3: Exchange for JWT
  let tokenResponse: Sep10TokenResponse;
  try {
    const response = await httpClient.post(
      `${anchorUrl}/auth`,
      { transaction: signedTransaction },
      { headers: { 'Content-Type': 'application/json' }, timeout }
    );
    tokenResponse = response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new TokenExchangeError(
        error.response?.data?.message || error.message || 'Token exchange failed',
        error.response?.status
      );
    }
    throw new TokenExchangeError(String(error));
  }

  if (!tokenResponse.token) {
    throw new TokenExchangeError('No token received from anchor');
  }

  const expiresIn = tokenResponse.expires_in || 3600;
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  return { jwt: tokenResponse.token, expiresAt };
}

// ─── Main authenticate function (Freighter wallet version) ───────────────────

export interface ResolvedAnchor {
  homeDomain: string;
  WEB_AUTH_ENDPOINT?: string;
  capabilities?: {
    sep10?: boolean;
  };
}

export interface Sep10Auth {
  jwt: string;
  anchorDomain: string;
  publicKey: string;
  expiresAt: Date;
}

// Cache functions (import from jwt-cache or implement inline)
let jwtCache: Map<string, Sep10Auth> = new Map();

function getCachedJwt(anchorDomain: string, publicKey: string): Sep10Auth | null {
  const key = `${anchorDomain}:${publicKey}`;
  const cached = jwtCache.get(key);
  if (cached && cached.expiresAt > new Date()) {
    return cached;
  }
  jwtCache.delete(key);
  return null;
}

function setCachedJwt(auth: Sep10Auth): void {
  const key = `${auth.anchorDomain}:${auth.publicKey}`;
  jwtCache.set(key, auth);
}

export function invalidateCachedJwt(anchorDomain: string, publicKey: string): void {
  const key = `${anchorDomain}:${publicKey}`;
  jwtCache.delete(key);
}

export async function authenticateWithWallet(
  anchor: ResolvedAnchor,
  publicKey: string,
  signal?: AbortSignal
): Promise<Sep10Auth> {
  const cached = getCachedJwt(anchor.homeDomain, publicKey);
  if (cached) return cached;

  const webAuthEndpoint = anchor.WEB_AUTH_ENDPOINT;
  if (!webAuthEndpoint || !anchor.capabilities?.sep10) {
    throw new Error(`Anchor "${anchor.homeDomain}" does not support SEP-10 authentication.`);
  }

  const { transaction, network_passphrase } = await fetchChallenge(webAuthEndpoint, publicKey, signal);
  const signedXdr = await signChallengeWithFreighter(transaction, network_passphrase);
  const { token: jwt, expiresAt } = await submitChallenge(webAuthEndpoint, signedXdr, signal);

  const auth: Sep10Auth = { jwt, anchorDomain: anchor.homeDomain, publicKey, expiresAt };
  setCachedJwt(auth);
  return auth;
}

// ─── Default export for backward compatibility ───────────────────────────────

export async function authenticate(
  anchorUrlOrObject: string | ResolvedAnchor,
  publicKey: string,
  secretKeyOrSignal?: string | AbortSignal,
  options?: {
    timeout?: number;
    networkPassphrase?: string;
    httpClient?: AxiosInstance;
  }
): Promise<Sep10AuthResult | Sep10Auth> {
  // If first param is string (anchorUrl), use secret key flow
  if (typeof anchorUrlOrObject === 'string') {
    const secretKey = secretKeyOrSignal as string;
    if (!secretKey) {
      throw new Error('Secret key is required for authentication with anchor URL');
    }
    return authenticateWithSecret(anchorUrlOrObject, publicKey, secretKey, options);
  }
  
  // Otherwise, use wallet flow
  const signal = secretKeyOrSignal instanceof AbortSignal ? secretKeyOrSignal : undefined;
  return authenticateWithWallet(anchorUrlOrObject, publicKey, signal);
}

// ─── Token validation ─────────────────────────────────────────────────────────

export async function validateToken(
  jwt: string,
  anchorUrl: string,
  options?: { timeout?: number; httpClient?: AxiosInstance }
): Promise<boolean> {
  const timeout = options?.timeout || 5000;
  const httpClient = options?.httpClient || axios.create({ timeout });

  try {
    const response = await httpClient.get(`${anchorUrl}/auth/validate`, {
      headers: { Authorization: `Bearer ${jwt}` },
      timeout,
    });
    return response.status === 200 && response.data?.valid === true;
  } catch {
    return false;
  }
}

/**
 * Drop the cached JWT for this anchor/account pair. Call this when a
 * downstream anchor request returns 401, so the next `authenticate` call
 * re-runs the full sign flow.
 */
export function invalidateSep10Token(anchorDomain: string, publicKey: string): void {
  invalidateCachedJwt(anchorDomain, publicKey);
}