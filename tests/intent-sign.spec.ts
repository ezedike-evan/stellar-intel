import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signIntent, signHash, IntentSignError } from '@/lib/intent/sign';
import { hashIntent } from '@/lib/intent/hash';
import type { Intent } from '@/lib/intent/hash';
import type { SignedIntentEnvelope } from '@/lib/intent/sign';

vi.mock('@stellar/freighter-api', () => ({
  signMessage: vi.fn(),
  getAddress: vi.fn(),
}));

async function getApi() {
  return await import('@stellar/freighter-api');
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SENDER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

const INTENT: Intent = {
  type: 'offramp',
  sourceAsset: 'USDC',
  destinationAsset: 'NGN',
  amount: '100',
  sender: SENDER,
  recipient: 'NGN-BANK-ACCOUNT-123',
};

const MOCK_SIGNATURE = 'base64mocksignaturestring==';
// hashIntent is async; resolve it before each test so comparisons use the
// string digest rather than a pending Promise.
let EXPECTED_HASH: string;

beforeEach(async () => {
  vi.clearAllMocks();
  EXPECTED_HASH = await hashIntent(INTENT);
  const api = await getApi();
  vi.mocked(api.signMessage).mockResolvedValue({ signedMessage: MOCK_SIGNATURE } as never);
  vi.mocked(api.getAddress).mockResolvedValue({ address: SENDER } as never);
});

// ─── Happy path ────────────────────────────────────────────────────────────────

describe('signIntent — happy path', () => {
  it('returns an envelope with intentHash, signature, and publicKey', async () => {
    const envelope = await signIntent(INTENT);
    expect(envelope).toHaveProperty('intentHash');
    expect(envelope).toHaveProperty('signature');
    expect(envelope).toHaveProperty('publicKey');
  });

  it('intentHash matches the canonical SHA-256 hash of the intent', async () => {
    const envelope = await signIntent(INTENT);
    expect(envelope.intentHash).toBe(EXPECTED_HASH);
  });

  it('publicKey matches the address returned by Freighter', async () => {
    const envelope = await signIntent(INTENT);
    expect(envelope.publicKey).toBe(SENDER);
  });

  it('signature is the value returned by Freighter signMessage', async () => {
    const envelope = await signIntent(INTENT);
    expect(envelope.signature).toBe(MOCK_SIGNATURE);
  });

  it('passes the intent hash (not raw intent) to Freighter signMessage', async () => {
    const api = await getApi();
    await signIntent(INTENT);
    expect(vi.mocked(api.signMessage)).toHaveBeenCalledWith(EXPECTED_HASH);
  });

  it('accepts a Freighter response with signature field instead of signedMessage', async () => {
    const api = await getApi();
    vi.mocked(api.signMessage).mockResolvedValue({ signature: 'alt-sig-value' } as never);
    const envelope = await signIntent(INTENT);
    expect(envelope.signature).toBe('alt-sig-value');
  });

  it('accepts a Freighter getAddress response with publicKey field', async () => {
    const api = await getApi();
    vi.mocked(api.getAddress).mockResolvedValue({ publicKey: SENDER } as never);
    const envelope = await signIntent(INTENT);
    expect(envelope.publicKey).toBe(SENDER);
  });
});

// ─── Error paths ──────────────────────────────────────────────────────────────

describe('signIntent — error paths', () => {
  it('throws IntentSignError with SIGN_FAILED when signMessage resolves with error field', async () => {
    const api = await getApi();
    vi.mocked(api.signMessage).mockResolvedValue({ error: 'Unknown error' } as never);

    const signing = signIntent(INTENT);
    await expect(signing).rejects.toMatchObject({ name: 'IntentSignError', code: 'SIGN_FAILED' });
    await expect(signing).rejects.toBeInstanceOf(IntentSignError);
  });

  it('throws IntentSignError with SIGN_REJECTED when error message contains "reject"', async () => {
    const api = await getApi();
    vi.mocked(api.signMessage).mockResolvedValue({ error: 'User rejected the request' } as never);

    const signing = signIntent(INTENT);
    await expect(signing).rejects.toMatchObject({ name: 'IntentSignError', code: 'SIGN_REJECTED' });
    await expect(signing).rejects.toBeInstanceOf(IntentSignError);
  });

  it('throws IntentSignError with SIGN_FAILED when signMessage rejects', async () => {
    const api = await getApi();
    vi.mocked(api.signMessage).mockRejectedValue(new Error('Extension error'));

    const signing = signIntent(INTENT);
    await expect(signing).rejects.toMatchObject({ name: 'IntentSignError', code: 'SIGN_FAILED' });
    await expect(signing).rejects.toBeInstanceOf(IntentSignError);
  });

  it('throws IntentSignError with FREIGHTER_UNAVAILABLE when getAddress returns no key', async () => {
    const api = await getApi();
    vi.mocked(api.getAddress).mockResolvedValue({} as never);

    const signing = signIntent(INTENT);
    await expect(signing).rejects.toMatchObject({
      name: 'IntentSignError',
      code: 'FREIGHTER_UNAVAILABLE',
    });
    await expect(signing).rejects.toBeInstanceOf(IntentSignError);
  });

  it('throws IntentSignError with SIGN_FAILED when signature is empty string', async () => {
    const api = await getApi();
    vi.mocked(api.signMessage).mockResolvedValue({ signedMessage: '' } as never);

    const signing = signIntent(INTENT);
    await expect(signing).rejects.toMatchObject({ name: 'IntentSignError', code: 'SIGN_FAILED' });
    await expect(signing).rejects.toBeInstanceOf(IntentSignError);
  });

  it('IntentSignError has a descriptive message', async () => {
    const api = await getApi();
    vi.mocked(api.signMessage).mockResolvedValue({ error: 'Signing timed out' } as never);

    const signing = signIntent(INTENT);
    await expect(signing).rejects.toMatchObject({ name: 'IntentSignError', code: 'SIGN_FAILED' });
    await expect(signing).rejects.toBeInstanceOf(IntentSignError);
    await expect(signing).rejects.toThrow(/\S/);
  });
});

// ─── Determinism ──────────────────────────────────────────────────────────────

describe('signIntent — envelope determinism', () => {
  it('two calls with the same intent produce the same intentHash', async () => {
    const e1 = await signIntent(INTENT);
    const e2 = await signIntent(INTENT);
    expect(e1.intentHash).toBe(e2.intentHash);
  });

  it('different amounts produce different intentHashes', async () => {
    const other: Intent = { ...INTENT, amount: '999' };
    const e1 = await signIntent(INTENT);
    const e2 = await signIntent(other);
    expect(e1.intentHash).not.toBe(e2.intentHash);
  });
});

// ─── signHash ─────────────────────────────────────────────────────────────────

describe('signHash', () => {
  const VALID_HASH = 'a'.repeat(64);

  it('signs a valid 64 lowercase hex hash and returns envelope', async () => {
    const envelope = await signHash(VALID_HASH);
    expect(envelope).toEqual({
      intentHash: VALID_HASH,
      signature: MOCK_SIGNATURE,
      publicKey: SENDER,
    });
    const api = await getApi();
    expect(vi.mocked(api.signMessage)).toHaveBeenCalledWith(VALID_HASH);
  });

  it('rejects hashes that are not 64 characters long', async () => {
    const api = await getApi();
    const tooShort = 'a'.repeat(63);
    const tooLong = 'a'.repeat(65);
    const empty = '';

    for (const invalid of [tooShort, tooLong, empty]) {
      const promise = signHash(invalid);
      await expect(promise).rejects.toMatchObject({
        name: 'IntentSignError',
        code: 'SIGN_FAILED',
        message: 'hash must be 64 lowercase hex chars',
      });
      await expect(promise).rejects.toBeInstanceOf(IntentSignError);
    }

    expect(vi.mocked(api.signMessage)).not.toHaveBeenCalled();
  });

  it('rejects hashes containing uppercase hex characters', async () => {
    const api = await getApi();
    const uppercase = 'A'.repeat(64);
    const mixed = 'a'.repeat(63) + 'F';

    for (const invalid of [uppercase, mixed]) {
      const promise = signHash(invalid);
      await expect(promise).rejects.toMatchObject({
        name: 'IntentSignError',
        code: 'SIGN_FAILED',
        message: 'hash must be 64 lowercase hex chars',
      });
      await expect(promise).rejects.toBeInstanceOf(IntentSignError);
    }

    expect(vi.mocked(api.signMessage)).not.toHaveBeenCalled();
  });

  it('rejects hashes containing non-hex characters', async () => {
    const api = await getApi();
    const nonHex = 'g'.repeat(64);
    const withPunctuation = 'a'.repeat(63) + '!';

    for (const invalid of [nonHex, withPunctuation]) {
      const promise = signHash(invalid);
      await expect(promise).rejects.toMatchObject({
        name: 'IntentSignError',
        code: 'SIGN_FAILED',
        message: 'hash must be 64 lowercase hex chars',
      });
      await expect(promise).rejects.toBeInstanceOf(IntentSignError);
    }

    expect(vi.mocked(api.signMessage)).not.toHaveBeenCalled();
  });

  it('propagates Freighter errors during signHash', async () => {
    const api = await getApi();
    vi.mocked(api.signMessage).mockResolvedValue({ error: 'User rejected the request' } as never);

    const promise = signHash(VALID_HASH);
    await expect(promise).rejects.toMatchObject({
      name: 'IntentSignError',
      code: 'SIGN_REJECTED',
    });
  });
});
