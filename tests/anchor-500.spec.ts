/**
 * #199 [#108] anchor returns 500 mid-flow
 *
 * Mock anchor server returns 500 on withdraw POST. Verifies the drawer
 * surfaces a typed Sep24WithdrawError and the StatusTracker never mounts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createElement, useState } from 'react';
import { ExecuteDrawer } from '@/components/offramp/ExecuteDrawer';
import { StatusTracker } from '@/components/offramp/StatusTracker';
import { Sep24WithdrawError } from '@/lib/stellar/sep24';
import type { AnchorRate, ResolvedAnchor } from '@/types';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/stellar/sep10', async () => {
  const actual = await vi.importActual<typeof import('@/lib/stellar/sep10')>('@/lib/stellar/sep10');
  return {
    ...actual,
    authenticate: vi.fn(),
  };
});

vi.mock('@/lib/stellar/sep24', async () => {
  const actual = await vi.importActual<typeof import('@/lib/stellar/sep24')>('@/lib/stellar/sep24');
  return {
    ...actual,
    initiateWithdraw: vi.fn(),
    getWithdrawTransactionRecord: vi.fn(),
  };
});

vi.mock('@/lib/stellar/anchors', () => ({
  getAnchorById: vi.fn(),
  getResolvedAnchorById: vi.fn(),
}));

vi.mock('@/lib/stellar/horizon', () => ({
  buildWithdrawPayment: vi.fn(),
  signAndSubmitPayment: vi.fn(),
}));

import * as sep10 from '@/lib/stellar/sep10';
import * as sep24 from '@/lib/stellar/sep24';
import * as anchors from '@/lib/stellar/anchors';

const mockAuthenticate = vi.mocked(sep10.authenticate);
const mockInitiateWithdraw = vi.mocked(sep24.initiateWithdraw);
const mockGetResolvedAnchorById = vi.mocked(anchors.getResolvedAnchorById);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TRANSFER_SERVER = 'https://transfer.cowrie.exchange';

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

const RESOLVED_ANCHOR = {
  id: 'cowrie',
  name: 'Cowrie',
  homeDomain: 'cowrie.exchange',
  corridors: ['usdc-ngn'],
  assetCode: 'USDC',
  assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  TRANSFER_SERVER_SEP0024: TRANSFER_SERVER,
  WEB_AUTH_ENDPOINT: 'https://auth.cowrie.exchange',
  SIGNING_KEY: 'GANCHOR123',
  capabilities: { sep10: true, sep24: true, sep38: false, sep12: false },
  domain: 'cowrie.exchange',
  ANCHOR_QUOTE_SERVER: null,
  NETWORK_PASSPHRASE: null,
  ORG_URL: null,
  ORG_SUPPORT_EMAIL: null,
  ORG_SUPPORT_URL: null,
  CURRENCIES: [],
} satisfies ResolvedAnchor;

const PUBLIC_KEY = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789';

const AUTH = {
  jwt: 'test.jwt.token',
  anchorDomain: 'cowrie.exchange',
  publicKey: PUBLIC_KEY,
  expiresAt: new Date(Date.now() + 86400_000),
};

const WITHDRAW_500_ERROR = new Sep24WithdrawError(
  500,
  { error: 'internal server error' },
  TRANSFER_SERVER
);

function OfframpHarness({
  onExecuteStarted = vi.fn(),
}: {
  onExecuteStarted?: (
    transactionId: string,
    transferServer: string,
    jwt: string,
    anchorHomeDomain: string
  ) => void;
}) {
  const [trackingTransactionId, setTrackingTransactionId] = useState<string | null>(null);

  const handleExecuteStarted = (
    transactionId: string,
    transferServer: string,
    jwt: string,
    anchorHomeDomain: string
  ) => {
    setTrackingTransactionId(transactionId);
    onExecuteStarted(transactionId, transferServer, jwt, anchorHomeDomain);
  };

  return createElement(
    'div',
    null,
    trackingTransactionId &&
      createElement(StatusTracker, {
        transactionId: trackingTransactionId,
        status: undefined,
        amountIn: undefined,
        amountInAsset: undefined,
        amountOut: undefined,
        amountOutAsset: undefined,
        amountFee: undefined,
        currencyCode: 'NGN',
        stellarTransactionId: undefined,
        externalTransactionId: undefined,
        isLoading: true,
        error: undefined,
      }),
    createElement(ExecuteDrawer, {
      rate: RATE,
      amount: '100',
      publicKey: PUBLIC_KEY,
      onClose: vi.fn(),
      onExecuteStarted: handleExecuteStarted,
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetResolvedAnchorById.mockResolvedValue(RESOLVED_ANCHOR);
  mockAuthenticate.mockResolvedValue(AUTH);
  mockInitiateWithdraw.mockRejectedValue(WITHDRAW_500_ERROR);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── ExecuteDrawer — typed error surfaced mid-flow ────────────────────────────

describe('[#108] anchor returns 500 mid-flow', () => {
  it('mock anchor returns Sep24WithdrawError on withdraw POST', () => {
    expect(WITHDRAW_500_ERROR).toBeInstanceOf(Sep24WithdrawError);
    expect(WITHDRAW_500_ERROR.status).toBe(500);
    expect(WITHDRAW_500_ERROR.message).toMatch(/HTTP 500/);
  });

  it('drawer renders typed error after withdraw POST fails with 500', async () => {
    render(
      createElement(ExecuteDrawer, {
        rate: RATE,
        amount: '100',
        publicKey: PUBLIC_KEY,
        onClose: vi.fn(),
        onExecuteStarted: vi.fn(),
      })
    );

    fireEvent.click(screen.getByText('Start Off-ramp'));

    await waitFor(() =>
      expect(screen.getByText(/Withdraw initiation failed: HTTP 500/)).toBeTruthy()
    );
    expect(screen.getByText(new RegExp(TRANSFER_SERVER.replace(/\./g, '\\.')))).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeTruthy();
  });

  it('does not render the KYC iframe when withdraw POST fails with 500', async () => {
    render(
      createElement(ExecuteDrawer, {
        rate: RATE,
        amount: '100',
        publicKey: PUBLIC_KEY,
        onClose: vi.fn(),
        onExecuteStarted: vi.fn(),
      })
    );

    fireEvent.click(screen.getByText('Start Off-ramp'));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Try Again' })).toBeTruthy());

    expect(screen.queryByRole('dialog', { name: /kyc/i })).toBeNull();
    expect(mockInitiateWithdraw).toHaveBeenCalledOnce();
    expect(mockAuthenticate).toHaveBeenCalledOnce();
  });

  it('StatusTracker does not mount when withdraw POST returns 500', async () => {
    const onExecuteStarted = vi.fn();

    render(createElement(OfframpHarness, { onExecuteStarted }));

    fireEvent.click(screen.getByText('Start Off-ramp'));

    await waitFor(() =>
      expect(screen.getByText(/Withdraw initiation failed: HTTP 500/)).toBeTruthy()
    );

    expect(onExecuteStarted).not.toHaveBeenCalled();
    expect(screen.queryByText('Fetching status…')).toBeNull();
  });
});
