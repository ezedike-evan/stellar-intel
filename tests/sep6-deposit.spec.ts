/**
 * Scaffold for the SEP-6 programmatic deposit flow (#1093) — the counterpart
 * to `buildSep6WithdrawRequest` (lib/stellar/sep6.ts, covered by
 * tests/sep6-withdraw.spec.ts). Neither `buildSep6DepositRequest` nor a
 * deposit response schema exists yet.
 *
 * The `buildSep6DepositRequest` block below is skipped until that function is
 * exported from lib/stellar/sep6.ts — accessed through a loose module cast so
 * this file always imports cleanly rather than failing to compile against a
 * symbol that doesn't exist yet. Implementing the function with this exact
 * name and signature is what turns the block on with no test-file changes.
 *
 * The fixture-shape block is NOT skipped: it validates tests/fixtures/sep6-
 * deposit.ts today, against the schemas already enforced for withdraw
 * (lib/stellar/sep6-schemas.ts), so the documented contract can't drift
 * silently before an implementation exists to exercise it directly.
 */
import { describe, it, expect } from 'vitest';
import * as sep6 from '@/lib/stellar/sep6';
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

interface Sep6DepositParams {
  asset_code: string;
  account: string;
  amount?: string;
  type?: string;
  email_address?: string;
  memo_type?: string;
  memo?: string;
  lang?: string;
}

type Sep6DepositRequestBuilder = (transferServer: string, params: Sep6DepositParams) => string;

// Un-typed lookup: `buildSep6DepositRequest` isn't part of the module's type
// yet, so a direct `sep6.buildSep6DepositRequest` reference would fail to
// compile rather than just be undefined at runtime.
const buildSep6DepositRequest = (sep6 as unknown as Record<string, unknown>)
  .buildSep6DepositRequest as Sep6DepositRequestBuilder | undefined;

describe.skipIf(!buildSep6DepositRequest)('buildSep6DepositRequest (scaffold)', () => {
  const build = buildSep6DepositRequest as Sep6DepositRequestBuilder;

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

  it('base path is {transferServer}/deposit', () => {
    const url = build(SEP6_DEPOSIT_TRANSFER_SERVER, SEP6_DEPOSIT_PARAMS_MINIMAL);
    expect(new URL(url).pathname).toBe('/sep6/deposit');
  });
});

describe('SEP-6 deposit response shapes (#1093)', () => {
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
