import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSep24Transaction } from '@/lib/stellar/sep24';

// A deposit tracker has to show how to pay the anchor and where to read more
// (#1460). The parser used to drop all of it.

const TRANSFER_SERVER = 'https://cowrie.exchange/sep24';

function respondWith(transaction: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ transaction }) }))
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('getSep24Transaction — deposit fields', () => {
  it('parses instructions, more_info_url, claimable_balance_id and kind', async () => {
    respondWith({
      id: 'dep-1',
      status: 'pending_user_transfer_start',
      kind: 'deposit',
      more_info_url: 'https://anchor.example/tx/dep-1',
      claimable_balance_id: '00000000abc',
      message: 'Send the transfer to continue',
      from: 'GFROM',
      to: 'GTO',
      instructions: {
        organization_bank_number: { value: '121122676', description: 'US bank routing number' },
        organization_bank_account_number: { value: '13719713158835300', description: 'Account' },
        broken: { value: 12345, description: 'not a string value' },
      },
    });

    const tx = await getSep24Transaction(TRANSFER_SERVER, 'dep-1', 'jwt');

    expect(tx.kind).toBe('deposit');
    expect(tx.moreInfoUrl).toBe('https://anchor.example/tx/dep-1');
    expect(tx.claimableBalanceId).toBe('00000000abc');
    expect(tx.message).toBe('Send the transfer to continue');
    expect(tx.from).toBe('GFROM');
    expect(tx.to).toBe('GTO');
    // Two usable entries; the malformed one is dropped.
    expect(tx.instructions).toEqual({
      organization_bank_number: { value: '121122676', description: 'US bank routing number' },
      organization_bank_account_number: { value: '13719713158835300', description: 'Account' },
    });
  });

  it('defaults a missing description to an empty string', async () => {
    respondWith({
      id: 'dep-2',
      status: 'pending_user_transfer_start',
      instructions: { iban: { value: 'DE89370400440532013000' } },
    });

    const tx = await getSep24Transaction(TRANSFER_SERVER, 'dep-2', 'jwt');

    expect(tx.instructions).toEqual({ iban: { value: 'DE89370400440532013000', description: '' } });
  });

  it('drops a javascript: more_info_url, since it is rendered as a link', async () => {
    respondWith({
      id: 'dep-3',
      status: 'pending_anchor',
      more_info_url: 'javascript:alert(1)',
    });

    const tx = await getSep24Transaction(TRANSFER_SERVER, 'dep-3', 'jwt');

    expect(tx.moreInfoUrl).toBeUndefined();
  });

  it('keeps only https more_info_url values that parse', async () => {
    for (const url of ['http://anchor.example/x', 'data:text/html,hi', 'not a url', '', 42]) {
      respondWith({ id: 'dep-4', status: 'pending_anchor', more_info_url: url });
      const tx = await getSep24Transaction(TRANSFER_SERVER, 'dep-4', 'jwt');
      expect(tx.moreInfoUrl, `more_info_url ${String(url)}`).toBeUndefined();
    }
  });

  it('omits every deposit field when the anchor sends none', async () => {
    respondWith({ id: 'wd-1', status: 'completed', amount_in: '100' });

    const tx = await getSep24Transaction(TRANSFER_SERVER, 'wd-1', 'jwt');

    for (const key of [
      'instructions',
      'moreInfoUrl',
      'message',
      'claimableBalanceId',
      'from',
      'to',
      'kind',
    ]) {
      expect(tx).not.toHaveProperty(key);
    }
    expect(tx.amountIn).toBe('100');
  });

  it('drops instructions that are not an object map, and an unknown kind', async () => {
    respondWith({
      id: 'dep-5',
      status: 'pending_anchor',
      instructions: ['not', 'a', 'map'],
      kind: 'swap',
    });

    const tx = await getSep24Transaction(TRANSFER_SERVER, 'dep-5', 'jwt');

    expect(tx.instructions).toBeUndefined();
    expect(tx.kind).toBeUndefined();
  });
});
