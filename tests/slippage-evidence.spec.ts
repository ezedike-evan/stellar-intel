import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  buildSlippageEvidence,
  withOnChainEvidence,
  canonicalEvidenceJson,
  hashSlippageEvidence,
  type SlippageEvidence,
  type SlippageOnChainEvidence,
  type SlippageEvaluation,
} from '@/lib/reputation/slippage-evidence';
import { NETWORK_PASSPHRASE } from '@/lib/config';
import type { OutcomeLogRow } from '@/types/reputation';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FIXTURE_ROW: OutcomeLogRow = {
  intentHash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
  anchorId: 'test-anchor',
  corridor: 'usdc-ngn',
  direction: 'withdraw',
  quotedRate: '1500.00',
  deliveredRate: '1425.00',
  quotedAmount: '100.00',
  deliveredAmount: '950.00',
  settleSeconds: 30,
  outcome: 'completed',
  createdAt: '2026-11-22T10:00:00.000Z',
  stellarTransactionId: 'tx-stellar-123',
  reconciledAt: '2026-11-22T10:01:00.000Z',
  disputed: false,
  disputedReason: null,
  publishedAt: null,
  oracleTxHash: null,
  attested: true,
  signerAccount: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  minReceive: '1000.00',
};

const BREACH_EVALUATION: Extract<SlippageEvaluation, { kind: 'breach' }> = {
  kind: 'breach',
  shortfall: '50.00',
  shortfallBps: 500,
};

const ON_CHAIN_FIXTURE: SlippageOnChainEvidence = {
  txHash: 'stellar-payment-tx-hash-123',
  ledger: 12345678,
  closedAt: '2026-11-22T12:05:00.000Z',
  successful: true,
  from: 'GANCHORACCOUNT12345678901234567890123456789012345678901234567890',
  to: 'GUSERACCOUNT12345678901234567890123456789012345678901234567890',
  assetCode: 'USDC',
  assetIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  amount: '950.00',
  memoType: 'text',
  memo: 'test-memo',
};

// Fixed known-answer fixture
const KNOWN_EVIDENCE: SlippageEvidence = {
  v: 1,
  networkPassphrase: 'Test SDF Network ; September 2015',
  intentHash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
  anchorId: 'test-anchor',
  corridor: 'usdc-ngn',
  signerAccount: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  minReceive: '1000.00',
  anchorReported: {
    anchorTransactionId: 'anchor-tx-123',
    amountOut: '950.00',
    reportedBy: 'sender',
  },
  shortfall: '50.00',
  shortfallBps: 500,
  onChain: null,
  detectedAt: '2026-11-22T12:00:00.000Z',
};

// Literal expected canonical string for KNOWN_EVIDENCE:
// Keys recursively sorted alphabetically, no whitespace outside strings.
const KNOWN_CANONICAL_STRING =
  '{"anchorId":"test-anchor","anchorReported":{"amountOut":"950.00","anchorTransactionId":"anchor-tx-123","reportedBy":"sender"},"corridor":"usdc-ngn","detectedAt":"2026-11-22T12:00:00.000Z","intentHash":"abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789","minReceive":"1000.00","networkPassphrase":"Test SDF Network ; September 2015","onChain":null,"shortfall":"50.00","shortfallBps":500,"signerAccount":"GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5","v":1}';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('buildSlippageEvidence', () => {
  it('builds the expected object from a fixture row', () => {
    const evidence = buildSlippageEvidence({
      row: FIXTURE_ROW,
      anchorTransactionId: 'anchor-tx-123',
      evaluation: BREACH_EVALUATION,
      detectedAt: '2026-11-22T12:00:00.000Z',
    });

    expect(evidence).toEqual({
      v: 1,
      networkPassphrase: NETWORK_PASSPHRASE,
      intentHash: FIXTURE_ROW.intentHash,
      anchorId: FIXTURE_ROW.anchorId,
      corridor: FIXTURE_ROW.corridor,
      signerAccount: FIXTURE_ROW.signerAccount,
      minReceive: FIXTURE_ROW.minReceive,
      anchorReported: {
        anchorTransactionId: 'anchor-tx-123',
        amountOut: '950.00',
        reportedBy: 'sender',
      },
      shortfall: '50.00',
      shortfallBps: 500,
      onChain: null,
      detectedAt: '2026-11-22T12:00:00.000Z',
    });
  });

  it('respects optional networkPassphrase override', () => {
    const customPassphrase = 'Public Global Stellar Network ; September 2015';
    const evidence = buildSlippageEvidence({
      row: FIXTURE_ROW,
      anchorTransactionId: 'anchor-tx-123',
      evaluation: BREACH_EVALUATION,
      detectedAt: '2026-11-22T12:00:00.000Z',
      networkPassphrase: customPassphrase,
    });

    expect(evidence.networkPassphrase).toBe(customPassphrase);
  });

  it('never leaks recipient or other unneeded row fields into evidence', () => {
    const rowWithExtras = {
      ...FIXTURE_ROW,
      recipient: 'NGN-SECRET-BANK-999',
      recipientName: 'Alice Secret',
      memoSecret: 'private-data',
    } as unknown as OutcomeLogRow;

    const evidence = buildSlippageEvidence({
      row: rowWithExtras,
      anchorTransactionId: 'anchor-tx-123',
      evaluation: BREACH_EVALUATION,
      detectedAt: '2026-11-22T12:00:00.000Z',
    });

    expect(evidence).not.toHaveProperty('recipient');
    expect(evidence).not.toHaveProperty('recipientName');
    expect(evidence).not.toHaveProperty('memoSecret');
    expect(evidence).not.toHaveProperty('quotedRate');
    expect(evidence).not.toHaveProperty('disputed');
    expect(canonicalEvidenceJson(evidence)).not.toContain('recipient');
  });

  it('throws for a missing signer, floor or delivered amount', () => {
    expect(() =>
      buildSlippageEvidence({
        row: { ...FIXTURE_ROW, signerAccount: null },
        anchorTransactionId: 'anchor-tx-123',
        evaluation: BREACH_EVALUATION,
        detectedAt: '2026-11-22T12:00:00.000Z',
      })
    ).toThrow(/signerAccount/);

    expect(() =>
      buildSlippageEvidence({
        row: { ...FIXTURE_ROW, minReceive: null },
        anchorTransactionId: 'anchor-tx-123',
        evaluation: BREACH_EVALUATION,
        detectedAt: '2026-11-22T12:00:00.000Z',
      })
    ).toThrow(/minReceive/);

    expect(() =>
      buildSlippageEvidence({
        row: { ...FIXTURE_ROW, deliveredAmount: null },
        anchorTransactionId: 'anchor-tx-123',
        evaluation: BREACH_EVALUATION,
        detectedAt: '2026-11-22T12:00:00.000Z',
      })
    ).toThrow(/deliveredAmount/);
  });
});

describe('hashSlippageEvidence and canonicalEvidenceJson', () => {
  it('the hash is identical for two objects with shuffled key order at every nesting level', async () => {
    const obj1: SlippageEvidence = {
      v: 1,
      networkPassphrase: 'Test SDF Network ; September 2015',
      intentHash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      anchorId: 'test-anchor',
      corridor: 'usdc-ngn',
      signerAccount: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      minReceive: '1000.00',
      anchorReported: {
        anchorTransactionId: 'anchor-tx-123',
        amountOut: '950.00',
        reportedBy: 'sender',
      },
      shortfall: '50.00',
      shortfallBps: 500,
      onChain: null,
      detectedAt: '2026-11-22T12:00:00.000Z',
    };

    const obj2: SlippageEvidence = {
      detectedAt: '2026-11-22T12:00:00.000Z',
      shortfallBps: 500,
      onChain: null,
      shortfall: '50.00',
      anchorReported: {
        reportedBy: 'sender',
        amountOut: '950.00',
        anchorTransactionId: 'anchor-tx-123',
      },
      minReceive: '1000.00',
      signerAccount: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      corridor: 'usdc-ngn',
      anchorId: 'test-anchor',
      intentHash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      networkPassphrase: 'Test SDF Network ; September 2015',
      v: 1,
    };

    const h1 = await hashSlippageEvidence(obj1);
    const h2 = await hashSlippageEvidence(obj2);

    expect(h1).toBe(h2);
    expect(canonicalEvidenceJson(obj1)).toBe(canonicalEvidenceJson(obj2));
  });

  it('known answer: the hash of a fixed fixture equals createHash("sha256").update(<expected canonical string written literally in the test>).digest("hex") from node:crypto', async () => {
    const expectedHash = createHash('sha256').update(KNOWN_CANONICAL_STRING).digest('hex');

    expect(canonicalEvidenceJson(KNOWN_EVIDENCE)).toBe(KNOWN_CANONICAL_STRING);
    expect(await hashSlippageEvidence(KNOWN_EVIDENCE)).toBe(expectedHash);
  });

  it('the canonical string has no whitespace and sorted nested keys', () => {
    const evidenceWithChain = withOnChainEvidence(KNOWN_EVIDENCE, ON_CHAIN_FIXTURE);
    const canonical = canonicalEvidenceJson(evidenceWithChain);

    // No whitespace characters outside quoted string values
    const outsideStrings = canonical.replace(/"(?:[^"\\]|\\.)*"/g, '');
    expect(outsideStrings).not.toMatch(/\s/);

    const parsed = JSON.parse(canonical) as Record<string, unknown>;
    const rootKeys = Object.keys(parsed);
    expect(rootKeys).toEqual([...rootKeys].sort());

    const anchorReportedKeys = Object.keys(parsed['anchorReported'] as Record<string, unknown>);
    expect(anchorReportedKeys).toEqual([...anchorReportedKeys].sort());

    const onChainKeys = Object.keys(parsed['onChain'] as Record<string, unknown>);
    expect(onChainKeys).toEqual([...onChainKeys].sort());
  });
});

describe('withOnChainEvidence', () => {
  it('returns a new object without mutating the original', () => {
    const original = { ...KNOWN_EVIDENCE };
    const updated = withOnChainEvidence(KNOWN_EVIDENCE, ON_CHAIN_FIXTURE);

    expect(updated).not.toBe(KNOWN_EVIDENCE);
    expect(KNOWN_EVIDENCE.onChain).toBeNull();
    expect(KNOWN_EVIDENCE).toEqual(original);
    expect(updated.onChain).toEqual(ON_CHAIN_FIXTURE);
  });

  it('withOnChainEvidence changes the hash', async () => {
    const beforeHash = await hashSlippageEvidence(KNOWN_EVIDENCE);
    const updated = withOnChainEvidence(KNOWN_EVIDENCE, ON_CHAIN_FIXTURE);
    const afterHash = await hashSlippageEvidence(updated);

    expect(afterHash).not.toBe(beforeHash);
    expect(afterHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
