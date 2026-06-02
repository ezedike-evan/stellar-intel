import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { redactIntent, hashIntent, PII_FIELDS, type RawIntent } from '@/lib/reputation/redact';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const nonEmptyString = fc.string({ minLength: 1, maxLength: 64 });

const rawIntentArb = fc.record<RawIntent>({
  recipientAccount: nonEmptyString,
  recipientName: nonEmptyString,
  recipientEmail: nonEmptyString,
  recipientPhone: nonEmptyString,
  bankAccount: nonEmptyString,
  account: nonEmptyString,
  amount: fc.double({ min: 1, max: 1_000_000, noNaN: true, noDefaultInfinity: true }).map(String),
  assetCode: fc.constantFrom('USDC', 'EURC', 'XLM'),
  assetIssuer: nonEmptyString,
  corridorId: fc.constantFrom('usdc-ngn', 'usdc-kes', 'usdc-ghs', 'usdc-zar'),
  anchorId: nonEmptyString,
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('redactIntent', () => {
  it('produces zero PII fields in the written row', () => {
    fc.assert(
      fc.property(rawIntentArb, (intent) => {
        const redacted = redactIntent(intent);

        for (const field of PII_FIELDS) {
          expect(redacted).not.toHaveProperty(field);
        }
      }),
      { numRuns: 1000 }
    );
  });

  it('produces zero PII bytes in the serialised written row', () => {
    fc.assert(
      fc.property(rawIntentArb, (intent) => {
        const redacted = redactIntent(intent);

        // The redacted row must contain exactly these four keys and no others.
        // Any extra key would be a PII leak.
        const allowedKeys = new Set(['intentHash', 'assetCode', 'corridorId', 'anchorId']);
        const actualKeys = Object.keys(redacted);

        for (const key of actualKeys) {
          expect(allowedKeys).toContain(key);
        }

        expect(actualKeys).toHaveLength(allowedKeys.size);
      }),
      { numRuns: 1000 }
    );
  });

  it('always stores the intent hash', () => {
    fc.assert(
      fc.property(rawIntentArb, (intent) => {
        const redacted = redactIntent(intent);
        expect(typeof redacted.intentHash).toBe('string');
        expect(redacted.intentHash).toHaveLength(64); // SHA-256 hex = 64 chars
      }),
      { numRuns: 1000 }
    );
  });

  it('always preserves non-PII routing fields', () => {
    fc.assert(
      fc.property(rawIntentArb, (intent) => {
        const redacted = redactIntent(intent);
        expect(redacted.assetCode).toBe(intent.assetCode);
        expect(redacted.corridorId).toBe(intent.corridorId);
        expect(redacted.anchorId).toBe(intent.anchorId);
      }),
      { numRuns: 1000 }
    );
  });

  it('is deterministic — same intent always yields the same hash', () => {
    fc.assert(
      fc.property(rawIntentArb, (intent) => {
        expect(redactIntent(intent).intentHash).toBe(redactIntent(intent).intentHash);
      }),
      { numRuns: 500 }
    );
  });

  it('produces different hashes for different intents', () => {
    fc.assert(
      fc.property(rawIntentArb, rawIntentArb, (a, b) => {
        // Stringify both to compare structural equality
        if (JSON.stringify(a) !== JSON.stringify(b)) {
          expect(hashIntent(a)).not.toBe(hashIntent(b));
        }
      }),
      { numRuns: 500 }
    );
  });
});
