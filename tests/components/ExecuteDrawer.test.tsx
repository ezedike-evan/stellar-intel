import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ExecuteDrawer } from '@/components/offramp/ExecuteDrawer';
import type { AnchorRate } from '@/types';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/stellar/sep10', () => ({
  authenticate: vi.fn(),
}));

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
}));

vi.mock('@/lib/stellar/horizon', () => ({
  buildWithdrawPayment: vi.fn(),
  signAndSubmitPayment: vi.fn(),
}));

import * as sep10 from '@/lib/stellar/sep10';
import * as sep24 from '@/lib/stellar/sep24';
import * as sep1 from '@/lib/stellar/sep1';
import * as anchors from '@/lib/stellar/anchors';
import * as horizon from '@/lib/stellar/horizon';

const mockAuthenticate = vi.mocked(sep10.authenticate);
const mockInitiateWithdraw = vi.mocked(sep24.initiateWithdraw);
const mockOpenWithdrawPopup = vi.mocked(sep24.openWithdrawPopup);
const mockGetWithdrawTransactionRecord = vi.mocked(sep24.getWithdrawTransactionRecord);
const mockGetTransferServer = vi.mocked(sep1.getTransferServer);
const mockGetAnchorById = vi.mocked(anchors.getAnchorById);
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

const AUTH = {
  jwt: 'test.jwt.token',
  anchorDomain: 'cowrie.exchange',
  publicKey: 'GABCDE',
  expiresAt: new Date(Date.now() + 86400_000),
};

const PUBLIC_KEY = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAnchorById.mockReturnValue(ANCHOR);
  mockAuthenticate.mockResolvedValue(AUTH);
  mockGetTransferServer.mockResolvedValue('https://transfer.cowrie.exchange');
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ExecuteDrawer', () => {
  it('renders the dialog shell but no anchor name when rate is null', () => {
    render(<ExecuteDrawer rate={null} amount="100" publicKey={PUBLIC_KEY} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeInTheDocument();
    // No anchor-specific content should appear
    expect(screen.queryByText('Cowrie')).not.toBeInTheDocument();
    expect(screen.queryByText('100 USDC')).not.toBeInTheDocument();
  });

  it('shows the anchor name and transaction summary when a rate is provided', () => {
    render(<ExecuteDrawer rate={RATE} amount="100" publicKey={PUBLIC_KEY} onClose={vi.fn()} />);
    expect(screen.getByText(/Cowrie/)).toBeInTheDocument();
    expect(screen.getByText('100 USDC')).toBeInTheDocument();
    expect(screen.getByText('Start Off-ramp')).toBeInTheDocument();
  });

  it('runs through the full happy path and shows the tx hash', async () => {
    render(<ExecuteDrawer rate={RATE} amount="100" publicKey={PUBLIC_KEY} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('Start Off-ramp'));

    await waitFor(() => expect(screen.getByText('Transaction submitted')).toBeInTheDocument());

    expect(mockAuthenticate).toHaveBeenCalledWith('cowrie.exchange', PUBLIC_KEY);
    expect(mockInitiateWithdraw).toHaveBeenCalled();
    expect(mockOpenWithdrawPopup).toHaveBeenCalledWith('https://anchor.example/kyc');
    expect(mockBuildWithdrawPayment).toHaveBeenCalled();
    expect(mockSignAndSubmitPayment).toHaveBeenCalled();
    expect(screen.getByText('abc123txhash')).toBeInTheDocument();
  });

  it('shows the error message and a Try Again button when authentication fails', async () => {
    mockAuthenticate.mockRejectedValue(new Error('SEP-10 challenge failed'));

    render(<ExecuteDrawer rate={RATE} amount="100" publicKey={PUBLIC_KEY} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('Start Off-ramp'));

    await waitFor(() => expect(screen.getByText('SEP-10 challenge failed')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
  });

  it('shows the error when the user cancels the KYC popup', async () => {
    mockOpenWithdrawPopup.mockRejectedValue(new Error('User cancelled the transaction'));

    render(<ExecuteDrawer rate={RATE} amount="100" publicKey={PUBLIC_KEY} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('Start Off-ramp'));

    await waitFor(() =>
      expect(screen.getByText('User cancelled the transaction')).toBeInTheDocument()
    );
  });

  it('calls onClose when the X button is clicked in idle state', () => {
    const onClose = vi.fn();
    render(<ExecuteDrawer rate={RATE} amount="100" publicKey={PUBLIC_KEY} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
