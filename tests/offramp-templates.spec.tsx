import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { flags } from '@/lib/flags';
import { listTemplates } from '@/lib/templates/store';
import OfframpPage from '@/app/offramp/page';
import { useWallet } from '@/contexts/WalletContext';
import { useAnchorRates } from '@/hooks/useAnchorRates';
import { useWalletBalance } from '@/hooks/useWalletBalance';
import { useWithdrawStatus } from '@/hooks/useWithdrawStatus';

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

vi.mock('@/components/offramp/ExecuteDrawer', () => ({
  ExecuteDrawer: ({
    rate,
    onClose,
    onExecuteStarted,
  }: {
    rate: { anchorId: string } | null;
    onClose: () => void;
    onExecuteStarted: (id: string, server: string, jwt: string, domain: string) => void;
  }) =>
    rate ? (
      <div data-testid="execute-drawer" data-anchor={rate.anchorId}>
        <button
          onClick={() => {
            onExecuteStarted(
              'tx-offramp-123',
              'https://cowrie.exchange/sep24',
              'test-jwt',
              'cowrie.exchange'
            );
            onClose();
          }}
        >
          Confirm in drawer
        </button>
      </div>
    ) : null,
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

describe('/offramp save template (#2161 / TPL008)', () => {
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

  it('when withdrawal completes, SaveTemplateForm appears and saving adds template to store', async () => {
    const user = userEvent.setup();

    mockUseAnchorRates.mockReturnValue({
      rates: {
        rates: [
          {
            anchorId: 'cowrie',
            corridorId: 'usdc-ngn',
            anchorName: 'Cowrie',
            exchangeRate: 1500,
            sourceAsset: 'USDC',
            destinationAsset: 'NGN',
            totalReceived: 150000,
            fee: 0,
          } as any,
        ],
      } as any,
      anchorErrors: [],
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
      refreshInflight: false,
      lastFetchedAt: null,
      pauseRefresh: vi.fn(),
      resumeRefresh: vi.fn(),
    } as any);

    mockUseWithdrawStatus.mockReturnValue({
      status: 'completed',
      amountIn: '100',
      amountInAsset: 'USDC',
      amountOut: '150000',
      amountOutAsset: 'NGN',
      amountFee: '0',
      isLoading: false,
      error: undefined,
    } as any);

    renderPage();

    // Select anchor row to open drawer
    const offrampBtn = await screen.findByRole('button', { name: 'Off-ramp' });
    await user.click(offrampBtn);

    // Confirm in drawer to start execution
    const confirmBtn = await screen.findByRole('button', { name: 'Confirm in drawer' });
    await user.click(confirmBtn);

    // SaveTemplateForm should now be visible
    expect(await screen.findByRole('heading', { name: 'Save this as a template?' })).toBeDefined();

    // Click "Save template"
    const saveBtn = screen.getByRole('button', { name: 'Save template' });
    await user.click(saveBtn);

    // Form shows saved status
    expect(await screen.findByRole('status')).toBeDefined();

    // Template is in store with cowrie anchorId
    const saved = listTemplates(PUBLIC_KEY, 'offramp');
    expect(saved.length).toBe(1);
    expect(saved[0]?.anchorId).toBe('cowrie');
    expect(saved[0]?.corridorId).toBe('usdc-ngn');
  });

  it('when withdrawal status is pending_anchor, SaveTemplateForm is not shown', async () => {
    const user = userEvent.setup();

    mockUseAnchorRates.mockReturnValue({
      rates: {
        rates: [
          {
            anchorId: 'cowrie',
            corridorId: 'usdc-ngn',
            anchorName: 'Cowrie',
            exchangeRate: 1500,
            sourceAsset: 'USDC',
            destinationAsset: 'NGN',
            totalReceived: 150000,
            fee: 0,
          } as any,
        ],
      } as any,
      anchorErrors: [],
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
      refreshInflight: false,
      lastFetchedAt: null,
      pauseRefresh: vi.fn(),
      resumeRefresh: vi.fn(),
    } as any);

    mockUseWithdrawStatus.mockReturnValue({
      status: 'pending_anchor',
      amountIn: '100',
      amountInAsset: 'USDC',
      amountOut: '150000',
      amountOutAsset: 'NGN',
      amountFee: '0',
      isLoading: false,
      error: undefined,
    } as any);

    renderPage();

    const offrampBtn = await screen.findByRole('button', { name: 'Off-ramp' });
    await user.click(offrampBtn);

    const confirmBtn = await screen.findByRole('button', { name: 'Confirm in drawer' });
    await user.click(confirmBtn);

    expect(screen.queryByRole('heading', { name: 'Save this as a template?' })).toBeNull();
  });
});
