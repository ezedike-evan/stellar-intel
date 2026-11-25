// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { RefundsPanel } from '@/components/history/RefundsPanel';
import { rememberTrackedIntent, type TrackedIntent } from '@/lib/refunds/local-history';
import type { PublicRefundCase } from '@/lib/refunds/store';

const REFUNDED_HASH = 'a'.repeat(64);
const CLEAN_HASH = 'b'.repeat(64);

function tracked(intentHash: string, transactionId: string): TrackedIntent {
  return {
    intentHash,
    anchorId: 'moneygram',
    corridor: 'usdc-ngn',
    direction: 'withdraw',
    transactionId,
    startedAt: '2026-11-20T10:00:00.000Z',
  };
}

const refundedCase: PublicRefundCase = {
  id: 'case-1',
  intentHash: REFUNDED_HASH,
  reason: 'anchor_refunded',
  anchorId: 'moneygram',
  corridor: 'usdc-ngn',
  direction: 'withdraw',
  amountPaid: '100',
  status: 'refunded',
  amountRefunded: '99.5',
  refundFee: '0.5',
  payments: [],
  openedAt: '2026-11-21T10:00:00.000Z',
  refundedAt: '2026-11-22T10:00:00.000Z',
  acknowledgedAt: null,
  onChainCheck: null,
};

describe('RefundsPanel (#2123)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lists only intents that have a refund case', async () => {
    rememberTrackedIntent(tracked(REFUNDED_HASH, 'tx-1'));
    rememberTrackedIntent(tracked(CLEAN_HASH, 'tx-2'));

    const fetchMock = vi.fn(async (url: string) => {
      const cases = url.endsWith(REFUNDED_HASH) ? [refundedCase] : [];
      return new Response(JSON.stringify({ intentHash: url.slice(-64), cases }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<RefundsPanel />);

    expect(await screen.findByText('Refunded')).toBeTruthy();
    expect(screen.getAllByTestId('refund-row')).toHaveLength(1);
    expect(screen.getByText('MoneyGram')).toBeTruthy();
    expect(screen.getByText('100')).toBeTruthy();
    expect(screen.getByText('99.5')).toBeTruthy();
    expect(screen.getByText("Open the transfer's status page to confirm receipt")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shows the empty message when nothing is tracked', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<RefundsPanel />);

    expect(await screen.findByText('No refunds tracked in this browser.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
