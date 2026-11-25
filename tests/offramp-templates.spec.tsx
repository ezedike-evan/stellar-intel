import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { flags } from '@/lib/flags';
import { saveTemplate } from '@/lib/templates/store';
import { trackFunnelEvent } from '@/lib/analytics';
import { useWallet } from '@/contexts/WalletContext';
import OfframpPage from '@/app/offramp/page';

const mockReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('next/dynamic', async () => {
  const React = await import('react');
  return {
    default: (loader: () => Promise<React.ComponentType<object>>) => {
      const Lazy = React.lazy(async () => ({ default: await loader() }));
      return (props: object) =>
        React.createElement(React.Suspense, { fallback: null }, React.createElement(Lazy, props));
    },
  };
});

vi.mock('@/contexts/WalletContext', () => ({ useWallet: vi.fn() }));

vi.mock('@/hooks/useAnchorRates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useAnchorRates')>()),
  useAnchorRates: () => ({
    rates: null,
    anchorErrors: [],
    isLoading: false,
    error: null,
    mutate: vi.fn(),
    refreshInflight: false,
    lastFetchedAt: null,
  }),
}));

vi.mock('@/hooks/useWalletBalance', () => ({
  useWalletBalance: () => ({ balance: null, isLoading: false, error: undefined, refresh: vi.fn() }),
}));

vi.mock('@/hooks/useWithdrawStatus', () => ({
  useWithdrawStatus: () => ({
    status: null,
    amountIn: null,
    amountInAsset: null,
    amountOut: null,
    amountOutAsset: null,
    amountFee: null,
    stellarTransactionId: null,
    externalTransactionId: null,
    refunds: null,
    isLoading: false,
    error: null,
    attemptCount: 0,
  }),
}));

vi.mock('@/lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analytics')>()),
  trackFunnelEvent: vi.fn(),
}));

const WALLET = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const originalFlag = flags.intentTemplates;

function connect(connected: boolean) {
  vi.mocked(useWallet).mockReturnValue({
    isConnected: connected,
    publicKey: connected ? WALLET : null,
    network: 'PUBLIC',
  } as unknown as ReturnType<typeof useWallet>);
}

beforeEach(() => {
  localStorage.clear();
  mockReplace.mockClear();
  vi.mocked(trackFunnelEvent).mockClear();
  flags.intentTemplates = true;
  saveTemplate(WALLET, {
    direction: 'offramp',
    label: 'Rent',
    corridorId: 'usdc-ngn',
    amount: '120',
  });
});

afterEach(() => {
  flags.intentTemplates = originalFlag;
});

describe('/offramp templates (#2159)', () => {
  it('applies a saved template to the corridor and amount', async () => {
    connect(true);
    render(<OfframpPage />);
    const select = await screen.findByLabelText('Saved templates');
    const option = screen.getByRole('option', { name: /^Rent — 120/ }) as HTMLOptionElement;
    fireEvent.change(select, { target: { value: option.value } });

    await waitFor(() =>
      expect((document.getElementById('amount-input') as HTMLInputElement).value).toBe('120')
    );
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringMatching(/corridor=usdc-ngn.*amount=120|amount=120.*corridor=usdc-ngn/),
        expect.anything()
      )
    );
    expect(vi.mocked(trackFunnelEvent).mock.calls.map(([name]) => name)).toContain(
      'template_applied'
    );
  });

  it('shows no picker without a connected wallet', () => {
    connect(false);
    render(<OfframpPage />);
    expect(screen.queryByLabelText('Saved templates')).not.toBeInTheDocument();
  });

  it('shows no picker when the flag is off', () => {
    flags.intentTemplates = false;
    connect(true);
    render(<OfframpPage />);
    expect(screen.queryByLabelText('Saved templates')).not.toBeInTheDocument();
  });
});
