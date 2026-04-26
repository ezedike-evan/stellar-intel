import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusTracker } from '@/components/offramp/StatusTracker';

const BASE_PROPS = {
  transactionId: 'txn-abc-123',
  status: undefined,
  amountIn: undefined,
  amountOut: undefined,
  stellarTransactionId: undefined,
  isLoading: false,
  error: undefined,
} as const;

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
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('shows "Awaiting your payment" for pending_user_transfer_start status', () => {
    render(<StatusTracker {...BASE_PROPS} status="pending_user_transfer_start" />);
    expect(screen.getByText('Awaiting your payment')).toBeInTheDocument();
  });

  it('shows amount in and out when provided', () => {
    render(
      <StatusTracker {...BASE_PROPS} status="completed" amountIn="100" amountOut="154840 NGN" />
    );
    expect(screen.getByText('100 USDC')).toBeInTheDocument();
    expect(screen.getByText('154840 NGN')).toBeInTheDocument();
  });

  it('shows the error message when error is provided', () => {
    render(<StatusTracker {...BASE_PROPS} error="Status poll failed: HTTP 401" />);
    expect(screen.getByText('Status poll failed: HTTP 401')).toBeInTheDocument();
  });

  it('shows the stellar transaction ID (truncated) when provided', () => {
    render(
      <StatusTracker
        {...BASE_PROPS}
        status="completed"
        stellarTransactionId="abc123def456789012345678"
      />
    );
    expect(screen.getByText(/abc123def456789/)).toBeInTheDocument();
  });

  it('shows "Live" indicator when status is not terminal', () => {
    render(<StatusTracker {...BASE_PROPS} status="pending_anchor" />);
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('hides "Live" indicator when status is completed', () => {
    render(<StatusTracker {...BASE_PROPS} status="completed" />);
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
  });
});
