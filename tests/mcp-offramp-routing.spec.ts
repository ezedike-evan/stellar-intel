/**
 * @vitest-environment node
 *
 * MCP off-ramp routing: payment destinations come from the resolver, never a
 * constant.
 *
 * lib/mcp/offramp.ts used to carry its own corridor → account table, pinning
 * two payout addresses that did not exist on mainnet and were never verified
 * as anchor-owned. Whoever held either key could have created the account and
 * received every agent off-ramp on that corridor. The web intent path dropped
 * the same addresses in #942; the MCP copy survived it. These tests keep both
 * halves of the fix in place: the addresses are gone from shipped source, and
 * quote/prepare/execute route only through lib/intent/anchor-accounts.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import type { AnchorRoutingTarget } from '@/lib/intent/anchor-accounts';

// ─── (1) The retired addresses stay out of shipped source ────────────────────

// Split so this file does not itself trip a repo-wide grep for the keys.
const RETIRED_ADDRESSES = [
  'GAIJ3VXNY7RPPLGVVCLGBK7NPHLL5ZRK' + 'ATHETOA7M7UPZPAAHEGQQIY2',
  'GC6PVZIZYHHROHYBBOZDJ5ZZI4RH6LDS' + 'HRT4K7BA5QGZFKMZ6HAZUQAK',
];

const SOURCE_EXTS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'];

function sourceFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'dist') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (SOURCE_EXTS.some((ext) => entry.endsWith(ext))) out.push(path);
  }
  return out;
}

function scanRoots(): string[] {
  const packageSrcs = readdirSync('packages')
    .map((pkg) => join('packages', pkg, 'src'))
    .filter((dir) => {
      try {
        return statSync(dir).isDirectory();
      } catch {
        return false;
      }
    });
  return ['lib', 'app', 'scripts', 'constants', ...packageSrcs];
}

describe('retired MCP payout addresses', () => {
  it('scans a non-trivial set of files', () => {
    const files = scanRoots().flatMap(sourceFiles);
    expect(files.some((f) => f.endsWith(join('lib', 'mcp', 'offramp.ts')))).toBe(true);
    expect(files.some((f) => f.startsWith(join('packages', 'mcp', 'src')))).toBe(true);
  });

  it('appear in no source file under lib/, app/, scripts/, constants/ or packages/*/src', () => {
    const offenders = scanRoots()
      .flatMap(sourceFiles)
      .filter((file) => {
        const text = readFileSync(file, 'utf8');
        return RETIRED_ADDRESSES.some((addr) => text.includes(addr));
      });
    expect(offenders).toEqual([]);
  });
});

// ─── (2)/(3) Routing goes through the resolver ────────────────────────────────

const routingTargetsForCorridor = vi.fn<(corridorId: string) => AnchorRoutingTarget[]>();
const registeredAnchorsForCorridor = vi.fn<(corridorId: string) => string[]>();
vi.mock('@/lib/intent/anchor-accounts', () => ({
  routingTargetsForCorridor: (id: string) => routingTargetsForCorridor(id),
  registeredAnchorsForCorridor: (id: string) => registeredAnchorsForCorridor(id),
}));

vi.mock('@/lib/stellar/server-rates', () => ({
  fetchCorridorRates: vi.fn(async () => {
    throw new Error('quote must not be reached in these tests');
  }),
}));

const submitTransaction = vi.fn();
vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>();
  return {
    ...actual,
    Horizon: {
      ...actual.Horizon,
      Server: vi.fn().mockImplementation(function MockHorizonServer(this: {
        submitTransaction: typeof submitTransaction;
      }) {
        this.submitTransaction = submitTransaction;
      }),
    },
  };
});

const { prepareIntent, executeIntent, getQuote } = await import('@/lib/mcp/offramp');
const { hashIntent } = await import('@/lib/intent/hash');

const RESOLVED_ACCOUNT = Keypair.random().publicKey();
const RESOLVED_TARGET: AnchorRoutingTarget = {
  anchorId: 'cowrie',
  anchorDomain: 'cowrie.exchange',
  anchorAccount: RESOLVED_ACCOUNT,
};

function intentFor(sender: string, destinationAsset = 'NGN') {
  return {
    type: 'offramp' as const,
    sourceAsset: 'USDC',
    destinationAsset,
    amount: '100',
    sender,
    recipient: 'recipient-123',
  };
}

describe('MCP off-ramp routing via the anchor resolver', () => {
  let paymentSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    routingTargetsForCorridor.mockReset();
    registeredAnchorsForCorridor.mockReset();
    submitTransaction.mockReset();
    registeredAnchorsForCorridor.mockReturnValue([]);
    paymentSpy = vi.spyOn(Operation, 'payment');
  });

  afterEach(() => {
    paymentSpy.mockRestore();
  });

  it('prepare pays the account the resolver returns for the corridor', async () => {
    routingTargetsForCorridor.mockReturnValue([RESOLVED_TARGET]);
    const kp = Keypair.random();

    const { unsignedTx } = await prepareIntent(intentFor(kp.publicKey()));

    expect(routingTargetsForCorridor).toHaveBeenCalledWith('usdc-ngn');
    const tx = TransactionBuilder.fromXDR(unsignedTx, Networks.PUBLIC);
    expect('operations' in tx && tx.operations).toHaveLength(1);
    const op = (tx as { operations: Array<{ type: string; destination?: string }> }).operations[0];
    expect(op?.type).toBe('payment');
    expect(op?.destination).toBe(RESOLVED_ACCOUNT);
  });

  it('prepare for an unregistered corridor is NO_ROUTE and builds no payment', async () => {
    routingTargetsForCorridor.mockReturnValue([]);
    const kp = Keypair.random();

    await expect(prepareIntent(intentFor(kp.publicKey(), 'ZZZ'))).rejects.toMatchObject({
      code: 'NO_ROUTE',
      message: 'No route for corridor usdc-zzz',
    });
    expect(paymentSpy).not.toHaveBeenCalled();
  });

  it('prepare for a registered corridor without a verified account is NO_ROUTE', async () => {
    routingTargetsForCorridor.mockReturnValue([]);
    registeredAnchorsForCorridor.mockReturnValue(['moneygram']);
    const kp = Keypair.random();

    await expect(prepareIntent(intentFor(kp.publicKey(), 'KES'))).rejects.toMatchObject({
      code: 'NO_ROUTE',
      message: expect.stringContaining('moneygram'),
    });
    expect(paymentSpy).not.toHaveBeenCalled();
  });

  it('quote for an unregistered corridor is NO_ROUTE before any rate fetch', async () => {
    routingTargetsForCorridor.mockReturnValue([]);
    await expect(getQuote({ from: 'USDC', to: 'ZZZ', amount: '10' })).rejects.toMatchObject({
      code: 'NO_ROUTE',
    });
  });

  it('execute for an unregistered corridor is NO_ROUTE and never submits', async () => {
    routingTargetsForCorridor.mockReturnValue([]);
    const kp = Keypair.random();
    const intent = intentFor(kp.publicKey(), 'ZZZ');
    const intentHash = await hashIntent(intent);
    const signature = Buffer.from(kp.sign(Buffer.from(intentHash, 'utf8'))).toString('base64');

    await expect(
      executeIntent({ unsignedEnvelope: { intent, intentHash }, signature, signedTx: 'AAAAAA==' })
    ).rejects.toMatchObject({ code: 'NO_ROUTE' });
    expect(submitTransaction).not.toHaveBeenCalled();
    expect(paymentSpy).not.toHaveBeenCalled();
  });

  it('execute rejects a payment to an account the resolver no longer vouches for', async () => {
    // Prepared while the resolver returned RESOLVED_ACCOUNT...
    routingTargetsForCorridor.mockReturnValue([RESOLVED_TARGET]);
    const kp = Keypair.random();
    const { unsignedEnvelope, unsignedTx } = await prepareIntent(intentFor(kp.publicKey()));
    const signature = Buffer.from(
      kp.sign(Buffer.from(unsignedEnvelope.intentHash, 'utf8'))
    ).toString('base64');
    const tx = TransactionBuilder.fromXDR(unsignedTx, Networks.PUBLIC);
    tx.sign(kp);

    // ...then the operator rotated the verified account before submission.
    routingTargetsForCorridor.mockReturnValue([
      { ...RESOLVED_TARGET, anchorAccount: Keypair.random().publicKey() },
    ]);

    await expect(
      executeIntent({ unsignedEnvelope, signature, signedTx: tx.toXDR() })
    ).rejects.toMatchObject({ code: 'TX_MISMATCH' });
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it('execute submits when the payment matches a resolved account and reports its anchor', async () => {
    routingTargetsForCorridor.mockReturnValue([RESOLVED_TARGET]);
    const kp = Keypair.random();
    const { unsignedEnvelope, unsignedTx } = await prepareIntent(intentFor(kp.publicKey()));
    const signature = Buffer.from(
      kp.sign(Buffer.from(unsignedEnvelope.intentHash, 'utf8'))
    ).toString('base64');
    const tx = TransactionBuilder.fromXDR(unsignedTx, Networks.PUBLIC);
    tx.sign(kp);
    submitTransaction.mockResolvedValueOnce({ hash: 'b'.repeat(64), ledger: 7 });

    await expect(
      executeIntent({ unsignedEnvelope, signature, signedTx: tx.toXDR() })
    ).resolves.toMatchObject({ corridorId: 'usdc-ngn', anchorId: 'cowrie' });
    expect(submitTransaction).toHaveBeenCalledTimes(1);
  });
});
