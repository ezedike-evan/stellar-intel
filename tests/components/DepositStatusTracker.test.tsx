import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DepositStatusTracker } from '@/components/onramp/DepositStatusTracker';
import { isValidStellarTxId } from '@/lib/format';

const TX_HASH = 'a'.repeat(64);

const BASE = {
  transactionId: 'dep-123',
  status: 'pending_user_transfer_start' as const,
  amountIn: '100',
  amountInAsset: 'iso4217:USD',
  amountOut: '98',
  amountOutAsset: 'stellar:USDC:GISSUER',
  amountFee: '2',
  instructions: {
    reference: { value: 'REF-8841', description: 'Payment reference' },
  },
  moreInfoUrl: undefined,
  message: undefined,
  claimableBalanceId: undefined,
  stellarTransactionId: undefined,
  isLoading: false,
  error: undefined,
  onStartAnother: vi.fn(),
};

describe('DepositStatusTracker (#1469)', () => {
  it('shows the payment instructions while the user still has to pay', () => {
    render(<DepositStatusTracker {...BASE} />);
    expect(screen.getByText('Send payment to anchor')).toBeTruthy();
    expect(screen.getByText('REF-8841')).toBeTruthy();
  });

  it('also shows the instructions for an incomplete deposit', () => {
    render(<DepositStatusTracker {...BASE} status="incomplete" />);
    expect(screen.getByText('REF-8841')).toBeTruthy();
  });

  it('hides the instructions once the payment is received', () => {
    render(<DepositStatusTracker {...BASE} status="pending_anchor" />);
    expect(screen.queryByText('REF-8841')).toBeNull();
    expect(screen.getByText('Processing at anchor')).toBeTruthy();
  });

  it('shows the amount received and a Stellar Expert link on completion', () => {
    render(<DepositStatusTracker {...BASE} status="completed" stellarTransactionId={TX_HASH} />);
    expect(screen.getByText('You received 98 USDC')).toBeTruthy();
    const link = screen.getByRole('link', { name: /view transaction/i });
    expect(link.getAttribute('href')).toContain(`/tx/${TX_HASH}`);
    expect(screen.queryByText('REF-8841')).toBeNull();
  });

  it('does not link a malformed transaction id', () => {
    render(<DepositStatusTracker {...BASE} status="completed" stellarTransactionId="not-a-hash" />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('explains a claimable balance and shows its id', () => {
    render(
      <DepositStatusTracker
        {...BASE}
        status="completed"
        claimableBalanceId="00000000abcdef"
        stellarTransactionId={TX_HASH}
      />
    );
    expect(screen.getByText(/sent as a claimable balance/i)).toBeTruthy();
    expect(screen.getByText('00000000abcdef')).toBeTruthy();
  });

  it('shows the terminal error message and offers another deposit', () => {
    const onStartAnother = vi.fn();
    render(<DepositStatusTracker {...BASE} status="error" onStartAnother={onStartAnother} />);
    expect(screen.getByText(/The anchor reported an error/)).toBeTruthy();
    expect(screen.getByText(/dep-123/, { selector: 'p.bg-bg-sunken' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start another deposit' }));
    expect(onStartAnother).toHaveBeenCalledTimes(1);
  });

  it('shows a polling error inline', () => {
    render(<DepositStatusTracker {...BASE} error="Could not reach the anchor" />);
    expect(screen.getByText('Could not reach the anchor')).toBeTruthy();
  });

  it('shows a fetching label before the first status arrives', () => {
    render(<DepositStatusTracker {...BASE} status={undefined} isLoading />);
    expect(screen.getByText('Fetching status…')).toBeTruthy();
  });
});

describe('isValidStellarTxId', () => {
  it('accepts only 64 hex characters', () => {
    expect(isValidStellarTxId(TX_HASH)).toBe(true);
    expect(isValidStellarTxId('abc')).toBe(false);
    expect(isValidStellarTxId('g'.repeat(64))).toBe(false);
  });
});
