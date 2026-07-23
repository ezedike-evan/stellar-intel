import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
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
  vi.unstubAllGlobals();
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
    // The formatted amount should contain the numeric value. Excludes the
    // hidden print-only receipt, which also renders the raw amount.
    expect(screen.getByText(/154,840|154840/, { ignore: '.receipt *' })).toBeInTheDocument();
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
    const link = screen.getByRole('link', { name: /view transaction .* on stellar expert/i });
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
    expect(
      screen.queryByRole('link', { name: /view transaction .* on stellar expert/i })
    ).not.toBeInTheDocument();
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

  it('shows a distinct message for the error status, including the transaction id', () => {
    render(<StatusTracker {...BASE_PROPS} status="error" />);
    expect(
      screen.getByText(
        (_, node) =>
          node?.textContent ===
          'The anchor reported an error. Your USDC was not settled. Contact anchor support with transaction ID txn-abc-123.'
      )
    ).toBeInTheDocument();
  });

  it('shows a distinct message for the refunded status', () => {
    render(<StatusTracker {...BASE_PROPS} status="refunded" />);
    expect(screen.getByText(/anchor refunded your USDC/i)).toBeInTheDocument();
  });

  it('shows a distinct message for the expired status', () => {
    render(<StatusTracker {...BASE_PROPS} status="expired" />);
    expect(screen.getByText(/expired before settlement/i)).toBeInTheDocument();
  });

  it('shows "Off-ramp another amount" and "View transaction history" when completed', () => {
    const onAdjust = vi.fn();
    render(<StatusTracker {...BASE_PROPS} status="completed" onAdjust={onAdjust} />);

    const historyLink = screen.getByRole('link', { name: 'View transaction history' });
    expect(historyLink).toHaveAttribute('href', '/history');

    const adjustButton = screen.getByRole('button', { name: 'Off-ramp another amount' });
    adjustButton.click();
    expect(onAdjust).toHaveBeenCalledTimes(1);
  });

  it('shows a Share button when completed with a valid stellar tx id, copying on click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    render(
      <StatusTracker
        {...BASE_PROPS}
        status="completed"
        amountIn="100"
        stellarTransactionId="aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899"
      />
    );

    const shareButton = screen.getByRole('button', { name: 'Share' });
    fireEvent.click(shareButton);

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0]![0]).toContain('100 USDC');
  });

  it('does not show a Share button without a valid stellar tx id', () => {
    render(<StatusTracker {...BASE_PROPS} status="completed" amountIn="100" />);
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
  });

  it('does not show "Off-ramp another amount" without an onAdjust handler', () => {
    render(<StatusTracker {...BASE_PROPS} status="completed" />);
    expect(
      screen.queryByRole('button', { name: 'Off-ramp another amount' })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View transaction history' })).toBeInTheDocument();
  });

  it('does not show completion CTAs for a non-completed status', () => {
    render(<StatusTracker {...BASE_PROPS} status="pending_anchor" onAdjust={vi.fn()} />);
    expect(screen.queryByText('View transaction history')).not.toBeInTheDocument();
  });

  it('shows an explainer with a time estimate for a non-terminal status', () => {
    render(<StatusTracker {...BASE_PROPS} status="pending_external" />);
    expect(screen.getByText(/anchor is processing your bank transfer/i)).toBeInTheDocument();
    expect(screen.getByText(/usually ~5–30 min/)).toBeInTheDocument();
  });

  it('does not show a time estimate for a terminal status', () => {
    render(<StatusTracker {...BASE_PROPS} status="completed" />);
    expect(screen.queryByText(/usually ~/)).not.toBeInTheDocument();
  });

  it('shows a "still waiting" counter after 5 poll attempts', () => {
    render(<StatusTracker {...BASE_PROPS} status="pending_anchor" attemptCount={5} />);
    expect(screen.getByText('(checked 5 times, still waiting...)')).toBeInTheDocument();
  });

  it('does not show the counter below 5 attempts', () => {
    render(<StatusTracker {...BASE_PROPS} status="pending_anchor" attemptCount={4} />);
    expect(screen.queryByText(/still waiting/)).not.toBeInTheDocument();
  });

  it('escalates to the slow-anchor message at 20 attempts, replacing the counter', () => {
    render(<StatusTracker {...BASE_PROPS} status="pending_anchor" attemptCount={20} />);
    expect(
      screen.getByText('This is taking longer than usual. Anchor may be experiencing delays.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/still waiting/)).not.toBeInTheDocument();
  });

  it('does not show the poll counter for a terminal status', () => {
    render(<StatusTracker {...BASE_PROPS} status="completed" attemptCount={30} />);
    expect(screen.queryByText(/still waiting/)).not.toBeInTheDocument();
    expect(screen.queryByText(/taking longer than usual/)).not.toBeInTheDocument();
  });

  it('shows no terminal-error message for a non-error status', () => {
    render(<StatusTracker {...BASE_PROPS} status="completed" />);
    expect(screen.queryByText(/anchor reported an error/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/anchor refunded your USDC/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/expired before settlement/i)).not.toBeInTheDocument();
  });

  it('renders correctly for pending_user_transfer_complete status in USDC->NGN corridor', () => {
    render(
      <StatusTracker
        {...BASE_PROPS}
        status="pending_user_transfer_complete"
        amountIn="100"
        amountInAsset="USDC"
        amountOut="154840"
        amountOutAsset="NGN"
        currencyCode="NGN"
      />
    );
    expect(screen.getByText('Payment received, processing')).toBeInTheDocument();
    expect(screen.getByText('100 USDC')).toBeInTheDocument();
    expect(screen.getByText('154840 NGN')).toBeInTheDocument();
  });
});

