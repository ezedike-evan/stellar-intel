import { Keypair, StrKey, xdr } from '@stellar/stellar-sdk';
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

export class ChallengeError extends Sep10Error {
  constructor(message: string) {
    super(`Challenge request failed: ${message}`);
    this.name = 'ChallengeError';
  }
}

export class SigningError extends Sep10Error {
  constructor(message: string) {
    super(`Failed to sign challenge: ${message}`);
    this.name = 'SigningError';
  }
}

export class TokenExchangeError extends Sep10Error {
  constructor(message: string) {
    super(`Token exchange failed: ${message}`);
    this.name = 'TokenExchangeError';
  }
}

export class InvalidChallengeError extends Sep10Error {
  constructor(message: string) {
    super(`Invalid challenge received: ${message}`);
    this.name = 'InvalidChallengeError';
  }
}

export async function authenticate(
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
  const httpClient = options?.httpClient || axios.create({ timeout });

  // Step 1: Request challenge from anchor
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
        error.response?.data?.message || error.message || 'Network error'
      );
    }
    throw new ChallengeError(String(error));
  }

  // Step 2: Validate challenge
  if (!challengeResponse.transaction) {
    throw new InvalidChallengeError('No transaction envelope in challenge');
  }

  // Step 3: Decode and verify the challenge transaction
  let transaction: xdr.TransactionEnvelope;
  try {
    const envelopeXdr = challengeResponse.transaction;
    transaction = xdr.TransactionEnvelope.fromXDR(envelopeXdr, 'base64');
  } catch (error) {
    throw new InvalidChallengeError('Failed to decode transaction XDR');
  }

  // Step 4: Sign the challenge with the provided secret key
  let signedTransaction: string;
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
    
    signedTransaction = newTx.toXDR('base64');
  } catch (error) {
    if (error instanceof InvalidChallengeError) {
      throw error;
    }
    throw new SigningError(error instanceof Error ? error.message : 'Unknown signing error');
  }

  // Step 5: Exchange signed challenge for JWT token
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
      throw new TokenExchangeError(error.response?.data?.message || error.message || 'Token exchange failed');
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
