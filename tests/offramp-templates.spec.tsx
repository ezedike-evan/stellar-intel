import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { flags } from '@/lib/flags';
import { listTemplates, saveTemplate } from '@/lib/templates/store';
import { trackFunnelEvent } from '@/lib/analytics';
import { useWallet } from '@/contexts/WalletContext';
import OfframpPage from '@/app/offramp/page';

const mockReplace = vi.fn();
let mockWithdrawStatus: string | null = null;

const RATE = {
  anchorId: 'cowrie',
  anchorName: 'Cowrie',
  corridorId: 'usdc-ngn',
  exchangeRate: null,
  totalReceived: null,
};

// A row button and a drawer button stand in for RateTable and ExecuteDrawer,
// which have their own specs.
vi.mock('@/components/offramp/RateTable', () => ({
  RateTable: ({ onSelectAnchor }: { onSelectAnchor: (rate: typeof RATE) => void }) => (
    <button onClick={() => onSelectAnchor(RATE)}>Stub select</button>
  ),
}));

vi.mock('@/components/offramp/ExecuteDrawer', () => ({
  ExecuteDrawer: ({
    rate,
    onExecuteStarted,
  }: {
    rate: unknown;
    onExecuteStarted: (id: string, server: string, jwt: string, domain: string) => void;
  }) =>
    rate ? (
      <button
        onClick={() =>
          onExecuteStarted('tx-1', 'https://cowrie.example/sep24', 'jwt', 'cowrie.example')
        }
      >
        Stub start
      </button>
    ) : null,
}));

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
    status: mockWithdrawStatus,
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
  mockWithdrawStatus = null;
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

describe('/offramp save as template (#2161)', () => {
  async function startOfframp() {
    render(<OfframpPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Stub select' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stub start' }));
  }

  it('offers to save a completed off-ramp and stores it with the anchor', async () => {
    connect(true);
    mockWithdrawStatus = 'completed';
    await startOfframp();

    const name = await screen.findByLabelText('Template name');
    fireEvent.change(name, { target: { value: 'Cowrie run' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Saved as "Cowrie run".');
    const saved = listTemplates(WALLET, 'offramp').find((t) => t.label === 'Cowrie run');
    expect(saved).toMatchObject({ corridorId: 'usdc-ngn', anchorId: 'cowrie' });
  });

  it('does not offer it before the off-ramp completes', async () => {
    connect(true);
    mockWithdrawStatus = 'pending_anchor';
    await startOfframp();
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    expect(screen.queryByLabelText('Template name')).not.toBeInTheDocument();
  });
});

describe('/offramp template manager (#2163)', () => {
  it('opens from the picker and returns focus to the button on close', async () => {
    connect(true);
    render(<OfframpPage />);
    const manage = await screen.findByRole('button', { name: 'Manage templates' });
    fireEvent.click(manage);
    expect(await screen.findByRole('dialog', { name: 'Manage templates' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Manage templates' })).not.toBeInTheDocument()
    );
    expect(document.activeElement).toBe(manage);
  });
});
