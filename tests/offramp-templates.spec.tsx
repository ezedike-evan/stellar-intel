import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { flags } from '@/lib/flags';
import { saveTemplate } from '@/lib/templates/store';
import OfframpPage from '@/app/offramp/page';
import { useWallet } from '@/contexts/WalletContext';
import { useAnchorRates } from '@/hooks/useAnchorRates';
import { useWalletBalance } from '@/hooks/useWalletBalance';
import { useWithdrawStatus } from '@/hooks/useWithdrawStatus';
import { trackFunnelEvent, TEMPLATE_EVENTS } from '@/lib/analytics';

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

vi.mock('@/contexts/WalletContext', () => ({
  useWallet: vi.fn(),
}));

vi.mock('@/hooks/useAnchorRates', () => ({
  useAnchorRates: vi.fn(),
  RATES_REFRESH_INTERVAL_MS: 30000,
}));

vi.mock('@/hooks/useWalletBalance', () => ({
  useWalletBalance: vi.fn(),
}));

vi.mock('@/hooks/useWithdrawStatus', () => ({
  useWithdrawStatus: vi.fn(),
}));

vi.mock('@/lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analytics')>()),
  trackFunnelEvent: vi.fn(),
}));

const mockUseWallet = vi.mocked(useWallet);
const mockUseAnchorRates = vi.mocked(useAnchorRates);
const mockUseWalletBalance = vi.mocked(useWalletBalance);
const mockUseWithdrawStatus = vi.mocked(useWithdrawStatus);

const PUBLIC_KEY = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

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

describe('/offramp templates (TPL006 & TPL010)', () => {
  let prevFlag: boolean;

  beforeEach(() => {
    prevFlag = flags.intentTemplates;
    flags.intentTemplates = true;
    mockSearch = '';
    mockReplace.mockReset();
    localStorage.clear();

    mockUseWallet.mockReturnValue(connectedWallet());
    mockUseAnchorRates.mockReturnValue({
      rates: undefined,
      anchorErrors: [],
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
      refreshInflight: false,
      lastFetchedAt: null,
    } as any);
    mockUseWalletBalance.mockReturnValue({
      balance: 1000,
      isLoading: false,
      error: undefined,
      refresh: vi.fn(),
    });
    mockUseWithdrawStatus.mockReturnValue({
      status: undefined,
      amountIn: undefined,
      amountInAsset: undefined,
      amountOut: undefined,
      amountOutAsset: undefined,
      amountFee: undefined,
      instructions: undefined,
      moreInfoUrl: undefined,
      message: undefined,
      claimableBalanceId: undefined,
      stellarTransactionId: undefined,
      isLoading: false,
      error: undefined,
    } as any);
  });

  afterEach(() => {
    flags.intentTemplates = prevFlag;
  });

  function renderPage() {
    return render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <OfframpPage />
      </SWRConfig>
    );
  }

  it('connected -> picker shown; choosing sets amount input and updates URL with corridor and amount', async () => {
    const user = userEvent.setup();

    saveTemplate(PUBLIC_KEY, {
      direction: 'offramp',
      label: 'Mum in Lagos',
      corridorId: 'usdc-ngn',
      amount: '250',
    });

    renderPage();

    const select = await screen.findByLabelText('Saved templates');
    expect(select).toBeDefined();

    await user.selectOptions(select, screen.getByText(/Mum in Lagos/));

    const amountInput = screen.getByLabelText(/Amount/i) as HTMLInputElement;
    expect(amountInput.value).toBe('250');

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringContaining('corridor=usdc-ngn&amount=250'),
        expect.anything()
      );
    });

    expect(trackFunnelEvent).toHaveBeenCalledWith(
      TEMPLATE_EVENTS.templateApplied,
      expect.objectContaining({
        direction: 'offramp',
        corridor: 'usdc-ngn',
      })
    );
  });

  it('not connected -> no picker', () => {
    mockUseWallet.mockReturnValue({
      ...connectedWallet(),
      isConnected: false,
      publicKey: null,
    });

    renderPage();

    expect(screen.queryByLabelText('Saved templates')).toBeNull();
  });

  it('flag off -> no picker', () => {
    flags.intentTemplates = false;
    mockUseWallet.mockReturnValue(connectedWallet());

    renderPage();

    expect(screen.queryByLabelText('Saved templates')).toBeNull();
  });

  it('clicking "Manage templates" opens the dialog and closing returns focus to that button', async () => {
    const user = userEvent.setup();

    saveTemplate(PUBLIC_KEY, {
      direction: 'offramp',
      label: 'Mum in Lagos',
      corridorId: 'usdc-ngn',
      amount: '250',
    });

    renderPage();

    const manageBtn = await screen.findByRole('button', { name: 'Manage templates' });
    await user.click(manageBtn);

    expect(screen.getByRole('dialog', { name: 'Manage templates' })).toBeDefined();

    // Close the dialog
    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(manageBtn);
  });
});
