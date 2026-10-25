/**
 * The SEP-6 programmatic deposit request builder, the counterpart to
 * `buildSep6WithdrawRequest` (covered by tests/sep6-withdraw.spec.ts).
 *
 * The response-shape block validates tests/fixtures/sep6-deposit.ts against the
 * schemas already enforced for withdraw (lib/stellar/sep6-schemas.ts), since SEP-6
 * gives both directions the same three response shapes.
 */
import { describe, it, expect } from 'vitest';
import { buildSep6DepositRequest } from '@/lib/stellar/sep6';
import {
  Sep6WithdrawInteractiveSchema,
  Sep6WithdrawNonInteractiveSchema,
  Sep6WithdrawNeedsInfoSchema,
} from '@/lib/stellar/sep6-schemas';
import {
  SEP6_DEPOSIT_TRANSFER_SERVER,
  SEP6_DEPOSIT_PARAMS_MINIMAL,
  SEP6_DEPOSIT_PARAMS_FULL,
  sep6DepositInteractiveResponse,
  sep6DepositNonInteractiveResponse,
  sep6DepositNeedsInfoResponse,
} from './fixtures/sep6-deposit';

describe('buildSep6DepositRequest', () => {
  const build = buildSep6DepositRequest;

  it('builds correct URL with the required params (asset_code, account)', () => {
    const url = build(SEP6_DEPOSIT_TRANSFER_SERVER, SEP6_DEPOSIT_PARAMS_MINIMAL);
    expect(url).toContain('asset_code=USDC');
    expect(url).toContain(`account=${SEP6_DEPOSIT_PARAMS_MINIMAL.account}`);
    expect(url).toContain(`${SEP6_DEPOSIT_TRANSFER_SERVER}/deposit`);
  });

  it('includes every optional param when provided', () => {
    const url = build(SEP6_DEPOSIT_TRANSFER_SERVER, SEP6_DEPOSIT_PARAMS_FULL);
    expect(url).toContain('amount=100');
    expect(url).toContain('type=bank_account');
    expect(url).toContain('email_address=depositor%40example.com');
    expect(url).toContain('memo_type=text');
    expect(url).toContain('memo=ref-001');
    expect(url).toContain('lang=en');
  });

  it('throws when asset_code is empty', () => {
    expect(() =>
      build(SEP6_DEPOSIT_TRANSFER_SERVER, { ...SEP6_DEPOSIT_PARAMS_MINIMAL, asset_code: '' })
    ).toThrow('asset_code is required');
  });

  it('throws when account is empty', () => {
    expect(() =>
      build(SEP6_DEPOSIT_TRANSFER_SERVER, { ...SEP6_DEPOSIT_PARAMS_MINIMAL, account: '' })
    ).toThrow('account is required');
  });

  it('always asks for a claimable balance', () => {
    const url = new URL(build(SEP6_DEPOSIT_TRANSFER_SERVER, SEP6_DEPOSIT_PARAMS_MINIMAL));
    expect(url.searchParams.get('claimable_balance_supported')).toBe('true');
  });

  it('omits optional params that were not given', () => {
    const url = new URL(build(SEP6_DEPOSIT_TRANSFER_SERVER, SEP6_DEPOSIT_PARAMS_MINIMAL));
    expect([...url.searchParams.keys()].sort()).toEqual([
      'account',
      'asset_code',
      'claimable_balance_supported',
    ]);
  });

  it('base path is {transferServer}/deposit', () => {
    const url = build(SEP6_DEPOSIT_TRANSFER_SERVER, SEP6_DEPOSIT_PARAMS_MINIMAL);
    expect(new URL(url).pathname).toBe('/sep6/deposit');
  });
});

describe('SEP-6 deposit response shapes', () => {
  it('interactive_customer_info_needed matches the schema withdraw already validates against', () => {
    expect(() => Sep6WithdrawInteractiveSchema.parse(sep6DepositInteractiveResponse)).not.toThrow();
  });

  it('non_interactive matches the schema withdraw already validates against', () => {
    expect(() =>
      Sep6WithdrawNonInteractiveSchema.parse(sep6DepositNonInteractiveResponse)
    ).not.toThrow();
  });

  it('customer_info_status (missing-field error) matches the schema withdraw already validates against', () => {
    expect(() => Sep6WithdrawNeedsInfoSchema.parse(sep6DepositNeedsInfoResponse)).not.toThrow();
    const parsed = Sep6WithdrawNeedsInfoSchema.parse(sep6DepositNeedsInfoResponse);
    expect(Object.keys(parsed.fields)).toEqual(['email_address', 'first_name', 'last_name']);
  });
});
