import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { createElement } from 'react';
import { SWRConfig } from 'swr';
import { RefundAckCard } from '@/components/refunds/RefundAckCard';
import { buildRefundAck, hashRefundAck } from '@/lib/refunds/ack';
import { signHash } from '@/lib/intent/sign';
import type { Sep24Refunds } from '@/types';
import type { PublicRefundCase } from '@/lib/refunds/store';

vi.mock('@/lib/intent/sign', () => ({
  signHash: vi.fn(),
  IntentSignError: class IntentSignError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'IntentSignError';
      this.code = code;
    }
  },
}));

const wrapper = ({ children }: { children: React.ReactNode }) =>
  createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, children);

const INTENT_HASH = '1'.repeat(64);
const ANCHOR_ID = 'cowrie';
const ACCOUNT = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const ASSET_LABEL = 'USDC';

const MOCK_REFUNDS: Sep24Refunds = {
  amount_refunded: '95.00',
  amount_fee: '5.00',
  payments: [
    {
      id: 'stellar-tx-123',
      id_type: 'stellar',
      amount: '95.00',
      fee: '5.00',
    },
  ],
};

function createCase(overrides: Partial<PublicRefundCase> = {}): PublicRefundCase {
  return {
    id: 'case-1',
    intentHash: INTENT_HASH,
    reason: 'anchor_refunded',
    anchorId: ANCHOR_ID,
    corridor: 'usdc-ngn',
    direction: 'withdraw',
    amountPaid: '100.00',
    status: 'refunded',
    amountRefunded: '95.00',
    refundFee: '5.00',
    payments: [{ id: 'stellar-tx-123', idType: 'stellar', amount: '95.00', fee: '5.00' }],
    openedAt: '2026-11-20T10:00:00.000Z',
    refundedAt: '2026-11-20T10:05:00.000Z',
    acknowledgedAt: null,
    onChainCheck: null,
    ...overrides,
  };
}

describe('RefundAckCard (RFD009)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('empty lookup → "Checking refund status…"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ intentHash: INTENT_HASH, cases: [] }),
      })
    );

    render(
      <RefundAckCard
        intentHash={INTENT_HASH}
        anchorId={ANCHOR_ID}
        account={ACCOUNT}
        refunds={MOCK_REFUNDS}
        assetLabel={ASSET_LABEL}
      />,
      { wrapper }
    );

    expect(screen.getByText('Checking refund status…')).toBeInTheDocument();
  });

  it('refunded case + refunds → button with amount; click signs hash and POSTs to /api/refunds/ack', async () => {
    const mockCase = createCase({ status: 'refunded' });
    const expectedAck = buildRefundAck({
      intentHash: INTENT_HASH,
      anchorId: ANCHOR_ID,
      account: ACCOUNT,
      refunds: MOCK_REFUNDS,
    });
    const expectedHash = await hashRefundAck(expectedAck);

    vi.mocked(signHash).mockResolvedValue({
      intentHash: expectedHash,
      signature: 'test-signature-b64',
      publicKey: ACCOUNT,
    });

    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/api/refunds/ack')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ intentHash: INTENT_HASH, cases: [mockCase] }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <RefundAckCard
        intentHash={INTENT_HASH}
        anchorId={ANCHOR_ID}
        account={ACCOUNT}
        refunds={MOCK_REFUNDS}
        assetLabel={ASSET_LABEL}
      />,
      { wrapper }
    );

    const button = await screen.findByRole('button', {
      name: `Confirm I received 95.00 ${ASSET_LABEL}`,
    });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);

    await waitFor(() => {
      expect(signHash).toHaveBeenCalledWith(expectedHash);
    });

    await waitFor(() => {
      const ackPost = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/refunds/ack'));
      expect(ackPost).toBeDefined();
      const body = JSON.parse(ackPost![1].body as string);
      expect(body).toEqual({
        ack: expectedAck,
        signature: 'test-signature-b64',
      });
    });
  });

  it('signHash rejecting with SIGN_REJECTED → declined message shown, no POST', async () => {
    const mockCase = createCase({ status: 'refunded' });

    vi.mocked(signHash).mockRejectedValue({
      name: 'IntentSignError',
      code: 'SIGN_REJECTED',
      message: 'User rejected signing',
    });

    const fetchMock = vi.fn().mockImplementation(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => ({ intentHash: INTENT_HASH, cases: [mockCase] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <RefundAckCard
        intentHash={INTENT_HASH}
        anchorId={ANCHOR_ID}
        account={ACCOUNT}
        refunds={MOCK_REFUNDS}
        assetLabel={ASSET_LABEL}
      />,
      { wrapper }
    );

    const button = await screen.findByRole('button', {
      name: `Confirm I received 95.00 ${ASSET_LABEL}`,
    });
    fireEvent.click(button);

    await waitFor(() => {
      expect(
        screen.getByText('You declined to sign. Your refund is still tracked.')
      ).toBeInTheDocument();
    });

    const ackPost = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/refunds/ack'));
    expect(ackPost).toBeUndefined();
  });

  it('POST returns 409 with a message → that message shown', async () => {
    const mockCase = createCase({ status: 'refunded' });

    vi.mocked(signHash).mockResolvedValue({
      intentHash: 'hash',
      signature: 'test-sig',
      publicKey: ACCOUNT,
    });

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/refunds/ack')) {
        return {
          ok: false,
          status: 409,
          json: async () => ({ message: 'This refund has already been acknowledged' }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ intentHash: INTENT_HASH, cases: [mockCase] }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <RefundAckCard
        intentHash={INTENT_HASH}
        anchorId={ANCHOR_ID}
        account={ACCOUNT}
        refunds={MOCK_REFUNDS}
        assetLabel={ASSET_LABEL}
      />,
      { wrapper }
    );

    const button = await screen.findByRole('button', {
      name: `Confirm I received 95.00 ${ASSET_LABEL}`,
    });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText('This refund has already been acknowledged')).toBeInTheDocument();
    });
  });

  it('acknowledged + onChainCheck: "verified" → confirmation and ledger line, no button', async () => {
    const mockCase = createCase({
      status: 'acknowledged',
      acknowledgedAt: '2026-11-20T12:00:00.000Z',
      onChainCheck: 'verified',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ intentHash: INTENT_HASH, cases: [mockCase] }),
      })
    );

    render(
      <RefundAckCard
        intentHash={INTENT_HASH}
        anchorId={ANCHOR_ID}
        account={ACCOUNT}
        refunds={MOCK_REFUNDS}
        assetLabel={ASSET_LABEL}
      />,
      { wrapper }
    );

    await waitFor(() => {
      expect(screen.getByText(/Refund confirmed on/)).toBeInTheDocument();
      expect(screen.getByText('Verified on the Stellar ledger')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('owed without refunds → the "owes you" line, no button', async () => {
    const mockCase = createCase({
      status: 'owed',
      amountPaid: '100.00',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ intentHash: INTENT_HASH, cases: [mockCase] }),
      })
    );

    render(
      <RefundAckCard
        intentHash={INTENT_HASH}
        anchorId={ANCHOR_ID}
        account={ACCOUNT}
        refunds={undefined}
        assetLabel={ASSET_LABEL}
      />,
      { wrapper }
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          `The anchor owes you a refund of 100.00 ${ASSET_LABEL}. We are tracking it.`
        )
      ).toBeInTheDocument();
    });

    expect(screen.queryByRole('button')).toBeNull();
  });
});
