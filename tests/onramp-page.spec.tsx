import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { SWRConfig } from 'swr';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/contexts/WalletContext', () => ({
  useWallet: vi.fn(),
}));

vi.mock('@/hooks/useDepositRates', () => ({
  useDepositRates: vi.fn(),
}));

vi.mock('@/lib/stellar/anchors', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/stellar/anchors')>('@/lib/stellar/anchors');
  return { ...actual, getResolvedAnchorById: vi.fn() };
});

vi.mock('@/lib/stellar/sep10', async () => {
  const actual = await vi.importActual<typeof import('@/lib/stellar/sep10')>('@/lib/stellar/sep10');
  return { ...actual, authenticate: vi.fn() };
});

vi.mock('@/lib/stellar/sep24', async () => {
  const actual = await vi.importActual<typeof import('@/lib/stellar/sep24')>('@/lib/stellar/sep24');
  return { ...actual, initiateDeposit: vi.fn(), getSep24Transaction: vi.fn() };
});

vi.mock('@/lib/intent/sign', async () => {
  const actual = await vi.importActual<typeof import('@/lib/intent/sign')>('@/lib/intent/sign');
  return { ...actual, signIntent: vi.fn() };
});

import { useWallet } from '@/contexts/WalletContext';
import { useDepositRates } from '@/hooks/useDepositRates';
import * as anchors from '@/lib/stellar/anchors';
import * as sep10 from '@/lib/stellar/sep10';
import * as sep24 from '@/lib/stellar/sep24';
import * as sign from '@/lib/intent/sign';
import { IntentSignError } from '@/lib/intent/sign';
import OnrampPage from '@/app/onramp/page';
import type { DepositRateComparison } from '@/types';

const mockUseWallet = vi.mocked(useWallet);
const mockUseDepositRates = vi.mocked(useDepositRates);
const mockGetResolvedAnchorById = vi.mocked(anchors.getResolvedAnchorById);
const mockAuthenticate = vi.mocked(sep10.authenticate);
const mockInitiateDeposit = vi.mocked(sep24.initiateDeposit);
const mockGetSep24Transaction = vi.mocked(sep24.getSep24Transaction);
const mockSignIntent = vi.mocked(sign.signIntent);

const PUBLIC_KEY = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const USDC_ID = `stellar:USDC:${USDC_ISSUER}`;
const INTENT_HASH = 'f'.repeat(64);

const COMPARISON: DepositRateComparison = {
  corridorId: 'usdc-ngn',
  direction: 'deposit',
  bestRateId: 'moneygram',
  errors: [],
  rates: [
    {
      anchorId: 'moneygram',
      anchorName: 'MoneyGram',
      corridorId: 'usdc-ngn',
      asset: USDC_ID,
      fiatAmount: 100,
      fee: 0.5,
      feeType: 'flat',
      exchangeRate: 0.000663,
      totalReceived: 66.17,
      source: 'sep24-fee',
      referenceSource: 'test reference',
      updatedAt: new Date('2026-10-21T08:00:00Z'),
    },
  ],
};

const RESOLVED_ANCHOR = {
  id: 'moneygram',
  name: 'MoneyGram',
  homeDomain: 'stellar.moneygram.com',
  corridors: ['usdc-ngn'],
  assetCode: 'USDC',
  assetIssuer: USDC_ISSUER,
  TRANSFER_SERVER_SEP0024: 'https://stellar.moneygram.com/sep24',
  WEB_AUTH_ENDPOINT: 'https://stellar.moneygram.com/auth',
  SIGNING_KEY: 'G...',
  capabilities: { sep10: true, sep24: true, sep38: false, sep12: false },
  domain: 'stellar.moneygram.com',
  ANCHOR_QUOTE_SERVER: null,
  NETWORK_PASSPHRASE: null,
  ORG_URL: null,
  ORG_SUPPORT_EMAIL: null,
  ORG_SUPPORT_URL: null,
  CURRENCIES: [],
};

function connectedWallet() {
  return {
    isInstalled: true,
    isConnected: true,
    publicKey: PUBLIC_KEY,
    network: 'PUBLIC',
    error: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

/** Captures POSTs to the reputation append path; answers nothing else. */
function stubAppendFetch() {
  const fn = vi.fn(async (input: unknown) => {
    const url = typeof input === 'string' ? input : String((input as Request)?.url ?? '');
    if (url.includes('/api/reputation/append')) {
      return { ok: true, json: async () => ({ ok: true }) };
    }
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function appendCalls(fn: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  return fn.mock.calls
    .filter((c) => String(c[0]).includes('/api/reputation/append'))
    .map((c) => JSON.parse((c[1] as RequestInit).body as string) as Record<string, unknown>);
}

function renderPage() {
  return render(
    createElement(SWRConfig, { value: { provider: () => new Map() } }, createElement(OnrampPage))
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('open', vi.fn());
  mockUseWallet.mockReturnValue(connectedWallet());
  mockUseDepositRates.mockReturnValue({
    rates: COMPARISON,
    anchorErrors: [],
    isLoading: false,
    error: undefined,
    mutate: vi.fn(),
    lastFetchedAt: null,
  });
  mockGetResolvedAnchorById.mockResolvedValue(RESOLVED_ANCHOR);
  mockAuthenticate.mockResolvedValue({
    jwt: 'test-jwt',
    anchorDomain: 'stellar.moneygram.com',
    publicKey: PUBLIC_KEY,
    expiresAt: new Date(Date.now() + 600_000),
  });
  mockInitiateDeposit.mockResolvedValue({
    type: 'interactive_customer_info_needed',
    url: 'https://stellar.moneygram.com/kyc/session',
    id: 'deposit-tx-1',
  });
  mockGetSep24Transaction.mockResolvedValue({
    id: 'deposit-tx-1',
    status: 'completed',
    updatedAt: new Date(),
    amountOut: '66.17',
    stellarTransactionId: 'a'.repeat(64),
  });
  mockSignIntent.mockResolvedValue({
    intentHash: INTENT_HASH,
    signature: 'c2lnbmF0dXJl',
    publicKey: PUBLIC_KEY,
  });
});

describe('/onramp page (ONR032)', () => {
  it('renders the comparator heading and the estimate table', () => {
    renderPage();
    expect(screen.getByText('On-ramp Comparator')).toBeTruthy();
    expect(screen.getByText('Compare deposit estimates across Stellar anchors')).toBeTruthy();
    expect(screen.getByText('MoneyGram')).toBeTruthy();
    expect(screen.getByText('≈ 66.17 USDC')).toBeTruthy();
  });

  it('prompts for a wallet and disables Deposit when disconnected', () => {
    mockUseWallet.mockReturnValue({
      ...connectedWallet(),
      isConnected: false,
      publicKey: null,
    });
    renderPage();
    expect(screen.getByText('Connect your Freighter wallet to deposit.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Deposit' }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('signs the onramp intent when a deposit starts', async () => {
    stubAppendFetch();
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Deposit' }));

    await waitFor(() => expect(mockSignIntent).toHaveBeenCalledTimes(1));
    expect(mockInitiateDeposit).toHaveBeenCalledWith(
      RESOLVED_ANCHOR,
      expect.objectContaining({
        jwt: 'test-jwt',
        assetCode: 'USDC',
        assetIssuer: USDC_ISSUER,
        account: PUBLIC_KEY,
      })
    );
    // The input is in fiat, but SEP-24 reads `amount` in asset units, so the
    // anchor's interactive flow collects the amount instead.
    expect(mockInitiateDeposit.mock.calls[0]![1]).not.toHaveProperty('amount');
    expect(mockSignIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'onramp',
        sourceAsset: 'NGN',
        destinationAsset: 'USDC',
        destination: PUBLIC_KEY,
        recipient: 'moneygram',
        transactionId: 'deposit-tx-1',
      })
    );
    expect(window.open).toHaveBeenCalledWith(
      'https://stellar.moneygram.com/kyc/session',
      'stellar_anchor_deposit',
      expect.any(String)
    );
  });

  it('posts one attested append row with direction deposit when the deposit completes', async () => {
    const fetchFn = stubAppendFetch();
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Deposit' }));

    await waitFor(() => expect(appendCalls(fetchFn)).toHaveLength(1), { timeout: 10_000 });
    const body = appendCalls(fetchFn)[0]!;
    expect(body).toMatchObject({
      intentHash: INTENT_HASH,
      anchorId: 'moneygram',
      corridor: 'usdc-ngn',
      direction: 'deposit',
      quotedAmount: '100',
      outcome: 'completed',
      signature: 'c2lnbmF0dXJl',
      publicKey: PUBLIC_KEY,
    });
    expect(Number(body.quotedRate)).toBeCloseTo(COMPARISON.rates[0]!.exchangeRate!, 9);
  });

  it('still tracks the deposit but posts no outcome when the user rejects the signature', async () => {
    const fetchFn = stubAppendFetch();
    mockSignIntent.mockRejectedValue(new IntentSignError('User declined', 'SIGN_REJECTED'));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Deposit' }));

    // Tracking starts regardless of the declined signature…
    await waitFor(() => expect(screen.queryAllByText(/deposit-tx-1/).length).toBeGreaterThan(0));
    // …no error is surfaced…
    expect(screen.queryByRole('alert')).toBeNull();
    // …and no unsigned outcome is posted: the append route would answer 401.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(appendCalls(fetchFn)).toHaveLength(0);
  });
});
