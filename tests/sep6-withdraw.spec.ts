import { describe, it, expect } from 'vitest';
import { buildSep6WithdrawRequest } from '@/lib/stellar/sep6';

const TRANSFER_SERVER = 'https://cowrie.exchange/sep6';

describe('buildSep6WithdrawRequest', () => {
  it('builds correct URL with all required params for bank_account withdraw', () => {
    const url = buildSep6WithdrawRequest(TRANSFER_SERVER, {
      asset_code: 'USDC',
      type: 'bank_account',
      dest: 'NGXXXXXXXXXXXXXXXXXX',
    });
    expect(url).toContain('asset_code=USDC');
    expect(url).toContain('type=bank_account');
    expect(url).toContain('dest=NGXXXXXXXXXXXXXXXXXX');
    expect(url).toContain(`${TRANSFER_SERVER}/withdraw`);
  });

  it('includes optional amount when provided', () => {
    const url = buildSep6WithdrawRequest(TRANSFER_SERVER, {
      asset_code: 'USDC',
      type: 'bank_account',
      dest: 'NGXXXXXXXXXXXXXXXXXX',
      amount: '100',
    });
    expect(url).toContain('amount=100');
  });

  it('includes optional account when provided', () => {
    const url = buildSep6WithdrawRequest(TRANSFER_SERVER, {
      asset_code: 'USDC',
      type: 'bank_account',
      dest: 'NGXXXXXXXXXXXXXXXXXX',
      account: 'GABCDEF',
    });
    expect(url).toContain('account=GABCDEF');
  });

  it('throws when asset_code is empty', () => {
    expect(() =>
      buildSep6WithdrawRequest(TRANSFER_SERVER, {
        asset_code: '',
        type: 'bank_account',
        dest: 'NGXXXXXXXXXXXXXXXXXX',
      })
    ).toThrow('asset_code is required');
  });

  it('throws when type is empty', () => {
    expect(() =>
      buildSep6WithdrawRequest(TRANSFER_SERVER, {
        asset_code: 'USDC',
        type: '',
        dest: 'NGXXXXXXXXXXXXXXXXXX',
      })
    ).toThrow('type is required');
  });

  it('throws when dest is empty', () => {
    expect(() =>
      buildSep6WithdrawRequest(TRANSFER_SERVER, {
        asset_code: 'USDC',
        type: 'bank_account',
        dest: '',
      })
    ).toThrow('dest is required');
  });

  it('base path is {transferServer}/withdraw', () => {
    const url = buildSep6WithdrawRequest(TRANSFER_SERVER, {
      asset_code: 'USDC',
      type: 'bank_account',
      dest: 'NGXXXXXXXXXXXXXXXXXX',
    });
    expect(new URL(url).pathname).toBe('/sep6/withdraw');
  });
});
