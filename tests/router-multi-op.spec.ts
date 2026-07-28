import { describe, it, expect } from 'vitest';
import { Keypair, Networks, TransactionBuilder, BASE_FEE, Operation } from '@stellar/stellar-sdk';
import { buildMultiAnchorWithdrawTx } from '@/lib/router/multi-op';

const SENDER = Keypair.random().publicKey();
const ANCHOR_A = Keypair.random().publicKey();
const ANCHOR_B = Keypair.random().publicKey();
const USDC_ISSUER = Keypair.random().publicKey();

function build(legs: { destination: string; amount: string }[]) {
  return buildMultiAnchorWithdrawTx({
    sender: SENDER,
    legs,
    assetCode: 'USDC',
    assetIssuer: USDC_ISSUER,
  });
}

describe('buildMultiAnchorWithdrawTx (#800)', () => {
  it('builds one atomic transaction with a payment operation per leg', () => {
    const xdr = build([
      { destination: ANCHOR_A, amount: '60' },
      { destination: ANCHOR_B, amount: '40' },
    ]);

    const tx = TransactionBuilder.fromXDR(xdr, Networks.PUBLIC);
    expect(tx.operations).toHaveLength(2);
    expect(tx.source).toBe(SENDER);

    const [op0, op1] = tx.operations as Array<Operation.Payment>;
    expect(op0?.type).toBe('payment');
    expect(op0?.destination).toBe(ANCHOR_A);
    expect(Number(op0?.amount)).toBe(60);
    expect(op1?.destination).toBe(ANCHOR_B);
    expect(Number(op1?.amount)).toBe(40);
  });

  it('scales the fee with the operation count (base fee per op)', () => {
    const xdr = build([
      { destination: ANCHOR_A, amount: '60' },
      { destination: ANCHOR_B, amount: '40' },
    ]);
    const tx = TransactionBuilder.fromXDR(xdr, Networks.PUBLIC);
    expect(tx.fee).toBe((BigInt(BASE_FEE) * 2n).toString());
  });

  it('carries each leg to its own anchor account and asset', () => {
    const xdr = build([{ destination: ANCHOR_A, amount: '100' }]);
    const tx = TransactionBuilder.fromXDR(xdr, Networks.PUBLIC);
    const op = tx.operations[0] as Operation.Payment;
    expect(op.asset.getCode()).toBe('USDC');
    expect(op.asset.getIssuer()).toBe(USDC_ISSUER);
  });

  it('throws when no legs are supplied (an empty split is never valid)', () => {
    expect(() => build([])).toThrow(/at least one leg/);
  });
});
