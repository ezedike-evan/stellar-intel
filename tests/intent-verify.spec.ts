import { describe, expect, it } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { verifyIntentSignature } from '@/lib/intent/verify';

// A canonical 32-byte intent hash, hex-encoded (mirrors hashIntent output).
const INTENT_HASH = 'a'.repeat(64);

function sign(hashHex: string, kp: Keypair): string {
  return Buffer.from(kp.sign(Buffer.from(hashHex, 'hex'))).toString('base64');
}

describe('verifyIntentSignature', () => {
  it('accepts a valid Ed25519 signature over the intent hash', () => {
    const kp = Keypair.random();
    const signature = sign(INTENT_HASH, kp);
    expect(
      verifyIntentSignature({ intentHash: INTENT_HASH, publicKey: kp.publicKey(), signature })
    ).toBe(true);
  });

  it('rejects a signature from a different key', () => {
    const signer = Keypair.random();
    const other = Keypair.random();
    const signature = sign(INTENT_HASH, signer);
    expect(
      verifyIntentSignature({ intentHash: INTENT_HASH, publicKey: other.publicKey(), signature })
    ).toBe(false);
  });

  it('rejects a signature over a different hash', () => {
    const kp = Keypair.random();
    const signature = sign('b'.repeat(64), kp);
    expect(
      verifyIntentSignature({ intentHash: INTENT_HASH, publicKey: kp.publicKey(), signature })
    ).toBe(false);
  });

  it('accepts a SEP-53 signature over the hex hash (what Freighter signMessage produces)', () => {
    const kp = Keypair.random();
    const signature = Buffer.from(kp.signMessage(INTENT_HASH)).toString('base64');
    expect(
      verifyIntentSignature({ intentHash: INTENT_HASH, publicKey: kp.publicKey(), signature })
    ).toBe(true);
  });

  it('rejects a SEP-53 signature from a different key or over a different hash', () => {
    const kp = Keypair.random();
    const otherKey = Buffer.from(Keypair.random().signMessage(INTENT_HASH)).toString('base64');
    const otherHash = Buffer.from(kp.signMessage('b'.repeat(64))).toString('base64');
    expect(
      verifyIntentSignature({
        intentHash: INTENT_HASH,
        publicKey: kp.publicKey(),
        signature: otherKey,
      })
    ).toBe(false);
    expect(
      verifyIntentSignature({
        intentHash: INTENT_HASH,
        publicKey: kp.publicKey(),
        signature: otherHash,
      })
    ).toBe(false);
  });

  it('returns false (never throws) on malformed input', () => {
    expect(verifyIntentSignature({ intentHash: '', publicKey: 'not-a-key', signature: '' })).toBe(
      false
    );
    expect(
      verifyIntentSignature({ intentHash: INTENT_HASH, publicKey: 'GARBAGE', signature: '!!!' })
    ).toBe(false);
  });
});
