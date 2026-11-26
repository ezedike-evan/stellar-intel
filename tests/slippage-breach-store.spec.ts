import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InMemorySlippageBreachStore,
  PostgresSlippageBreachStore,
  _resetSlippageBreachSchema,
  _resetSlippageBreachStore,
  _setSlippageBreachStore,
  getSlippageBreachStore,
  type SlippageBreach,
  type SlippageEvidence,
} from '@/lib/reputation/slippage-breaches';
import { canonicalEvidenceJson } from '@/lib/reputation/slippage-evidence';

const executor = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('@/lib/reputation/pool', () => ({
  getSqlExecutor: () => executor,
  hasDatabaseUrl: () => Boolean(process.env.DATABASE_URL),
}));

function sampleEvidence(overrides: Partial<SlippageEvidence> = {}): SlippageEvidence {
  return {
    v: 1,
    networkPassphrase: 'Test SDF Network ; September 2015',
    intentHash: 'a'.repeat(64),
    anchorId: 'cowrie',
    corridor: 'ngnt-ngn',
    signerAccount: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7',
    minReceive: '1000.0',
    anchorReported: {
      anchorTransactionId: 'anchor-tx-1',
      amountOut: '980.0',
      reportedBy: 'sender',
    },
    shortfall: '20',
    shortfallBps: 200,
    onChain: null,
    detectedAt: '2026-11-22T10:00:00.000Z',
    ...overrides,
  };
}

function sampleBreach(overrides: Partial<SlippageBreach> = {}): SlippageBreach {
  const evidence = sampleEvidence(overrides.evidence);
  return {
    intentHash: evidence.intentHash,
    anchorId: evidence.anchorId,
    corridor: evidence.corridor,
    signerAccount: evidence.signerAccount,
    minReceive: evidence.minReceive,
    amountOut: evidence.anchorReported.amountOut,
    shortfall: evidence.shortfall,
    shortfallBps: evidence.shortfallBps,
    stellarTransactionId: 'b'.repeat(64),
    anchorTransactionId: evidence.anchorReported.anchorTransactionId,
    status: 'detected',
    rejectionReason: null,
    evidence,
    evidenceHash: 'c'.repeat(64),
    detectedAt: evidence.detectedAt,
    verifiedAt: null,
    ...overrides,
  };
}

describe('InMemorySlippageBreachStore', () => {
  let store: InMemorySlippageBreachStore;

  beforeEach(() => {
    store = new InMemorySlippageBreachStore();
  });

  it('creates and gets a breach', async () => {
    const breach = sampleBreach();
    const created = await store.create(breach);
    expect(created).toBe(true);

    const retrieved = await store.get(breach.intentHash);
    expect(retrieved).toEqual(breach);
  });

  it('duplicate create returns false (insert-only on intentHash)', async () => {
    const breach = sampleBreach();
    expect(await store.create(breach)).toBe(true);
    expect(await store.create(breach)).toBe(false);
  });

  it('returns null for an unknown intentHash', async () => {
    expect(await store.get('missing-hash')).toBeNull();
  });

  it('lists breaches newest detectedAt first', async () => {
    const b1 = sampleBreach({
      intentHash: '1'.repeat(64),
      detectedAt: '2026-11-22T10:00:00.000Z',
      evidence: sampleEvidence({
        intentHash: '1'.repeat(64),
        detectedAt: '2026-11-22T10:00:00.000Z',
      }),
    });
    const b2 = sampleBreach({
      intentHash: '2'.repeat(64),
      detectedAt: '2026-11-22T11:00:00.000Z',
      evidence: sampleEvidence({
        intentHash: '2'.repeat(64),
        detectedAt: '2026-11-22T11:00:00.000Z',
      }),
    });
    const b3 = sampleBreach({
      intentHash: '3'.repeat(64),
      detectedAt: '2026-11-22T09:00:00.000Z',
      evidence: sampleEvidence({
        intentHash: '3'.repeat(64),
        detectedAt: '2026-11-22T09:00:00.000Z',
      }),
    });

    await store.create(b1);
    await store.create(b2);
    await store.create(b3);

    const list = await store.list();
    expect(list.map((b) => b.intentHash)).toEqual(['2'.repeat(64), '1'.repeat(64), '3'.repeat(64)]);
  });

  it('filters by anchorId, status, and since (inclusive), and respects limit', async () => {
    const b1 = sampleBreach({
      intentHash: '1'.repeat(64),
      anchorId: 'cowrie',
      status: 'detected',
      detectedAt: '2026-11-22T10:00:00.000Z',
      evidence: sampleEvidence({
        intentHash: '1'.repeat(64),
        anchorId: 'cowrie',
        detectedAt: '2026-11-22T10:00:00.000Z',
      }),
    });
    const b2 = sampleBreach({
      intentHash: '2'.repeat(64),
      anchorId: 'mykobo',
      status: 'detected',
      detectedAt: '2026-11-22T11:00:00.000Z',
      evidence: sampleEvidence({
        intentHash: '2'.repeat(64),
        anchorId: 'mykobo',
        detectedAt: '2026-11-22T11:00:00.000Z',
      }),
    });
    const b3 = sampleBreach({
      intentHash: '3'.repeat(64),
      anchorId: 'cowrie',
      status: 'detected',
      detectedAt: '2026-11-22T12:00:00.000Z',
      evidence: sampleEvidence({
        intentHash: '3'.repeat(64),
        anchorId: 'cowrie',
        detectedAt: '2026-11-22T12:00:00.000Z',
      }),
    });

    await store.create(b1);
    await store.create(b2);
    await store.create(b3);

    // anchorId filter
    const cowrieOnly = await store.list({ anchorId: 'cowrie' });
    expect(cowrieOnly.map((b) => b.intentHash)).toEqual(['3'.repeat(64), '1'.repeat(64)]);

    // since filter (inclusive)
    const since11 = await store.list({ since: '2026-11-22T11:00:00.000Z' });
    expect(since11.map((b) => b.intentHash)).toEqual(['3'.repeat(64), '2'.repeat(64)]);

    // limit
    const limited = await store.list({ limit: 1 });
    expect(limited).toHaveLength(1);
    expect(limited[0]?.intentHash).toBe('3'.repeat(64));
  });

  it('resolves verification from detected -> updated; a second resolve -> null; unknown -> null', async () => {
    const breach = sampleBreach();
    await store.create(breach);

    const verifiedEvidence = sampleEvidence({
      ...breach.evidence,
      onChain: {
        txHash: 'e'.repeat(64),
        ledger: 123456,
        closedAt: '2026-11-22T10:05:00.000Z',
        successful: true,
        from: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7',
        to: 'GDQ5...DEST',
        assetCode: 'NGNT',
        assetIssuer: null,
        amount: '980.0',
        memoType: 'text',
        memo: 'ref-1',
      },
    });

    const update = {
      status: 'verified' as const,
      evidence: verifiedEvidence,
      evidenceHash: 'f'.repeat(64),
      rejectionReason: null,
      verifiedAt: '2026-11-22T10:06:00.000Z',
    };

    const resolved = await store.resolveVerification(breach.intentHash, update);
    expect(resolved).not.toBeNull();
    expect(resolved?.status).toBe('verified');
    expect(resolved?.verifiedAt).toBe('2026-11-22T10:06:00.000Z');
    expect(resolved?.evidenceHash).toBe('f'.repeat(64));
    expect(resolved?.evidence.onChain).toEqual(verifiedEvidence.onChain);

    // Second resolve on now-resolved breach returns null (status guard)
    const secondResolve = await store.resolveVerification(breach.intentHash, {
      ...update,
      status: 'rejected',
      rejectionReason: 'already verified',
    });
    expect(secondResolve).toBeNull();

    // Resolving an unknown breach returns null
    const unknownResolve = await store.resolveVerification('unknown-hash', update);
    expect(unknownResolve).toBeNull();
  });

  it('does not let callers mutate stored state', async () => {
    const breach = sampleBreach();
    await store.create(breach);

    const retrieved = await store.get(breach.intentHash);
    if (retrieved) retrieved.shortfall = 'tampered';

    expect((await store.get(breach.intentHash))?.shortfall).toBe('20');
  });
});

describe('PostgresSlippageBreachStore', () => {
  function fakeTable() {
    const rows = new Map<string, Record<string, unknown>>();
    executor.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('CREATE TABLE')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO slippage_breaches')) {
        const [
          intent_hash,
          anchor_id,
          corridor,
          signer_account,
          min_receive,
          amount_out,
          shortfall,
          shortfall_bps,
          stellar_transaction_id,
          anchor_transaction_id,
          status,
          rejection_reason,
          evidence,
          evidence_hash,
          detected_at,
          verified_at,
        ] = params;

        const key = String(intent_hash);
        if (rows.has(key)) {
          // ON CONFLICT (intent_hash) DO NOTHING
          return { rows: [] };
        }

        const newRow = {
          intent_hash,
          anchor_id,
          corridor,
          signer_account,
          min_receive,
          amount_out,
          shortfall,
          shortfall_bps,
          stellar_transaction_id,
          anchor_transaction_id,
          status,
          rejection_reason,
          evidence,
          evidence_hash,
          detected_at,
          verified_at,
        };
        rows.set(key, newRow);
        return { rows: [{ intent_hash }] };
      }
      if (sql.includes('UPDATE slippage_breaches')) {
        const [intent_hash, status, evidence, evidence_hash, rejection_reason, verified_at] =
          params;

        const key = String(intent_hash);
        const found = rows.get(key);
        if (!found || found['status'] !== 'detected') {
          return { rows: [] };
        }

        const updated = {
          ...found,
          status,
          evidence,
          evidence_hash,
          rejection_reason,
          verified_at,
        };
        rows.set(key, updated);
        return { rows: [updated] };
      }
      if (sql.includes('WHERE intent_hash = $1')) {
        const found = rows.get(String(params[0]));
        return { rows: found ? [found] : [] };
      }
      if (sql.includes('SELECT * FROM slippage_breaches')) {
        let all = [...rows.values()];
        if (sql.includes('anchor_id = $1')) {
          all = all.filter((r) => r['anchor_id'] === params[0]);
        }
        all.sort((a, b) => String(b['detected_at']).localeCompare(String(a['detected_at'])));
        const limitParam = params[params.length - 1];
        if (typeof limitParam === 'number') {
          all = all.slice(0, limitParam);
        }
        return { rows: all };
      }
      return { rows: [] };
    });
  }

  beforeEach(() => {
    executor.query.mockReset();
    _resetSlippageBreachSchema();
    fakeTable();
  });

  it('asserts ensureSchema runs once per process across operations', async () => {
    const store = new PostgresSlippageBreachStore();
    await store.create(sampleBreach({ intentHash: '1'.repeat(64) }));
    await store.create(sampleBreach({ intentHash: '2'.repeat(64) }));
    await store.get('1'.repeat(64));

    const ddlCalls = executor.query.mock.calls.filter(([sql]) =>
      String(sql).includes('CREATE TABLE IF NOT EXISTS slippage_breaches')
    );
    expect(ddlCalls).toHaveLength(1);
    expect(String(ddlCalls[0]?.[0])).toContain(
      'CREATE INDEX IF NOT EXISTS idx_slippage_breaches_anchor'
    );
    expect(String(ddlCalls[0]?.[0])).toContain(
      'CREATE INDEX IF NOT EXISTS idx_slippage_breaches_status'
    );
  });

  it('retries DDL after a failed attempt instead of caching failure', async () => {
    executor.query.mockRejectedValueOnce(new Error('connection timeout'));
    const store = new PostgresSlippageBreachStore();
    await expect(store.list()).rejects.toThrow('connection timeout');
    await expect(store.list()).resolves.toEqual([]);
  });

  it('asserts SQL text and params for create (ON CONFLICT)', async () => {
    const store = new PostgresSlippageBreachStore();
    const breach = sampleBreach();
    const res = await store.create(breach);
    expect(res).toBe(true);

    const insertCalls = executor.query.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO slippage_breaches')
    );
    expect(insertCalls).toHaveLength(1);
    const [sql, params] = insertCalls[0]!;
    expect(sql).toContain('ON CONFLICT (intent_hash) DO NOTHING');
    expect(sql).toContain('RETURNING intent_hash');
    expect(params).toEqual([
      breach.intentHash,
      breach.anchorId,
      breach.corridor,
      breach.signerAccount,
      breach.minReceive,
      breach.amountOut,
      breach.shortfall,
      breach.shortfallBps,
      breach.stellarTransactionId,
      breach.anchorTransactionId,
      breach.status,
      breach.rejectionReason,
      canonicalEvidenceJson(breach.evidence),
      breach.evidenceHash,
      breach.detectedAt,
      breach.verifiedAt,
    ]);

    // Duplicate create returns false
    const dupRes = await store.create(breach);
    expect(dupRes).toBe(false);
  });

  it('asserts SQL text and params for list with filters', async () => {
    const store = new PostgresSlippageBreachStore();
    await store.list({
      anchorId: 'cowrie',
      status: 'detected',
      since: '2026-11-22T00:00:00.000Z',
      limit: 50,
    });

    const listCalls = executor.query.mock.calls.filter(([sql]) =>
      String(sql).includes('SELECT * FROM slippage_breaches')
    );
    expect(listCalls).toHaveLength(1);
    const [sql, params] = listCalls[0]!;
    expect(sql).toContain('anchor_id = $1 AND status = $2 AND detected_at >= $3');
    expect(sql).toContain('ORDER BY detected_at DESC LIMIT $4');
    expect(params).toEqual(['cowrie', 'detected', '2026-11-22T00:00:00.000Z', 50]);
  });

  it('asserts SQL text and params for resolve (status guard)', async () => {
    const store = new PostgresSlippageBreachStore();
    const breach = sampleBreach();
    await store.create(breach);

    const update = {
      status: 'verified' as const,
      evidence: breach.evidence,
      evidenceHash: 'new-hash',
      rejectionReason: null,
      verifiedAt: '2026-11-22T10:10:00.000Z',
    };

    const resolved = await store.resolveVerification(breach.intentHash, update);
    expect(resolved).not.toBeNull();
    expect(resolved?.status).toBe('verified');

    const updateCalls = executor.query.mock.calls.filter(([sql]) =>
      String(sql).includes('UPDATE slippage_breaches')
    );
    expect(updateCalls).toHaveLength(1);
    const [sql, params] = updateCalls[0]!;
    expect(sql).toContain("WHERE intent_hash = $1 AND status = 'detected'");
    expect(sql).toContain('RETURNING *');
    expect(params).toEqual([
      breach.intentHash,
      'verified',
      canonicalEvidenceJson(breach.evidence),
      'new-hash',
      null,
      '2026-11-22T10:10:00.000Z',
    ]);

    // Second resolve returns null
    const second = await store.resolveVerification(breach.intentHash, update);
    expect(second).toBeNull();
  });
});

describe('getSlippageBreachStore', () => {
  beforeEach(() => {
    _resetSlippageBreachStore();
    vi.unstubAllEnvs();
  });

  it('picks InMemorySlippageBreachStore when DATABASE_URL is unset, and keeps it between calls', () => {
    const store1 = getSlippageBreachStore();
    expect(store1).toBeInstanceOf(InMemorySlippageBreachStore);
    const store2 = getSlippageBreachStore();
    expect(store2).toBe(store1);
  });

  it('picks PostgresSlippageBreachStore when DATABASE_URL is stubbed', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://postgres:pw@localhost:5432/test');
    expect(getSlippageBreachStore()).toBeInstanceOf(PostgresSlippageBreachStore);
  });

  it('honours _setSlippageBreachStore override, and clears it on null', () => {
    const custom = new InMemorySlippageBreachStore();
    _setSlippageBreachStore(custom);
    expect(getSlippageBreachStore()).toBe(custom);

    _setSlippageBreachStore(null);
    expect(getSlippageBreachStore()).not.toBe(custom);
    expect(getSlippageBreachStore()).toBeInstanceOf(InMemorySlippageBreachStore);
  });
});
