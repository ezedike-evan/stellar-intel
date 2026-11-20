import { describe, expect, it, vi } from 'vitest';
import { Account, Keypair, Operation, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { createOnrampIntent, type OnrampIntentDeps } from '@/lib/intent/onramp';
import { hashIntent } from '@/lib/intent/hash';
import { getAnchorsByCorridorId } from '@/lib/stellar/anchors';
import type { OnrampIntent } from '@/lib/intent/onramp-schema';
import type { DepositRate, DepositRateComparison } from '@/types';
import type { DepositPreflight } from '@/lib/stellar/horizon';

const DESTINATION = Keypair.random().publicKey();
const ISSUER = Keypair.random().publicKey();
const ASSET = `stellar:USDC:${ISSUER}`;
const ANCHOR = getAnchorsByCorridorId('usdc-ngn')[0]!;

const INTENT: OnrampIntent = {
  type: 'onramp',
  sourceAsset: 'NGN',
  destinationAsset: 'USDC',
  amount: '10000',
  sender: 'acct-001',
  destination: DESTINATION,
  depositMethod: 'bank_transfer',
};

function rate(over: Partial<DepositRate> = {}): DepositRate {
  return {
    anchorId: ANCHOR.id,
    anchorName: ANCHOR.name,
    corridorId: 'usdc-ngn',
    asset: ASSET,
    fiatAmount: 10000,
    fee: 1.5,
    feeType: 'flat',
    exchangeRate: 0.00064,
    totalReceived: 6.4,
    source: 'sep24-fee',
    updatedAt: new Date('2026-10-25T08:00:00.000Z'),
    ...over,
  };
}

function comparison(
  rates: DepositRate[],
  bestRateId = rates[0]?.anchorId ?? ''
): DepositRateComparison {
  return { corridorId: 'usdc-ngn', direction: 'deposit', rates, bestRateId, errors: [] };
}

const WITH_TRUSTLINE: DepositPreflight = {
  accountExists: true,
  hasTrustline: true,
  trustlineAuthorized: true,
  balance: '0',
};

function deps(over: Partial<Record<keyof OnrampIntentDeps, unknown>> = {}): OnrampIntentDeps {
  return {
    fetchDepositRates: vi.fn().mockResolvedValue(comparison([rate()])),
    checkDepositPreflight: vi.fn().mockResolvedValue(WITH_TRUSTLINE),
    buildChangeTrustTx: vi.fn(async ({ sourcePublicKey, assetCode, assetIssuer }) =>
      new TransactionBuilder(new Account(sourcePublicKey, '1'), {
        fee: '100',
        networkPassphrase: Networks.PUBLIC,
      })
        .addOperation(
          Operation.changeTrust({
            asset: new (await import('@stellar/stellar-sdk')).Asset(assetCode, assetIssuer),
          })
        )
        .setTimeout(180)
        .build()
    ),
    ...over,
  } as OnrampIntentDeps;
}

describe('createOnrampIntent (#1473)', () => {
  it('routes to the best anchor and returns no XDR when a trustline exists', async () => {
    const result = await createOnrampIntent(INTENT, deps());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { route, handoffUrl, unsignedChangeTrustXdr } = result.response;
    expect(route).toMatchObject({
      anchorId: ANCHOR.id,
      corridorId: 'usdc-ngn',
      asset: ASSET,
      estimatedFee: '1.5',
      estimatedReceived: '6.4',
      indicative: true,
    });
    expect(route.anchorDomain).toBe(ANCHOR.serviceDomain ?? ANCHOR.homeDomain);
    expect(handoffUrl).toBe(`/onramp?corridor=usdc-ngn&amount=10000&anchor=${ANCHOR.id}`);
    expect(unsignedChangeTrustXdr).toBeNull();
  });

  it('asks for rates for the intent amount and funding type', async () => {
    const d = deps();
    await createOnrampIntent({ ...INTENT, depositMethod: 'mobile_money' }, d);
    expect(d.fetchDepositRates).toHaveBeenCalledWith('usdc-ngn', '10000', {
      type: 'mobile_money',
    });
  });

  it('returns a changeTrust XDR for the destination when the trustline is missing', async () => {
    const d = deps({
      checkDepositPreflight: vi
        .fn()
        .mockResolvedValue({ ...WITH_TRUSTLINE, hasTrustline: false, trustlineAuthorized: null }),
    });
    const result = await createOnrampIntent(INTENT, d);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const xdr = result.response.unsignedChangeTrustXdr;
    expect(xdr).toEqual(expect.any(String));

    const tx = TransactionBuilder.fromXDR(xdr!, Networks.PUBLIC);
    expect('operations' in tx && tx.operations).toHaveLength(1);
    const op = (
      tx as { operations: Array<{ type: string; line: { code: string; issuer: string } }> }
    ).operations[0]!;
    expect(op.type).toBe('changeTrust');
    expect(op.line).toMatchObject({ code: 'USDC', issuer: ISSUER });
    expect(d.buildChangeTrustTx).toHaveBeenCalledWith({
      sourcePublicKey: DESTINATION,
      assetCode: 'USDC',
      assetIssuer: ISSUER,
    });
  });

  it('fails with ACCOUNT_NOT_FOUND (422) when the destination account does not exist', async () => {
    const d = deps({
      checkDepositPreflight: vi.fn().mockResolvedValue({
        accountExists: false,
        hasTrustline: false,
        trustlineAuthorized: null,
        balance: null,
      }),
    });
    const result = await createOnrampIntent(INTENT, d);

    expect(result).toMatchObject({ ok: false, code: 'ACCOUNT_NOT_FOUND', status: 422 });
    expect(d.buildChangeTrustTx).not.toHaveBeenCalled();
  });

  it('fails with NO_ROUTE (404) for an unknown corridor, without fetching rates', async () => {
    const d = deps();
    const result = await createOnrampIntent({ ...INTENT, sourceAsset: 'XYZ' }, d);

    expect(result).toMatchObject({ ok: false, code: 'NO_ROUTE', status: 404 });
    expect(d.fetchDepositRates).not.toHaveBeenCalled();
  });

  it('fails with RATE_UNAVAILABLE (503) when there are no rates', async () => {
    const d = deps({ fetchDepositRates: vi.fn().mockResolvedValue(comparison([])) });
    const result = await createOnrampIntent(INTENT, d);

    expect(result).toMatchObject({ ok: false, code: 'RATE_UNAVAILABLE', status: 503 });
  });

  it('fails with RATE_UNAVAILABLE when the only rows are unreachable', async () => {
    const d = deps({
      fetchDepositRates: vi
        .fn()
        .mockResolvedValue(
          comparison([rate({ source: 'unavailable', totalReceived: null, fee: null })])
        ),
    });
    const result = await createOnrampIntent(INTENT, d);

    expect(result).toMatchObject({ ok: false, code: 'RATE_UNAVAILABLE', status: 503 });
  });

  it('fails with RATE_UNAVAILABLE when the rate lookup throws', async () => {
    const d = deps({ fetchDepositRates: vi.fn().mockRejectedValue(new Error('down')) });
    const result = await createOnrampIntent(INTENT, d);

    expect(result).toMatchObject({ ok: false, code: 'RATE_UNAVAILABLE', status: 503 });
  });

  it('reports PREFLIGHT_FAILED (502) when Horizon cannot be reached', async () => {
    const d = deps({ checkDepositPreflight: vi.fn().mockRejectedValue(new Error('horizon')) });
    const result = await createOnrampIntent(INTENT, d);

    expect(result).toMatchObject({ ok: false, code: 'PREFLIGHT_FAILED', status: 502 });
  });

  it('reports TX_BUILD_FAILED (500) when the trustline transaction cannot be built', async () => {
    const d = deps({
      checkDepositPreflight: vi.fn().mockResolvedValue({ ...WITH_TRUSTLINE, hasTrustline: false }),
      buildChangeTrustTx: vi.fn().mockRejectedValue(new Error('account not found')),
    });
    const result = await createOnrampIntent(INTENT, d);

    expect(result).toMatchObject({ ok: false, code: 'TX_BUILD_FAILED', status: 500 });
  });

  it('sets intentHash to hashIntent(intent)', async () => {
    const result = await createOnrampIntent(INTENT, deps());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.intentHash).toBe(await hashIntent(INTENT));
  });
});
