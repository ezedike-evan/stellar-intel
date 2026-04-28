import { Keypair, TransactionBuilder, Networks } from 'stellar-sdk';

export class ChallengeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChallengeError';
  }
}

export class SigningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SigningError';
  }
}

export class ExchangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExchangeError';
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

export interface AuthResult {
  jwt: string;
  expiresAt: string;
}

export interface AnchorConfig {
  serverUrl: string;
  network: 'testnet' | 'public';
  timeout?: number;
}

export async function authenticate(
  anchor: AnchorConfig,
  publicKey: string,
  secretKey: string
): Promise<AuthResult> {
  const timeout = anchor.timeout || 2000;
  
  try {
    // Step 1: Get challenge
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const challengeUrl = `${anchor.serverUrl}/auth?account=${publicKey}`;
    const challengeRes = await fetch(challengeUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!challengeRes.ok) {
      throw new ChallengeError(`HTTP ${challengeRes.status}`);
    }
    
    const challengeData = await challengeRes.json();
    if (!challengeData.transaction) {
      throw new ChallengeError('Missing transaction field');
    }
    
    // Step 2: Sign challenge
    const keypair = Keypair.fromSecret(secretKey);
    if (keypair.publicKey() !== publicKey) {
      throw new SigningError('Key mismatch');
    }
    
    const transaction = TransactionBuilder.fromXDR(challengeData.transaction, Networks.TESTNET);
    transaction.sign(keypair);
    const signedXdr = transaction.toXDR();
    
    // Step 3: Exchange for token
    const exchangeRes = await fetch(`${anchor.serverUrl}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction: signedXdr })
    });
    
    if (!exchangeRes.ok) {
      throw new ExchangeError(`HTTP ${exchangeRes.status}`);
    }
    
    const tokenData = await exchangeRes.json();
    const jwt = tokenData.token || tokenData.jwt;
    
    if (!jwt) {
      throw new ExchangeError('No token in response');
    }
    
    return {
      jwt: jwt,
      expiresAt: new Date(Date.now() + 3600000).toISOString()
    };
    
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new NetworkError(`Timeout after ${timeout}ms`);
    }
    if (error instanceof ChallengeError || 
        error instanceof SigningError || 
        error instanceof ExchangeError ||
        error instanceof NetworkError) {
      throw error;
    }
    throw new ExchangeError(`Unexpected: ${error.message}`);
  }
}
