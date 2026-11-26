import { describe, it, expect } from 'vitest';
import { terminalErrorMessage } from '@/lib/stellar/status-messages';

const TX_ID = 'tx-abc-123';

describe('terminalErrorMessage (Issue #2113)', () => {
  it('keeps the refunded withdraw text unchanged, explicitly and by default', () => {
    const expected = 'The anchor refunded your USDC. Check your Stellar wallet.';
    expect(terminalErrorMessage('refunded', TX_ID, 'withdraw')).toBe(expected);
    expect(terminalErrorMessage('refunded', TX_ID)).toBe(expected);
  });

  it('tells a refunded depositor the refund goes to the account they paid from', () => {
    const msg = terminalErrorMessage('refunded', TX_ID, 'deposit');
    expect(msg).toBe(
      `The anchor refunded your payment to the account you paid from. If it has not arrived, contact anchor support with transaction ID ${TX_ID}.`
    );
    expect(msg).toContain(TX_ID);
    expect(msg).not.toContain('USDC');
    expect(msg).not.toMatch(/Stellar wallet/i);
  });

  it.each(['error', 'expired'] as const)(
    'returns identical %s text for both directions',
    (status) => {
      const withdraw = terminalErrorMessage(status, TX_ID, 'withdraw');
      expect(withdraw).not.toBeNull();
      expect(terminalErrorMessage(status, TX_ID, 'deposit')).toBe(withdraw);
      expect(terminalErrorMessage(status, TX_ID)).toBe(withdraw);
    }
  );

  it('returns null for completed in both directions', () => {
    expect(terminalErrorMessage('completed', TX_ID, 'withdraw')).toBeNull();
    expect(terminalErrorMessage('completed', TX_ID, 'deposit')).toBeNull();
  });
});
