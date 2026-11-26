import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { flags } from '@/lib/flags';
import { listTemplates, saveTemplate } from '@/lib/templates/store';
import OnrampPage from '@/app/onramp/page';
import { useWallet } from '@/contexts/WalletContext';
import { useDepositRates } from '@/hooks/useDepositRates';
import * as sep24 from '@/lib/stellar/sep24';
import * as sign from '@/lib/intent/sign';
import type { DepositRateComparison } from '@/types';

const mockReplace = vi.fn();
let mockSearch = '';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

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

// A button stands in for the drawer and reports a started deposit.
vi.mock('@/components/onramp/DepositDrawer', () => ({
  DepositDrawer: ({
    rate,
    onDepositStarted,
  }: {
    rate: { anchorId: string } | null;
    onDepositStarted: (id: string, server: string, jwt: string, domain: string) => void;
  }) =>
    rate ? (
      <button
        onClick={() =>
          onDepositStarted(
            'deposit-tx-1',
            'https://stellar.moneygram.com/sep24',
            'test-jwt',
            'stellar.moneygram.com'
          )
        }
      >
        Stub start
      </button>
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

vi.mock('@/lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analytics')>()),
  trackFunnelEvent: vi.fn(),
}));

vi.mock('@/lib/intent/sign', async () => {
  const actual = await vi.importActual<typeof import('@/lib/intent/sign')>('@/lib/intent/sign');
  return { ...actual, signIntent: vi.fn() };
});

const mockUseWallet = vi.mocked(useWallet);
const mockUseDepositRates = vi.mocked(useDepositRates);

const PUBLIC_KEY = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const USDC_ID = `stellar:USDC:${USDC_ISSUER}`;

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

function connectedWallet() {
  return {
    isInstalled: true,
    isConnected: true,
    publicKey: PUBLIC_KEY,
    network: 'PUBLIC' as const,
    error: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

describe('/onramp templates (TPL007)', () => {
  let prevFlag: boolean;

  beforeEach(() => {
    prevFlag = flags.intentTemplates;
    flags.intentTemplates = true;
    mockSearch = '';
    mockReplace.mockReset();
    localStorage.clear();

    mockUseWallet.mockReturnValue(connectedWallet());
    mockUseDepositRates.mockReturnValue({
      rates: COMPARISON,
      anchorErrors: [],
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
      lastFetchedAt: null,
    });
  });

  afterEach(() => {
    flags.intentTemplates = prevFlag;
  });

  function renderPage() {
    return render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <OnrampPage />
      </SWRConfig>
    );
  }

  it('updates #deposit-amount and calls router.replace when choosing a seeded on-ramp template', async () => {
    const user = userEvent.setup();

    saveTemplate(PUBLIC_KEY, {
      direction: 'onramp',
      label: 'Monthly Deposit',
      corridorId: 'usdc-ngn',
      amount: '500',
      assetId: USDC_ID,
    });

    renderPage();

    const select = await screen.findByLabelText('Saved templates');
    expect(select).toBeDefined();

    // Select the template
    await user.selectOptions(select, screen.getByText(/Monthly Deposit/));

    // Input #deposit-amount updated
    const amountInput = screen.getByLabelText(/Amount/) as HTMLInputElement;
    expect(amountInput.value).toBe('500');

    // router.replace was called with corridor, amount, and asset
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringContaining('corridor=usdc-ngn'),
        expect.anything()
      );
      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringContaining('amount=500'),
        expect.anything()
      );
      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringContaining(`asset=${encodeURIComponent(USDC_ID)}`),
        expect.anything()
      );
    });
  });

  it('does not list off-ramp templates for the same wallet', async () => {
    // Seed an off-ramp template
    saveTemplate(PUBLIC_KEY, {
      direction: 'offramp',
      label: 'Mum in Lagos',
      corridorId: 'usdc-ngn',
      amount: '200',
    });

    // Seed an on-ramp template
    saveTemplate(PUBLIC_KEY, {
      direction: 'onramp',
      label: 'Save for Rent',
      corridorId: 'usdc-ngn',
      amount: '350',
    });

    renderPage();

    await screen.findByLabelText('Saved templates');

    expect(screen.queryByText(/Save for Rent/)).not.toBeNull();
    expect(screen.queryByText(/Mum in Lagos/)).toBeNull();
  });

  it('renders no picker when wallet is not connected', () => {
    mockUseWallet.mockReturnValue({
      ...connectedWallet(),
      isConnected: false,
      publicKey: null,
    });

    renderPage();

    expect(screen.queryByLabelText('Saved templates')).toBeNull();
  });

  it('renders no picker when intentTemplates flag is off', () => {
    flags.intentTemplates = false;
    mockUseWallet.mockReturnValue(connectedWallet());

    renderPage();

    expect(screen.queryByLabelText('Saved templates')).toBeNull();
  });
});

describe('/onramp save as template (#2162)', () => {
  let prevFlag: boolean;

  beforeEach(() => {
    prevFlag = flags.intentTemplates;
    flags.intentTemplates = true;
    mockSearch = '';
    mockReplace.mockReset();
    localStorage.clear();
    mockUseWallet.mockReturnValue(connectedWallet());
    mockUseDepositRates.mockReturnValue({
      rates: COMPARISON,
      anchorErrors: [],
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
      lastFetchedAt: null,
    });
    vi.mocked(sign.signIntent).mockResolvedValue({
      intentHash: 'a'.repeat(64),
      signature: 'c2lnbmF0dXJl',
      publicKey: PUBLIC_KEY,
    });
  });

  afterEach(() => {
    flags.intentTemplates = prevFlag;
  });

  async function startDeposit(status: string) {
    vi.mocked(sep24.getSep24Transaction).mockResolvedValue({
      id: 'deposit-tx-1',
      status,
      updatedAt: new Date(),
    } as Awaited<ReturnType<typeof sep24.getSep24Transaction>>);
    const user = userEvent.setup();
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <OnrampPage />
      </SWRConfig>
    );
    await user.click(screen.getByRole('button', { name: 'Deposit with MoneyGram' }));
    await user.click(await screen.findByRole('button', { name: 'Stub start' }));
    return user;
  }

  it('offers to save a completed deposit, keeping the asset', async () => {
    const user = await startDeposit('completed');
    const name = await screen.findByLabelText('Template name');
    await user.clear(name);
    await user.type(name, 'Monthly top-up');
    await user.click(screen.getByRole('button', { name: 'Save template' }));

    expect(await screen.findByText('Saved as "Monthly top-up".')).toHaveAttribute('role', 'status');
    const saved = listTemplates(PUBLIC_KEY, 'onramp').find((t) => t.label === 'Monthly top-up');
    expect(saved).toMatchObject({ anchorId: 'moneygram', assetId: USDC_ID });
  });

  it('does not offer it while the deposit is pending', async () => {
    await startDeposit('pending_user_transfer_start');
    await waitFor(() => expect(vi.mocked(sep24.getSep24Transaction)).toHaveBeenCalled());
    expect(screen.queryByLabelText('Template name')).not.toBeInTheDocument();
  });
});
