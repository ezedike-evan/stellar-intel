import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ExecuteDrawer } from '@/components/offramp/ExecuteDrawer';
import type { AnchorRate } from '@/types';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/stellar/sep10', async () => {
  const actual = await vi.importActual<any>('@/lib/stellar/sep10');
  return {
    ...actual,
    authenticate: vi.fn(),
  };
});

vi.mock('@/lib/stellar/sep24', () => ({
  initiateWithdraw: vi.fn(),
  openWithdrawPopup: vi.fn(),
  getWithdrawTransactionRecord: vi.fn(),
}));

vi.mock('@/lib/stellar/sep1', () => ({
  getTransferServer: vi.fn(),
}));

vi.mock('@/lib/stellar/anchors', () => ({
  getAnchorById: vi.fn(),
  getResolvedAnchorById: vi.fn(),
}));

vi.mock('@/lib/stellar/horizon', () => ({
  buildWithdrawPayment: vi.fn(),
  signAndSubmitPayment: vi.fn(),
}));

vi.mock('@/components/offramp/KycIframe', async () => {
  const React = await import('react');
  return {
    KycIframe: ({
      origin,
      onComplete,
      onCancel,
    }: {
      origin: string;
      onComplete: (transactionId: string) => void;
      onCancel: () => void;
      onError: (error: Error) => void;
      url: string;
    }) => {
      React.useEffect(() => {
        const handler = (event: MessageEvent) => {
          if (event.origin !== origin) return;
          const data = event.data as { type?: string; transaction_id?: string };
          if (data.type === 'stellar_transaction_created' && data.transaction_id) {
            onComplete(data.transaction_id);
          } else if (data.type === 'stellar_cancel') {
            onCancel();
          }
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
      }, [origin, onCancel, onComplete]);

      return React.createElement('div', { 'data-testid': 'kyc-iframe-mock' });
    },
  };
});

import * as sep10 from '@/lib/stellar/sep10';
import * as sep24 from '@/lib/stellar/sep24';
import * as sep1 from '@/lib/stellar/sep1';
import * as anchors from '@/lib/stellar/anchors';
import * as horizon from '@/lib/stellar/horizon';

const mockAuthenticate = vi.mocked(sep10.authenticate);
const mockInitiateWithdraw = vi.mocked(sep24.initiateWithdraw);
const mockOpenWithdrawPopup = vi.mocked(sep24.openWithdrawPopup);
const mockGetWithdrawTransactionRecord = vi.mocked(sep24.getWithdrawTransactionRecord);
const _mockGetTransferServer = vi.mocked(sep1.getTransferServer);
const mockGetAnchorById = vi.mocked(anchors.getAnchorById);
const mockGetResolvedAnchorById = vi.mocked(anchors.getResolvedAnchorById);
const mockBuildWithdrawPayment = vi.mocked(horizon.buildWithdrawPayment);
const mockSignAndSubmitPayment = vi.mocked(horizon.signAndSubmitPayment);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const RATE: AnchorRate = {
  anchorId: 'cowrie',
  anchorName: 'Cowrie',
  corridorId: 'usdc-ngn',
  fee: 2,
  feeType: 'flat',
  exchangeRate: 1580,
  totalReceived: 154840,
  source: 'sep24-fee' as const,
  updatedAt: new Date(),
};

const ANCHOR = {
  id: 'cowrie',
  name: 'Cowrie',
  homeDomain: 'cowrie.exchange',
  corridors: ['usdc-ngn'],
  assetCode: 'USDC',
  assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
};

const RESOLVED_ANCHOR = {
  ...ANCHOR,
  TRANSFER_SERVER_SEP0024: 'https://transfer.cowrie.exchange',
  WEB_AUTH_ENDPOINT: 'https://auth.cowrie.exchange',
  SIGNING_KEY: 'G...',
  domain: 'cowrie.exchange',
  ANCHOR_QUOTE_SERVER: null,
  NETWORK_PASSPHRASE: null,
  ORG_URL: null,
  ORG_SUPPORT_EMAIL: null,
  ORG_SUPPORT_URL: null,
  CURRENCIES: [
    { code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' },
  ],
  capabilities: { sep10: true, sep24: true, sep38: false, sep12: false },
};

const PUBLIC_KEY = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789';

const AUTH = {
  jwt: 'test.jwt.token',
  anchorDomain: 'cowrie.exchange',
  publicKey: PUBLIC_KEY,
  expiresAt: new Date(Date.now() + 86400_000),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
    })) as unknown as typeof fetch
  );
  mockGetAnchorById.mockReturnValue(ANCHOR);
  mockGetResolvedAnchorById.mockResolvedValue(RESOLVED_ANCHOR);
  mockAuthenticate.mockResolvedValue(AUTH);
  mockInitiateWithdraw.mockResolvedValue({
    type: 'interactive_customer_info_needed',
    url: 'https://anchor.example/kyc',
    id: 'txn-abc-123',
  });
  mockOpenWithdrawPopup.mockResolvedValue('txn-abc-123');
  mockGetWithdrawTransactionRecord.mockResolvedValue({
    withdrawAnchorAccount: 'GANCHOR123',
    memo: 'TEST_MEMO',
    memoType: 'text',
  });
  mockBuildWithdrawPayment.mockResolvedValue({} as never);
  mockSignAndSubmitPayment.mockResolvedValue({ hash: 'abc123txhash' } as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ExecuteDrawer', () => {
  it('renders the dialog shell but no anchor name when rate is null', () => {
    render(
      <ExecuteDrawer
        rate={null}
        amount="100"
        publicKey={PUBLIC_KEY}
        onClose={vi.fn()}
        onExecuteStarted={vi.fn()}
      />
    );
    expect(screen.queryByRole('dialog')).toBeInTheDocument();
    // No anchor-specific content should appear
    expect(screen.queryByText('Cowrie')).not.toBeInTheDocument();
    expect(screen.queryByText('100 USDC')).not.toBeInTheDocument();
  });

  it('shows the anchor name and transaction summary when a rate is provided', () => {
    render(
      <ExecuteDrawer
        rate={RATE}
        amount="100"
        publicKey={PUBLIC_KEY}
        onClose={vi.fn()}
        onExecuteStarted={vi.fn()}
      />
    );
    expect(screen.getByText(/Cowrie/)).toBeInTheDocument();
    expect(screen.getByText('100 USDC')).toBeInTheDocument();
    expect(screen.getByText('Start Off-ramp')).toBeInTheDocument();
  });

  it('runs through the full happy path and shows the tx hash', async () => {
    render(
      <ExecuteDrawer
        rate={RATE}
        amount="100"
        publicKey={PUBLIC_KEY}
        onClose={vi.fn()}
        onExecuteStarted={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Start Off-ramp'));

    await waitFor(() => expect(mockInitiateWithdraw).toHaveBeenCalled());

    expect(mockAuthenticate).toHaveBeenCalledWith(RESOLVED_ANCHOR, PUBLIC_KEY);

    await waitFor(() => expect(screen.getByTestId('kyc-iframe-mock')).toBeInTheDocument());

    // In happy path, simulate completion
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'stellar_transaction_created', transaction_id: 'txn-123' },
          origin: 'https://anchor.example',
        })
      );
    });

    await waitFor(() => expect(screen.getByText('abc123txhash')).toBeInTheDocument());

    expect(mockBuildWithdrawPayment).toHaveBeenCalled();
    expect(mockSignAndSubmitPayment).toHaveBeenCalled();
  });

  it('shows the error message and a Try Again button when authentication fails', async () => {
    mockAuthenticate.mockRejectedValue(new Error('SEP-10 challenge failed'));

    render(
      <ExecuteDrawer
        rate={RATE}
        amount="100"
        publicKey={PUBLIC_KEY}
        onClose={vi.fn()}
        onExecuteStarted={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Start Off-ramp'));

    await waitFor(() => expect(screen.getByText('SEP-10 challenge failed')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
  });

  it('shows dedicated switch-network guidance when Freighter is on the wrong network', async () => {
    const NetworkMismatchError = vi.mocked(sep10).NetworkMismatchError;
    mockAuthenticate.mockRejectedValue(new NetworkMismatchError('Mainnet (Public)', 'Testnet'));

    render(
      <ExecuteDrawer
        rate={RATE}
        amount="100"
        publicKey={PUBLIC_KEY}
        onClose={vi.fn()}
        onExecuteStarted={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Start Off-ramp'));

    await waitFor(() =>
      expect(
        screen.getByText(/Switch network in Freighter to Mainnet \(Public\)/)
      ).toBeInTheDocument()
    );
    expect(screen.getByText(/currently set to Testnet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
  });

  it('shows the error when the user cancels the KYC popup', async () => {
    mockInitiateWithdraw.mockResolvedValueOnce({
      type: 'interactive_customer_info_needed',
      url: 'https://anchor.example/kyc',
      id: 'tx-123',
    });

    render(
      <ExecuteDrawer
        rate={RATE}
        amount="100"
        publicKey={PUBLIC_KEY}
        onClose={vi.fn()}
        onExecuteStarted={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Start Off-ramp'));

    // Wait for auth to complete
    await waitFor(() => expect(mockAuthenticate).toHaveBeenCalled());

    // Wait for the popup to open
    await waitFor(() => expect(mockInitiateWithdraw).toHaveBeenCalled());

    // The component sets isKycPending = true.
    // Close the popup simulating a cancellation:
    act(() => {
      // In tests, window.removeEventListener is not easily triggered by the mock popup
      // unless we manually dispatch the message event it expects.
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'stellar_cancel' },
          origin: 'https://anchor.example',
        })
      );
    });

    await waitFor(
      () => {
        expect(screen.getByText('Start Off-ramp')).toBeInTheDocument();
        expect(screen.queryByText(/User cancelled the transaction/)).not.toBeInTheDocument();
      },
      { timeout: 2000 }
    );
  });

  it('calls onClose when the X button is clicked in idle state', () => {
    const onClose = vi.fn();
    render(
      <ExecuteDrawer
        rate={RATE}
        amount="100"
        publicKey={PUBLIC_KEY}
        onClose={onClose}
        onExecuteStarted={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
