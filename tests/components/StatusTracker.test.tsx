import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { StatusTracker } from '@/components/offramp/StatusTracker';

vi.mock('@/lib/stellar/sep1', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stellar/sep1')>();
  return {
    ...actual,
    resolveToml: vi.fn(),
  };
});

import { resolveToml } from '@/lib/stellar/sep1';

const BASE_PROPS = {
  transactionId: 'txn-abc-123',
  status: undefined,
  amountIn: undefined,
  amountInAsset: undefined,
  amountOut: undefined,
  amountOutAsset: undefined,
  amountFee: undefined,
  currencyCode: 'NGN',
  stellarTransactionId: undefined,
  externalTransactionId: undefined,
  isLoading: false,
  error: undefined,
} as const;

beforeEach(() => {
  vi.mocked(resolveToml).mockResolvedValue({
    ok: true,
    data: {
      domain: 'cowrie.exchange',
      TRANSFER_SERVER_SEP0024: null,
      ANCHOR_QUOTE_SERVER: null,
      WEB_AUTH_ENDPOINT: null,
      SIGNING_KEY: null,
      NETWORK_PASSPHRASE: null,
      ORG_URL: 'https://www.cowrie.exchange',
      ORG_SUPPORT_EMAIL: 'support@cowrie.exchange',
      ORG_SUPPORT_URL: null,
      CURRENCIES: [],
      capabilities: { sep10: false, sep24: false, sep38: false, sep12: false },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StatusTracker', () => {
  it('renders the transaction ID', () => {
    render(<StatusTracker {...BASE_PROPS} />);
    expect(screen.getByText('txn-abc-123')).toBeInTheDocument();
  });

  it('shows "Fetching status…" when isLoading is true and status is undefined', () => {
    render(<StatusTracker {...BASE_PROPS} isLoading={true} />);
    expect(screen.getByText('Fetching status…')).toBeInTheDocument();
  });

  it('shows "Completed" label when status is completed', () => {
    render(<StatusTracker {...BASE_PROPS} status="completed" />);
    expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
  });

  it('shows "Awaiting your payment" for pending_user_transfer_start status', () => {
    render(<StatusTracker {...BASE_PROPS} status="pending_user_transfer_start" />);
    expect(screen.getByText('Awaiting your payment')).toBeInTheDocument();
  });

  it('shows completion celebration banner with localized amount when completed', () => {
    render(<StatusTracker {...BASE_PROPS} status="completed" amountIn="100" amountOut="154840" />);
    expect(screen.getByText('Delivered')).toBeInTheDocument();
    // The formatted amount should contain the numeric value
    expect(screen.getByText(/154,840|154840/)).toBeInTheDocument();
    // The raw amount detail row should not be shown when completed
    expect(screen.queryByText('You receive')).not.toBeInTheDocument();
  });

  it('shows amount details when status is not completed', () => {
    render(
      <StatusTracker {...BASE_PROPS} status="pending_external" amountIn="100" amountOut="154840" />
    );
    expect(screen.getByText('100 USDC')).toBeInTheDocument();
    expect(screen.getByText('You receive')).toBeInTheDocument();
  });

  it('shows the error message when error is provided', () => {
    render(<StatusTracker {...BASE_PROPS} error="Status poll failed: HTTP 401" />);
    expect(screen.getByText('Status poll failed: HTTP 401')).toBeInTheDocument();
  });

  it('renders a stellar.expert link when stellarTransactionId is a valid 64-char hex', () => {
    const txId = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';
    render(<StatusTracker {...BASE_PROPS} status="completed" stellarTransactionId={txId} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', `https://api.stellar.expert/explorer/public/tx/${txId}`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveTextContent('aabbccddeeff0011…');
  });

  it('does not render a stellar.expert link when stellarTransactionId is not a valid 64-char hex', () => {
    render(
      <StatusTracker
        {...BASE_PROPS}
        status="completed"
        stellarTransactionId="abc123def456789012345678"
      />
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows "Live" indicator when status is not terminal', () => {
    render(<StatusTracker {...BASE_PROPS} status="pending_anchor" />);
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('hides "Live" indicator when status is completed', () => {
    render(<StatusTracker {...BASE_PROPS} status="completed" />);
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
  });

  it('shows anchor support link after 10 minutes in pending_anchor', async () => {
    vi.useFakeTimers();
    render(
      <StatusTracker {...BASE_PROPS} status="pending_anchor" anchorHomeDomain="cowrie.exchange" />
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(resolveToml).toHaveBeenCalledWith('cowrie.exchange');
    expect(screen.queryByRole('link', { name: 'Contact anchor support' })).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    });

    const link = screen.getByRole('link', { name: 'Contact anchor support' });
    expect(link).toHaveAttribute('href', 'mailto:support@cowrie.exchange');
    vi.useRealTimers();
  }, 15_000);
});
