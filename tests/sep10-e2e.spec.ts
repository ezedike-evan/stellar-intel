import { authenticate, ChallengeError, SigningError, TokenExchangeError, InvalidChallengeError } from '../lib/stellar/sep10';
import { Keypair } from '@stellar/stellar-sdk';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';

// Mock anchor URL
const MOCK_ANCHOR_URL = 'https://mock-anchor.stellar.org';
const VALID_PUBLIC_KEY = 'GC3MMS3M3C7Z7D3Z7D3Z7D3Z7D3Z7D3Z7D3Z7D3Z';
const VALID_SECRET_KEY = 'S3M3C7Z7D3Z7D3Z7D3Z7D3Z7D3Z7D3Z7D3Z7D3Z';

describe('SEP-10 Authentication Helper', () => {
  let mockAxios: MockAdapter;

  beforeEach(() => {
    mockAxios = new MockAdapter(axios);
  });

  afterEach(() => {
    mockAxios.restore();
  });

  describe('Happy Path', () => {
    it('should complete authentication in under 2 seconds', async () => {
      // Mock challenge response
      const mockChallengeTx = 'AAAAAgAAA...'; // Mock XDR
      mockAxios.onGet(`${MOCK_ANCHOR_URL}/auth`).reply(200, {
        transaction: mockChallengeTx,
      });

      // Mock token exchange response
      mockAxios.onPost(`${MOCK_ANCHOR_URL}/auth`).reply(200, {
        token: 'mock-jwt-token-12345',
        expires_in: 3600,
      });

      const startTime = Date.now();
      const result = await authenticate(
        MOCK_ANCHOR_URL,
        VALID_PUBLIC_KEY,
        VALID_SECRET_KEY
      );
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(2000);
      expect(result).toHaveProperty('jwt');
      expect(result).toHaveProperty('expiresAt');
      expect(result.jwt).toBe('mock-jwt-token-12345');
      expect(result.expiresAt).toBeInstanceOf(Date);
    });
  });

  describe('Error Handling - Challenge Failed', () => {
    it('should throw ChallengeError when challenge request fails', async () => {
      mockAxios.onGet(`${MOCK_ANCHOR_URL}/auth`).reply(500, {
        message: 'Internal server error',
      });

      await expect(
        authenticate(MOCK_ANCHOR_URL, VALID_PUBLIC_KEY, VALID_SECRET_KEY)
      ).rejects.toThrow(ChallengeError);
    });

    it('should throw ChallengeError on network error', async () => {
      mockAxios.onGet(`${MOCK_ANCHOR_URL}/auth`).networkError();

      await expect(
        authenticate(MOCK_ANCHOR_URL, VALID_PUBLIC_KEY, VALID_SECRET_KEY)
      ).rejects.toThrow(ChallengeError);
    });

    it('should throw ChallengeError on timeout', async () => {
      mockAxios.onGet(`${MOCK_ANCHOR_URL}/auth`).timeout();

      await expect(
        authenticate(MOCK_ANCHOR_URL, VALID_PUBLIC_KEY, VALID_SECRET_KEY, { timeout: 100 })
      ).rejects.toThrow(ChallengeError);
    });
  });

  describe('Error Handling - Invalid Challenge', () => {
    it('should throw InvalidChallengeError when no transaction is returned', async () => {
      mockAxios.onGet(`${MOCK_ANCHOR_URL}/auth`).reply(200, {
        // No transaction field
      });

      await expect(
        authenticate(MOCK_ANCHOR_URL, VALID_PUBLIC_KEY, VALID_SECRET_KEY)
      ).rejects.toThrow(InvalidChallengeError);
    });

    it('should throw InvalidChallengeError when transaction XDR is malformed', async () => {
      mockAxios.onGet(`${MOCK_ANCHOR_URL}/auth`).reply(200, {
        transaction: 'invalid-base64-xdr',
      });

      await expect(
        authenticate(MOCK_ANCHOR_URL, VALID_PUBLIC_KEY, VALID_SECRET_KEY)
      ).rejects.toThrow(InvalidChallengeError);
    });
  });

  describe('Error Handling - Signing Failed', () => {
    it('should throw SigningError when secret key is invalid', async () => {
      const mockChallengeTx = 'AAAAAgAAA...'; // Mock XDR
      mockAxios.onGet(`${MOCK_ANCHOR_URL}/auth`).reply(200, {
        transaction: mockChallengeTx,
      });

      await expect(
        authenticate(MOCK_ANCHOR_URL, VALID_PUBLIC_KEY, 'invalid-secret-key')
      ).rejects.toThrow(SigningError);
    });
  });

  describe('Error Handling - Token Exchange Failed', () => {
    beforeEach(() => {
      const mockChallengeTx = 'AAAAAgAAA...'; // Mock XDR
      mockAxios.onGet(`${MOCK_ANCHOR_URL}/auth`).reply(200, {
        transaction: mockChallengeTx,
      });
    });

    it('should throw TokenExchangeError when token exchange fails', async () => {
      mockAxios.onPost(`${MOCK_ANCHOR_URL}/auth`).reply(401, {
        message: 'Unauthorized',
      });

      await expect(
        authenticate(MOCK_ANCHOR_URL, VALID_PUBLIC_KEY, VALID_SECRET_KEY)
      ).rejects.toThrow(TokenExchangeError);
    });

    it('should throw TokenExchangeError when no token is returned', async () => {
      mockAxios.onPost(`${MOCK_ANCHOR_URL}/auth`).reply(200, {
        // No token field
      });

      await expect(
        authenticate(MOCK_ANCHOR_URL, VALID_PUBLIC_KEY, VALID_SECRET_KEY)
      ).rejects.toThrow(TokenExchangeError);
    });

    it('should throw TokenExchangeError on network error during exchange', async () => {
      mockAxios.onPost(`${MOCK_ANCHOR_URL}/auth`).networkError();

      await expect(
        authenticate(MOCK_ANCHOR_URL, VALID_PUBLIC_KEY, VALID_SECRET_KEY)
      ).rejects.toThrow(TokenExchangeError);
    });
  });

  describe('Error Types Distinguishability', () => {
    it('should allow distinguishing between different error types', async () => {
      // ChallengeError
      mockAxios.onGet(`${MOCK_ANCHOR_URL}/auth`).reply(500);
      
      try {
        await authenticate(MOCK_ANCHOR_URL, VALID_PUBLIC_KEY, VALID_SECRET_KEY);
      } catch (error) {
        expect(error instanceof ChallengeError).toBe(true);
        expect(error instanceof SigningError).toBe(false);
        expect(error instanceof TokenExchangeError).toBe(false);
        expect(error instanceof InvalidChallengeError).toBe(false);
      }

      mockAxios.reset();
      mockAxios.onGet(`${MOCK_ANCHOR_URL}/auth`).reply(200, { transaction: 'invalid' });

      // InvalidChallengeError
      try {
        await authenticate(MOCK_ANCHOR_URL, VALID_PUBLIC_KEY, VALID_SECRET_KEY);
      } catch (error) {
        expect(error instanceof InvalidChallengeError).toBe(true);
        expect(error instanceof ChallengeError).toBe(false);
      }
    });
  });
});
