import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { SWRConfig } from 'swr';

const mockReplace = vi.fn();
let mockSearch = '';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

// next/dynamic would load the drawer lazily; resolve it through React.lazy so the
// stubbed module below renders as soon as it is picked.
vi.mock('next/dynamic', async () => {
  const React = await import('react');
  return {
    default: (loader: () => Promise<React.ComponentType<any>>) => {
      const Lazy = React.lazy(async () => ({ default: await loader() }));
      return (props: object) =>
        React.createElement(
          React.Suspense,
          { fallback: null },
          React.createElement(Lazy as React.ComponentType<object>, props)
        );
    },
  };
});

// The drawer is covered by its own spec. Here it only needs to show that it was
// opened for the picked row, and to report a started deposit.
vi.mock('@/components/onramp/DepositDrawer', () => ({
  DepositDrawer: ({
    rate,
    onClose,
    onDepositStarted,
  }: {
    rate: { anchorId: string } | null;
    onClose: () => void;
    onDepositStarted: (id: string, server: string, jwt: string, domain: string) => void;
  }) =>
    rate ? (
      <div data-testid="deposit-drawer" data-anchor={rate.anchorId}>
        <button
          onClick={() => {
            onDepositStarted(
              'deposit-tx-1',
              'https://stellar.moneygram.com/sep24',
              'test-jwt',
              'stellar.moneygram.com'
            );
            onClose();
          }}
        >
          Stub start
        </button>
        <button onClick={onClose}>Stub close</button>
      </div>
    ) : null,
}));

vi.mock('@/contexts/WalletContext', () => ({
  useWallet: vi.fn(),
}));

vi.mock('@/hooks/useDepositRates', () => ({
  useDepositRates: vi.fn(),
}));

vi.mock('@/lib/stellar/sep24', async () => {
  const actual = await vi.importActual<typeof import('@/lib/stellar/sep24')>('@/lib/stellar/sep24');
  return { ...actual, getSep24Transaction: vi.fn() };
});

vi.mock('@/lib/intent/sign', async () => {
  const actual = await vi.importActual<typeof import('@/lib/intent/sign')>('@/lib/intent/sign');
  return { ...actual, signIntent: vi.fn() };
});

import { useWallet } from '@/contexts/WalletContext';
import { useDepositRates } from '@/hooks/useDepositRates';
import * as sep24 from '@/lib/stellar/sep24';
import * as sign from '@/lib/intent/sign';
import { IntentSignError } from '@/lib/intent/sign';
import OnrampPage from '@/app/onramp/page';
import type { DepositRateComparison } from '@/types';

const mockUseWallet = vi.mocked(useWallet);
const mockUseDepositRates = vi.mocked(useDepositRates);
const mockGetSep24Transaction = vi.mocked(sep24.getSep24Transaction);
const mockSignIntent = vi.mocked(sign.signIntent);

const PUBLIC_KEY = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const USDC_ID = `stellar:USDC:${USDC_ISSUER}`;
const XLM_ID = 'stellar:native';
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
    {
      anchorId: 'moneygram',
      anchorName: 'MoneyGram',
      corridorId: 'usdc-ngn',
      asset: XLM_ID,
      fiatAmount: 100,
      fee: null,
      feeType: 'flat',
      exchangeRate: 0.02,
      totalReceived: 2,
      source: 'sep24-fee',
      updatedAt: new Date('2026-10-21T08:00:00Z'),
    },
  ],
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

/** Picks the USDC row, which is what the asset selector defaults to. */
async function startDeposit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Deposit with MoneyGram' }));
  await user.click(await screen.findByRole('button', { name: 'Stub start' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSearch = '';
  mockUseWallet.mockReturnValue(connectedWallet());
  mockUseDepositRates.mockReturnValue({
    rates: COMPARISON,
    anchorErrors: [],
    isLoading: false,
    error: undefined,
    mutate: vi.fn(),
    lastFetchedAt: null,
  });
  mockGetSep24Transaction.mockResolvedValue({
    id: 'deposit-tx-1',
    status: 'completed',
    updatedAt: new Date(),
    amountOut: '66.17',
    amountOutAsset: USDC_ID,
    stellarTransactionId: 'a'.repeat(64),
  });
  mockSignIntent.mockResolvedValue({
    intentHash: INTENT_HASH,
    signature: 'c2lnbmF0dXJl',
    publicKey: PUBLIC_KEY,
  });
});

describe('/onramp page (#1479)', () => {
  it('renders the comparator heading and the estimate table', () => {
    renderPage();
    expect(screen.getByText('On-ramp Comparator')).toBeTruthy();
    expect(screen.getByText('Compare deposit estimates across Stellar anchors')).toBeTruthy();
    expect(screen.getByText('MoneyGram')).toBeTruthy();
    expect(screen.getByText('≈ 66.17 USDC')).toBeTruthy();
    expect(screen.getByText(/Estimates only/)).toBeTruthy();
  });

  it('prompts for a wallet and disables Deposit when disconnected', () => {
    mockUseWallet.mockReturnValue({ ...connectedWallet(), isConnected: false, publicKey: null });
    renderPage();

    expect(screen.getByText('Connect your Freighter wallet to deposit.')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Deposit with MoneyGram' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('disables Deposit when the wallet is not on the public network', () => {
    mockUseWallet.mockReturnValue({ ...connectedWallet(), network: 'TESTNET' });
    renderPage();

    expect(screen.queryByText('Connect your Freighter wallet to deposit.')).toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Deposit with MoneyGram' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('lists the comparison’s distinct assets and shows the first by default', () => {
    renderPage();

    const select = screen.getByLabelText('Receive asset') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['USDC', 'XLM']);
    expect(select.value).toBe(USDC_ID);
    expect(screen.queryByText('≈ 2.00 XLM')).toBeNull();
  });

  it('filters the table to the chosen asset', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByLabelText('Receive asset'), XLM_ID);

    expect(screen.getByText('≈ 2.00 XLM')).toBeTruthy();
    expect(screen.queryByText('≈ 66.17 USDC')).toBeNull();
  });

  it('reads corridor and amount from the query string and writes them back', async () => {
    mockSearch = 'corridor=usdc-kes&amount=250';
    renderPage();

    expect((screen.getByLabelText('Amount (KES)') as HTMLInputElement).value).toBe('250');
    expect(mockUseDepositRates).toHaveBeenCalledWith('usdc-kes', '250');
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringContaining('corridor=usdc-kes'),
        expect.anything()
      )
    );
  });

  it('ignores an invalid corridor or amount in the query string', () => {
    mockSearch = 'corridor=nope&amount=-5';
    renderPage();

    expect(mockUseDepositRates).toHaveBeenCalledWith('usdc-ngn', '100');
  });

  it('opens the drawer for the row that was picked', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.queryByTestId('deposit-drawer')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Deposit with MoneyGram' }));

    const drawer = await screen.findByTestId('deposit-drawer');
    expect(drawer.getAttribute('data-anchor')).toBe('moneygram');
  });

  it('closes the drawer again', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Deposit with MoneyGram' }));

    await user.click(await screen.findByRole('button', { name: 'Stub close' }));

    expect(screen.queryByTestId('deposit-drawer')).toBeNull();
  });

  it('renders the deposit tracker for a started deposit', async () => {
    stubAppendFetch();
    const user = userEvent.setup();
    renderPage();
    expect(screen.queryByText('Deposit status')).toBeNull();

    await startDeposit(user);

    expect(await screen.findByText('Deposit status')).toBeTruthy();
    expect(screen.getAllByText(/deposit-tx-1/).length).toBeGreaterThan(0);
    expect(await screen.findByText('You received 66.17 USDC')).toBeTruthy();
    expect(screen.getByText('stellar.moneygram.com')).toBeTruthy();
  });
});

describe('/onramp page signed outcomes (ONR032)', () => {
  it('signs the onramp intent when a deposit starts', async () => {
    stubAppendFetch();
    const user = userEvent.setup();
    renderPage();

    await startDeposit(user);

    await waitFor(() => expect(mockSignIntent).toHaveBeenCalledTimes(1));
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
  });

  it('posts one attested append row with direction deposit when the deposit completes', async () => {
    const fetchFn = stubAppendFetch();
    const user = userEvent.setup();
    renderPage();

    await startDeposit(user);

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

    await startDeposit(user);

    // Tracking starts regardless of the declined signature…
    await waitFor(() => expect(screen.queryAllByText(/deposit-tx-1/).length).toBeGreaterThan(0));
    // …no error is surfaced…
    expect(screen.queryByRole('alert')).toBeNull();
    // …and no unsigned outcome is posted: the append route would answer 401.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(appendCalls(fetchFn)).toHaveLength(0);
  });
});
