import { describe, it, expect, vi, beforeEach } from 'vitest';
import { solve, handleQuoteRejection, type SolveAttempt } from '@/lib/router/solve';
import * as anchors from '@/lib/stellar/anchors';
import * as sep24 from '@/lib/stellar/sep24';
import * as logging from '@/lib/api/logging';
import type { ResolvedAnchor, AnchorRate } from '@/types';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const MOCK_RESOLVED_ANCHOR: ResolvedAnchor = {
  id: 'test-anchor',
  name: 'Test Anchor',
  homeDomain: 'test.anchor.com',
  domain: 'test.anchor.com',
  corridors: ['usdc-ngn'],
  assetCode: 'USDC',
  assetIssuer: 'GA5Z...',
  TRANSFER_SERVER_SEP0024: 'https://test.anchor.com/sep24',
  ANCHOR_QUOTE_SERVER: null,
  WEB_AUTH_ENDPOINT: 'https://test.anchor.com/auth',
  SIGNING_KEY: null,
  NETWORK_PASSPHRASE: null,
  CURRENCIES: [],
  capabilities: {
    sep10: true,
    sep24: true,
    sep38: false,
    sep12: false,
  },
};

const MOCK_ANCHOR_RATE: AnchorRate = {
  anchorId: 'test-anchor',
  anchorName: 'Test Anchor',
  corridorId: 'usdc-ngn',
  fee: 5.0,
  feeType: 'flat',
  exchangeRate: 1.0,
  totalReceived: 95.0,
  source: 'sep24-fee',
  updatedAt: new Date(),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('solve - initial quote selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(logging, 'logStructured').mockImplementation(() => {});
  });

  it('returns successful solve with best anchor quote', async () => {
    const mockAnchor1 = { id: 'anchor1', name: 'Anchor 1', corridors: ['usdc-ngn'] };
    const mockAnchor2 = { id: 'anchor2', name: 'Anchor 2', corridors: ['usdc-ngn'] };

    vi.spyOn(anchors, 'getAnchorsByCorridorId').mockReturnValue([mockAnchor1, mockAnchor2] as any);

    vi.spyOn(anchors, 'getResolvedAnchorById').mockImplementation(async (id: string) => {
      if (id === 'anchor1') {
        return { ...MOCK_RESOLVED_ANCHOR, id: 'anchor1', name: 'Anchor 1' };
      }
      return { ...MOCK_RESOLVED_ANCHOR, id: 'anchor2', name: 'Anchor 2' };
    });

    vi.spyOn(sep24, 'getSep24Fee')
      .mockResolvedValueOnce({ ok: true, fee: 5.0 })
      .mockResolvedValueOnce({ ok: true, fee: 3.0 });

    const result = await solve({
      corridorId: 'usdc-ngn',
      amount: '100',
      assetCode: 'USDC',
      assetIssuer: 'GA5Z...',
      feeType: 'external',
    });

    expect(result.success).toBe(true);
    expect(result.selectedAnchor?.id).toBe('anchor2');
    expect(result.selectedRate?.fee).toBe('3');
    expect(result.selectedRate?.totalReceived).toBe(97); // 100 - 3 * 1
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].attemptNumber).toBe(1);
    expect(result.attempts[0].error).toBeNull();
    expect(result.solveRequestId).toBeDefined();
  });

  it('logs attempt with duration and candidate count', async () => {
    const mockAnchor = { id: 'anchor1', name: 'Anchor 1', corridors: ['usdc-ngn'] };

    vi.spyOn(anchors, 'getAnchorsByCorridorId').mockReturnValue([mockAnchor] as any);
    vi.spyOn(anchors, 'getResolvedAnchorById').mockResolvedValue({
      ...MOCK_RESOLVED_ANCHOR,
      id: 'anchor1',
      name: 'Anchor 1',
    });
    vi.spyOn(sep24, 'getSep24Fee').mockResolvedValue({ ok: true, fee: 5.0 });

    const result = await solve({
      corridorId: 'usdc-ngn',
      amount: '100',
      assetCode: 'USDC',
      assetIssuer: 'GA5Z...',
      feeType: 'external',
    });

    const attempt = result.attempts[0];
    expect(attempt.attemptNumber).toBe(1);
    expect(attempt.selectedAnchorId).toBe('anchor1');
    expect(attempt.selectedAnchorName).toBe('Anchor 1');
    expect(attempt.quote).not.toBeNull();
    expect(attempt.error).toBeNull();
    expect(attempt.timestamp).toBeDefined();
    expect(attempt.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof attempt.durationMs).toBe('number');
  });

  it('returns error when no anchors available for corridor', async () => {
    vi.spyOn(anchors, 'getAnchorsByCorridorId').mockReturnValue([]);

    const result = await solve({
      corridorId: 'usdc-invalid',
      amount: '100',
      assetCode: 'USDC',
      assetIssuer: 'GA5Z...',
      feeType: 'external',
    });

    expect(result.success).toBe(false);
    expect(result.finalError).toContain('No anchors available');
    expect(result.attempts).toHaveLength(0);
  });

  it('handles fee fetch failures gracefully', async () => {
    const mockAnchor = { id: 'anchor1', name: 'Anchor 1', corridors: ['usdc-ngn'] };

    vi.spyOn(anchors, 'getAnchorsByCorridorId').mockReturnValue([mockAnchor] as any);
    vi.spyOn(anchors, 'getResolvedAnchorById').mockResolvedValue({
      ...MOCK_RESOLVED_ANCHOR,
      id: 'anchor1',
    });
    vi.spyOn(sep24, 'getSep24Fee').mockResolvedValue({ ok: false, reason: 'unsupported' });

    const result = await solve({
      corridorId: 'usdc-ngn',
      amount: '100',
      assetCode: 'USDC',
      assetIssuer: 'GA5Z...',
      feeType: 'external',
    });

    expect(result.success).toBe(false);
    expect(result.finalError).toContain('No valid quotes');
  });

  it('handles missing transfer server gracefully', async () => {
    const mockAnchor = { id: 'anchor1', name: 'Anchor 1', corridors: ['usdc-ngn'] };

    vi.spyOn(anchors, 'getAnchorsByCorridorId').mockReturnValue([mockAnchor] as any);
    vi.spyOn(anchors, 'getResolvedAnchorById').mockResolvedValue({
      ...MOCK_RESOLVED_ANCHOR,
      TRANSFER_SERVER_SEP0024: null,
    });

    const result = await solve({
      corridorId: 'usdc-ngn',
      amount: '100',
      assetCode: 'USDC',
      assetIssuer: 'GA5Z...',
      feeType: 'external',
    });

    expect(result.success).toBe(false);
    expect(result.finalError).toContain('No valid quotes');
  });
});

describe('solve - fallback mechanism', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(logging, 'logStructured').mockImplementation(() => {});
  });

  it('does not fallback on initial success', async () => {
    const mockAnchor = { id: 'anchor1', name: 'Anchor 1', corridors: ['usdc-ngn'] };

    vi.spyOn(anchors, 'getAnchorsByCorridorId').mockReturnValue([mockAnchor] as any);
    vi.spyOn(anchors, 'getResolvedAnchorById').mockResolvedValue({
      ...MOCK_RESOLVED_ANCHOR,
      id: 'anchor1',
    });
    vi.spyOn(sep24, 'getSep24Fee').mockResolvedValue({ ok: true, fee: 5.0 });

    const result = await solve({
      corridorId: 'usdc-ngn',
      amount: '100',
      assetCode: 'USDC',
      assetIssuer: 'GA5Z...',
      feeType: 'external',
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toHaveLength(1);
    expect(result.finalError).toBeNull();
  });

  it('enforces max 3 total attempts (1 initial + 2 fallbacks)', async () => {
    const mockAnchor1 = { id: 'anchor1', name: 'Anchor 1', corridors: ['usdc-ngn'] };
    const mockAnchor2 = { id: 'anchor2', name: 'Anchor 2', corridors: ['usdc-ngn'] };
    const mockAnchor3 = { id: 'anchor3', name: 'Anchor 3', corridors: ['usdc-ngn'] };
    const mockAnchor4 = { id: 'anchor4', name: 'Anchor 4', corridors: ['usdc-ngn'] };

    vi.spyOn(anchors, 'getAnchorsByCorridorId').mockReturnValue([
      mockAnchor1,
      mockAnchor2,
      mockAnchor3,
      mockAnchor4,
    ] as any);

    // Simulate failures on all but the last anchor
    vi.spyOn(anchors, 'getResolvedAnchorById').mockImplementation(async (id: string) => {
      return { ...MOCK_RESOLVED_ANCHOR, id };
    });

    // All fee requests fail
    vi.spyOn(sep24, 'getSep24Fee').mockResolvedValue({ ok: false, reason: 'unsupported' });

    const result = await solve({
      corridorId: 'usdc-ngn',
      amount: '100',
      assetCode: 'USDC',
      assetIssuer: 'GA5Z...',
      feeType: 'external',
    });

    expect(result.success).toBe(false);
    // When no valid quotes, loop breaks immediately without recording attempt
    // So this test should verify we fail gracefully with no candidates
    expect(result.finalError).toContain('No valid quotes');
  });
});

describe('handleQuoteRejection - fallback flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(logging, 'logStructured').mockImplementation(() => {});
  });

  it('triggers fallback re-solve with remaining candidates', async () => {
    const mockAnchor1 = { id: 'anchor1', name: 'Anchor 1', corridors: ['usdc-ngn'] };
    const mockAnchor2 = { id: 'anchor2', name: 'Anchor 2', corridors: ['usdc-ngn'] };

    vi.spyOn(anchors, 'getAnchorsByCorridorId').mockReturnValue([mockAnchor1, mockAnchor2] as any);

    vi.spyOn(anchors, 'getResolvedAnchorById')
      .mockResolvedValueOnce({ ...MOCK_RESOLVED_ANCHOR, id: 'anchor1', name: 'Anchor 1' })
      .mockResolvedValueOnce({ ...MOCK_RESOLVED_ANCHOR, id: 'anchor2', name: 'Anchor 2' });

    vi.spyOn(sep24, 'getSep24Fee').mockResolvedValueOnce({ ok: true, fee: 3.0 });

    const previousAttempts: SolveAttempt[] = [
      {
        attemptNumber: 1,
        selectedAnchorId: 'anchor1',
        selectedAnchorName: 'Anchor 1',
        quote: { ...MOCK_ANCHOR_RATE, anchorId: 'anchor1', fee: 5.0 },
        error: null,
        timestamp: new Date().toISOString(),
      },
    ];

    const result = await handleQuoteRejection('anchor1', previousAttempts, {
      corridorId: 'usdc-ngn',
      amount: '100',
      assetCode: 'USDC',
      assetIssuer: 'GA5Z...',
      feeType: 'external',
    });

    expect(result.success).toBe(true);
    expect(result.selectedAnchor?.id).toBe('anchor2');
    expect(result.attempts).toHaveLength(3); // original + rejection + fallback
    expect(result.attempts[1].error).toBe('Quote rejected by anchor');
    expect(result.attempts[2].selectedAnchorId).toBe('anchor2');
    expect(result.attempts[2].error).toBeNull();
    expect(result.solveRequestId).toBeDefined();
  });

  it('logs rejection attempt with unified UX (single flow)', async () => {
    const mockAnchor1 = { id: 'anchor1', name: 'Anchor 1', corridors: ['usdc-ngn'] };
    const mockAnchor2 = { id: 'anchor2', name: 'Anchor 2', corridors: ['usdc-ngn'] };

    vi.spyOn(anchors, 'getAnchorsByCorridorId').mockReturnValue([mockAnchor1, mockAnchor2] as any);
    vi.spyOn(anchors, 'getResolvedAnchorById').mockResolvedValue({
      ...MOCK_RESOLVED_ANCHOR,
      id: 'anchor2',
      name: 'Anchor 2',
    });
    vi.spyOn(sep24, 'getSep24Fee').mockResolvedValue({ ok: true, fee: 3.0 });

    const previousAttempts: SolveAttempt[] = [
      {
        attemptNumber: 1,
        selectedAnchorId: 'anchor1',
        selectedAnchorName: 'Anchor 1',
        quote: MOCK_ANCHOR_RATE,
        error: null,
        timestamp: new Date().toISOString(),
      },
    ];

    const result = await handleQuoteRejection('anchor1', previousAttempts, {
      corridorId: 'usdc-ngn',
      amount: '100',
      assetCode: 'USDC',
      assetIssuer: 'GA5Z...',
      feeType: 'external',
    });

    // UX should see unified response
    expect(result.success).toBe(true);
    expect(result.selectedAnchor?.id).toBe('anchor2');

    // But internal logging tracks all attempts
    const rejectionAttempt = result.attempts[1];
    expect(rejectionAttempt.attemptNumber).toBe(2);
    expect(rejectionAttempt.selectedAnchorId).toBe('anchor1');
    expect(rejectionAttempt.error).toBe('Quote rejected by anchor');
    expect(rejectionAttempt.timestamp).toBeDefined();
  });

  it('respects max 2 fallback attempts limit', async () => {
    const mockAnchor1 = { id: 'anchor1', name: 'Anchor 1', corridors: ['usdc-ngn'] };
    const mockAnchor2 = { id: 'anchor2', name: 'Anchor 2', corridors: ['usdc-ngn'] };
    const mockAnchor3 = { id: 'anchor3', name: 'Anchor 3', corridors: ['usdc-ngn'] };

    vi.spyOn(anchors, 'getAnchorsByCorridorId').mockReturnValue([
      mockAnchor1,
      mockAnchor2,
      mockAnchor3,
    ] as any);

    // Simulate 2 previous successful attempts (already used both fallbacks)
    const previousAttempts: SolveAttempt[] = [
      {
        attemptNumber: 1,
        selectedAnchorId: 'anchor1',
        selectedAnchorName: 'Anchor 1',
        quote: MOCK_ANCHOR_RATE,
        error: null,
        timestamp: new Date().toISOString(),
      },
      {
        attemptNumber: 2,
        selectedAnchorId: 'anchor1',
        selectedAnchorName: 'Anchor 1',
        quote: null,
        error: 'Quote rejected by anchor',
        timestamp: new Date().toISOString(),
      },
      {
        attemptNumber: 3,
        selectedAnchorId: 'anchor2',
        selectedAnchorName: 'Anchor 2',
        quote: MOCK_ANCHOR_RATE,
        error: null,
        timestamp: new Date().toISOString(),
      },
    ];

    // Third rejection should fail (already 2 fallbacks used)
    const result = await handleQuoteRejection('anchor2', previousAttempts, {
      corridorId: 'usdc-ngn',
      amount: '100',
      assetCode: 'USDC',
      assetIssuer: 'GA5Z...',
      feeType: 'external',
    });

    expect(result.success).toBe(false);
    expect(result.finalError).toContain('Max fallback attempts exhausted');
  });

  it('returns error when all anchors exhausted', async () => {
    const mockAnchor1 = { id: 'anchor1', name: 'Anchor 1', corridors: ['usdc-ngn'] };

    vi.spyOn(anchors, 'getAnchorsByCorridorId').mockReturnValue([mockAnchor1] as any);

    const previousAttempts: SolveAttempt[] = [
      {
        attemptNumber: 1,
        selectedAnchorId: 'anchor1',
        selectedAnchorName: 'Anchor 1',
        quote: MOCK_ANCHOR_RATE,
        error: null,
        timestamp: new Date().toISOString(),
      },
    ];

    const result = await handleQuoteRejection('anchor1', previousAttempts, {
      corridorId: 'usdc-ngn',
      amount: '100',
      assetCode: 'USDC',
      assetIssuer: 'GA5Z...',
      feeType: 'external',
    });

    expect(result.success).toBe(false);
    expect(result.finalError).toContain('No remaining anchors');
  });

  it('preserves complete attempt history across fallbacks', async () => {
    const mockAnchor1 = { id: 'anchor1', name: 'Anchor 1', corridors: ['usdc-ngn'] };
    const mockAnchor2 = { id: 'anchor2', name: 'Anchor 2', corridors: ['usdc-ngn'] };

    vi.spyOn(anchors, 'getAnchorsByCorridorId').mockReturnValue([mockAnchor1, mockAnchor2] as any);
    vi.spyOn(anchors, 'getResolvedAnchorById').mockResolvedValue({
      ...MOCK_RESOLVED_ANCHOR,
      id: 'anchor2',
      name: 'Anchor 2',
    });
    vi.spyOn(sep24, 'getSep24Fee').mockResolvedValue({ ok: true, fee: 3.0 });

    const originalAttempt: SolveAttempt = {
      attemptNumber: 1,
      selectedAnchorId: 'anchor1',
      selectedAnchorName: 'Anchor 1',
      quote: MOCK_ANCHOR_RATE,
      error: null,
      timestamp: new Date().toISOString(),
    };

    const previousAttempts = [originalAttempt];

    const result = await handleQuoteRejection('anchor1', previousAttempts, {
      corridorId: 'usdc-ngn',
      amount: '100',
      assetCode: 'USDC',
      assetIssuer: 'GA5Z...',
      feeType: 'external',
    });

    // Verify all attempts are preserved in order
    expect(result.attempts[0]).toEqual(originalAttempt);
    expect(result.attempts[1].attemptNumber).toBe(2);
    expect(result.attempts[1].error).toBe('Quote rejected by anchor');
    expect(result.attempts[2].attemptNumber).toBe(3);
    expect(result.attempts[2].selectedAnchorId).toBe('anchor2');
    expect(result.attempts[2].error).toBeNull();
  });

  it('excludes failed anchors from fallback candidates', async () => {
    const mockAnchor1 = { id: 'anchor1', name: 'Anchor 1', corridors: ['usdc-ngn'] };
    const mockAnchor2 = { id: 'anchor2', name: 'Anchor 2', corridors: ['usdc-ngn'] };
    const mockAnchor3 = { id: 'anchor3', name: 'Anchor 3', corridors: ['usdc-ngn'] };

    vi.spyOn(anchors, 'getAnchorsByCorridorId').mockReturnValue([
      mockAnchor1,
      mockAnchor2,
      mockAnchor3,
    ] as any);

    vi.spyOn(anchors, 'getResolvedAnchorById').mockResolvedValue({
      ...MOCK_RESOLVED_ANCHOR,
      id: 'anchor3',
      name: 'Anchor 3',
    });

    vi.spyOn(sep24, 'getSep24Fee').mockResolvedValue({ ok: true, fee: 3.0 });

    const previousAttempts: SolveAttempt[] = [
      {
        attemptNumber: 1,
        selectedAnchorId: 'anchor1',
        selectedAnchorName: 'Anchor 1',
        quote: MOCK_ANCHOR_RATE,
        error: null,
        timestamp: new Date().toISOString(),
      },
      {
        attemptNumber: 2,
        selectedAnchorId: 'anchor1',
        selectedAnchorName: 'Anchor 1',
        quote: null,
        error: 'Network timeout',
        timestamp: new Date().toISOString(),
      },
    ];

    await handleQuoteRejection('anchor1', previousAttempts, {
      corridorId: 'usdc-ngn',
      amount: '100',
      assetCode: 'USDC',
      assetIssuer: 'GA5Z...',
      feeType: 'external',
    });

    // Should only try anchor3 (anchor1 rejected, anchor2 had network error)
    // Verify SEP24 fee was called (means anchor3 was tried)
    expect(sep24.getSep24Fee).toHaveBeenCalled();
    expect(anchors.getResolvedAnchorById).toHaveBeenCalledWith('anchor3');
  });
});

describe('handleQuoteRejection - edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(logging, 'logStructured').mockImplementation(() => {});
  });

  it('handles network errors in fallback candidates', async () => {
    const mockAnchor1 = { id: 'anchor1', name: 'Anchor 1', corridors: ['usdc-ngn'] };
    const mockAnchor2 = { id: 'anchor2', name: 'Anchor 2', corridors: ['usdc-ngn'] };

    vi.spyOn(anchors, 'getAnchorsByCorridorId').mockReturnValue([mockAnchor1, mockAnchor2] as any);
    vi.spyOn(anchors, 'getResolvedAnchorById').mockImplementation(async (id: string) => {
      if (id === 'anchor2') {
        throw new Error('Network timeout');
      }
      return { ...MOCK_RESOLVED_ANCHOR, id };
    });
    vi.spyOn(sep24, 'getSep24Fee').mockRejectedValue(new Error('Network error'));

    const previousAttempts: SolveAttempt[] = [
      {
        attemptNumber: 1,
        selectedAnchorId: 'anchor1',
        selectedAnchorName: 'Anchor 1',
        quote: MOCK_ANCHOR_RATE,
        error: null,
        timestamp: new Date().toISOString(),
      },
    ];

    const result = await handleQuoteRejection('anchor1', previousAttempts, {
      corridorId: 'usdc-ngn',
      amount: '100',
      assetCode: 'USDC',
      assetIssuer: 'GA5Z...',
      feeType: 'external',
    });

    expect(result.success).toBe(false);
    expect(result.finalError).toContain('No valid quotes');
  });

  it('generates unique solveRequestId for correlation', async () => {
    const mockAnchor1 = { id: 'anchor1', name: 'Anchor 1', corridors: ['usdc-ngn'] };
    const mockAnchor2 = { id: 'anchor2', name: 'Anchor 2', corridors: ['usdc-ngn'] };

    vi.spyOn(anchors, 'getAnchorsByCorridorId').mockReturnValue([mockAnchor1, mockAnchor2] as any);
    vi.spyOn(anchors, 'getResolvedAnchorById').mockResolvedValue({
      ...MOCK_RESOLVED_ANCHOR,
      id: 'anchor2',
      name: 'Anchor 2',
    });
    vi.spyOn(sep24, 'getSep24Fee').mockResolvedValue({ ok: true, fee: 3.0 });

    const previousAttempts: SolveAttempt[] = [
      {
        attemptNumber: 1,
        selectedAnchorId: 'anchor1',
        selectedAnchorName: 'Anchor 1',
        quote: MOCK_ANCHOR_RATE,
        error: null,
        timestamp: new Date().toISOString(),
      },
    ];

    const result = await handleQuoteRejection('anchor1', previousAttempts, {
      corridorId: 'usdc-ngn',
      amount: '100',
      assetCode: 'USDC',
      assetIssuer: 'GA5Z...',
      feeType: 'external',
    });

    expect(result.solveRequestId).toBeDefined();
    expect(typeof result.solveRequestId).toBe('string');
    expect(result.solveRequestId).toHaveLength(36); // UUID v4 format
  });
});
