// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseRefunds } from '@/lib/stellar/refunds';

const STELLAR_TX = 'b9d0b2292c4e09e8eb22d036171491e87b8d2086bf8b265874c8d182cb9c9020';

/** A refunds object as a well-behaved anchor sends it. */
const valid = () => ({
  amount_refunded: '100',
  amount_fee: '2.5',
  payments: [
    { id: STELLAR_TX, id_type: 'stellar', amount: '60', fee: '1.5' },
    { id: 'bank-ref-77', id_type: 'external', amount: '40', fee: '1' },
  ],
});

describe('parseRefunds', () => {
  it('returns a valid object as it was sent', () => {
    expect(parseRefunds(valid())).toEqual(valid());
  });

  it('builds a new object, so nothing the anchor added rides along', () => {
    const raw = {
      ...valid(),
      note: '<img src=x onerror=alert(1)>',
      payments: [{ ...valid().payments[0], memo: 'extra', __proto__: { polluted: true } }],
    };
    const parsed = parseRefunds(raw);

    expect(parsed).toEqual({
      amount_refunded: '100',
      amount_fee: '2.5',
      payments: [valid().payments[0]],
    });
    expect(Object.keys(parsed ?? {})).toEqual(['amount_refunded', 'amount_fee', 'payments']);
    expect(Object.keys(parsed?.payments[0] ?? {})).toEqual(['id', 'id_type', 'amount', 'fee']);
  });

  it('turns numeric amounts into strings', () => {
    expect(
      parseRefunds({
        amount_refunded: 100,
        amount_fee: 2.5,
        payments: [{ id: STELLAR_TX, id_type: 'stellar', amount: 60, fee: 0 }],
      })
    ).toEqual({
      amount_refunded: '100',
      amount_fee: '2.5',
      payments: [{ id: STELLAR_TX, id_type: 'stellar', amount: '60', fee: '0' }],
    });
  });

  it('is undefined without a usable amount_refunded: the object says nothing then', () => {
    const { amount_refunded: _omitted, ...missing } = valid();
    expect(parseRefunds(missing)).toBeUndefined();

    // `[5]` and `['5']` print as "5": only a string or a number is ever read as an amount.
    for (const bad of [
      '-1',
      'abc',
      '',
      '1e3',
      ' 10',
      '10 ',
      '1,000',
      null,
      true,
      [],
      {},
      [5],
      ['5'],
    ]) {
      expect(parseRefunds({ ...valid(), amount_refunded: bad }), JSON.stringify(bad)).toBe(
        undefined
      );
    }
  });

  it('refuses a number that is negative, not finite, or printed with an exponent', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1e21, 1e-7]) {
      expect(parseRefunds({ ...valid(), amount_refunded: bad }), String(bad)).toBeUndefined();
    }
    // Zero is an amount: an anchor may report a refund that came to nothing after fees.
    expect(parseRefunds({ ...valid(), amount_refunded: 0 })?.amount_refunded).toBe('0');
  });

  it("uses '0' for a missing or invalid amount_fee", () => {
    const { amount_fee: _omitted, ...missing } = valid();
    expect(parseRefunds(missing)?.amount_fee).toBe('0');

    for (const bad of ['-2', 'free', null, -1, Number.NaN]) {
      expect(parseRefunds({ ...valid(), amount_fee: bad })?.amount_fee, String(bad)).toBe('0');
    }
  });

  it('uses [] when payments is not an array', () => {
    for (const bad of [undefined, null, 'oops', 7, { 0: valid().payments[0] }]) {
      expect(parseRefunds({ ...valid(), payments: bad })?.payments, String(bad)).toEqual([]);
    }
  });

  it('drops a payment whose id_type is not one SEP-24 defines', () => {
    const [first, second] = valid().payments;
    for (const idType of ['iban', 'Stellar', 'EXTERNAL', '', undefined, null, 1]) {
      const parsed = parseRefunds({
        ...valid(),
        payments: [first, { ...second, id_type: idType }],
      });
      expect(parsed?.payments, String(idType)).toEqual([first]);
    }
  });

  it('drops a payment with an empty, missing, non-string or overlong id', () => {
    const [first, second] = valid().payments;
    for (const id of ['', undefined, null, 42, 'x'.repeat(129)]) {
      const parsed = parseRefunds({ ...valid(), payments: [{ ...first, id }, second] });
      expect(parsed?.payments, String(id).slice(0, 12)).toEqual([second]);
    }
    // 128 characters is the longest id kept.
    const longest = 'x'.repeat(128);
    expect(
      parseRefunds({ ...valid(), payments: [{ ...first, id: longest }] })?.payments[0]?.id
    ).toBe(longest);
  });

  it('drops a payment whose amount is not an amount, and defaults its fee', () => {
    const [first, second] = valid().payments;
    for (const amount of ['-1', 'lots', undefined, null, -5]) {
      const parsed = parseRefunds({ ...valid(), payments: [{ ...first, amount }, second] });
      expect(parsed?.payments, String(amount)).toEqual([second]);
    }

    const { fee: _omitted, ...noFee } = second!;
    expect(parseRefunds({ ...valid(), payments: [noFee] })?.payments).toEqual([
      { ...second, fee: '0' },
    ]);
    expect(
      parseRefunds({ ...valid(), payments: [{ ...second, fee: '-1' }] })?.payments[0]?.fee
    ).toBe('0');
  });

  it('drops entries that are not objects and keeps the valid ones in order', () => {
    const [first, second] = valid().payments;
    const parsed = parseRefunds({
      ...valid(),
      payments: [null, first, 'oops', [first], { ...first, id_type: 'iban' }, second, 3],
    });
    expect(parsed?.payments).toEqual([first, second]);
  });

  it('is undefined for anything that is not a plain object', () => {
    for (const raw of [null, undefined, 'oops', 42, true, [], [valid()]]) {
      expect(parseRefunds(raw), JSON.stringify(raw)).toBeUndefined();
    }
    // An array is refused for being an array, even one made to carry the right fields.
    expect(parseRefunds(Object.assign([], valid()))).toBeUndefined();
    expect(
      parseRefunds({ ...valid(), payments: [Object.assign([], valid().payments[0])] })?.payments
    ).toEqual([]);
  });
});
