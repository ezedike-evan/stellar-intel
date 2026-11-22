import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InMemoryRefundStore,
  PostgresRefundStore,
  _resetRefundSchema,
  _setRefundStore,
  getRefundStore,
  type RefundAckUpdate,
  type RefundCase,
} from '@/lib/refunds/store';

const executor = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('@/lib/reputation/pool', () => ({
  getSqlExecutor: () => executor,
  hasDatabaseUrl: () => Boolean(process.env.DATABASE_URL),
}));

const SIGNER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

function refundCase(overrides: Partial<RefundCase> = {}): RefundCase {
  const id = overrides.id ?? 'rc-1';
  return {
    id,
    intentHash: overrides.intentHash ?? (id.length === 1 ? id.repeat(64) : 'a'.repeat(64)),
    reason: 'anchor_error_after_payment',
    anchorId: 'cowrie',
    corridor: 'ngnt-ngn',
    direction: 'withdraw',
    signerAccount: SIGNER,
    amountPaid: '100',
    status: 'owed',
    amountRefunded: null,
    refundFee: null,
    payments: [],
    openedAt: '2026-10-01T10:00:00.000Z',
    refundedAt: null,
    acknowledgedAt: null,
    ackHash: null,
    ackSignature: null,
    onChainCheck: null,
    ...overrides,
  };
}

function ackUpdate(overrides: Partial<RefundAckUpdate> = {}): RefundAckUpdate {
  return {
    amountRefunded: '100',
    refundFee: '0',
    payments: [{ id: 'p-1', idType: 'stellar', amount: '100', fee: '0' }],
    ackHash: 'c'.repeat(64),
    ackSignature: 'sig',
    acknowledgedAt: '2026-10-03T00:00:00.000Z',
    onChainCheck: 'verified',
    ...overrides,
  };
}

describe('InMemoryRefundStore', () => {
  let store: InMemoryRefundStore;

  beforeEach(() => {
    store = new InMemoryRefundStore();
  });

  it('opens and gets a case', async () => {
    expect(await store.open(refundCase())).toBe(true);
    expect(await store.get('rc-1')).toEqual(refundCase());
  });

  it('returns null for an unknown id', async () => {
    expect(await store.get('missing')).toBeNull();
  });

  it('refuses a duplicate (intentHash, reason) and keeps the first record', async () => {
    expect(await store.open(refundCase())).toBe(true);
    expect(await store.open(refundCase({ id: 'rc-2', amountPaid: '200' }))).toBe(false);
    expect(await store.get('rc-1')).toEqual(refundCase());
    expect(await store.get('rc-2')).toBeNull();
  });

  it('allows the same intent with a different reason', async () => {
    expect(await store.open(refundCase())).toBe(true);
    expect(await store.open(refundCase({ id: 'rc-2', reason: 'expired_after_payment' }))).toBe(
      true
    );
    expect(await store.getByIntentHash('a'.repeat(64))).toHaveLength(2);
  });

  it('lists cases for an intent oldest first', async () => {
    await store.open(refundCase({ id: 'new', openedAt: '2026-10-02T10:00:00.000Z' }));
    await store.open(
      refundCase({
        id: 'old',
        reason: 'expired_after_payment',
        openedAt: '2026-10-01T10:00:00.000Z',
      })
    );
    expect((await store.getByIntentHash('a'.repeat(64))).map((c) => c.id)).toEqual(['old', 'new']);
  });

  it('lists cases newest first and honours each filter field', async () => {
    await store.open(refundCase({ id: 'a', openedAt: '2026-10-01T10:00:00.000Z' }));
    await store.open(
      refundCase({
        id: 'b',
        anchorId: 'moneygram',
        status: 'refunded',
        refundedAt: '2026-10-02T10:00:00.000Z',
        openedAt: '2026-10-02T10:00:00.000Z',
      })
    );
    await store.open(refundCase({ id: 'c', openedAt: '2026-10-03T10:00:00.000Z' }));

    expect((await store.list()).map((c) => c.id)).toEqual(['c', 'b', 'a']);
    expect((await store.list({ status: 'refunded' })).map((c) => c.id)).toEqual(['b']);
    expect((await store.list({ anchorId: 'moneygram' })).map((c) => c.id)).toEqual(['b']);
    expect(
      (await store.list({ openedSince: '2026-10-02T00:00:00.000Z' })).map((c) => c.id)
    ).toEqual(['c', 'b']);
    expect((await store.list({ status: 'owed', anchorId: 'cowrie' })).map((c) => c.id)).toEqual([
      'c',
      'a',
    ]);
  });

  it('acknowledges an owed case, fills refundedAt and records the ack', async () => {
    await store.open(refundCase());
    const acknowledged = await store.acknowledge('rc-1', ackUpdate());
    expect(acknowledged).toMatchObject({
      status: 'acknowledged',
      amountRefunded: '100',
      refundFee: '0',
      refundedAt: '2026-10-03T00:00:00.000Z',
      acknowledgedAt: '2026-10-03T00:00:00.000Z',
      ackHash: 'c'.repeat(64),
      ackSignature: 'sig',
      onChainCheck: 'verified',
    });
    expect(acknowledged?.payments).toEqual([
      { id: 'p-1', idType: 'stellar', amount: '100', fee: '0' },
    ]);
    expect(await store.get('rc-1')).toEqual(acknowledged);
  });

  it('keeps an existing refundedAt when acknowledging a refunded case', async () => {
    await store.open(refundCase({ status: 'refunded', refundedAt: '2026-10-02T10:00:00.000Z' }));
    const acknowledged = await store.acknowledge('rc-1', ackUpdate());
    expect(acknowledged?.refundedAt).toBe('2026-10-02T10:00:00.000Z');
  });

  it('returns null when acknowledging twice, and for an unknown id', async () => {
    await store.open(refundCase());
    expect(await store.acknowledge('rc-1', ackUpdate())).not.toBeNull();
    expect(await store.acknowledge('rc-1', ackUpdate())).toBeNull();
    expect(await store.acknowledge('missing', ackUpdate())).toBeNull();
  });

  it('does not let callers mutate stored state', async () => {
    await store.open(refundCase());
    const fetched = await store.get('rc-1');
    if (fetched) {
      fetched.amountPaid = 'tampered';
      fetched.payments.push({ id: 'p-2', idType: 'external', amount: '1', fee: '0' });
    }
    expect((await store.get('rc-1'))?.amountPaid).toBe('100');
    expect((await store.get('rc-1'))?.payments).toEqual([]);
  });
});

describe('PostgresRefundStore', () => {
  /** A tiny fake of the `refund_cases` table, keyed by id. */
  function fakeTable() {
    const rows = new Map<string, Record<string, unknown>>();
    executor.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('CREATE TABLE')) return { rows: [] };
      if (sql.includes('INSERT INTO refund_cases')) {
        const [
          id,
          intent_hash,
          reason,
          anchor_id,
          corridor,
          direction,
          signer_account,
          amount_paid,
          status,
          amount_refunded,
          refund_fee,
          payments_json,
          opened_at,
          refunded_at,
          acknowledged_at,
          ack_hash,
          ack_signature,
          on_chain_check,
        ] = params;
        for (const existing of rows.values()) {
          if (existing['intent_hash'] === intent_hash && existing['reason'] === reason) {
            return { rows: [] };
          }
        }
        rows.set(String(id), {
          id,
          intent_hash,
          reason,
          anchor_id,
          corridor,
          direction,
          signer_account,
          amount_paid,
          status,
          amount_refunded,
          refund_fee,
          payments_json,
          opened_at,
          refunded_at,
          acknowledged_at,
          ack_hash,
          ack_signature,
          on_chain_check,
        });
        return { rows: [{ id }] };
      }
      if (sql.includes('UPDATE refund_cases')) {
        const [
          id,
          amountRefunded,
          refundFee,
          paymentsJson,
          ackHash,
          ackSignature,
          acknowledgedAt,
          onChainCheck,
        ] = params;
        const found = rows.get(String(id));
        if (!found || found['status'] === 'acknowledged') return { rows: [] };
        const updated = {
          ...found,
          status: 'acknowledged',
          amount_refunded: amountRefunded,
          refund_fee: refundFee,
          payments_json: paymentsJson,
          ack_hash: ackHash,
          ack_signature: ackSignature,
          acknowledged_at: acknowledgedAt,
          refunded_at: found['refunded_at'] ?? acknowledgedAt,
          on_chain_check: onChainCheck,
        };
        rows.set(String(id), updated);
        return { rows: [updated] };
      }
      if (sql.includes('WHERE id = $1')) {
        const found = rows.get(String(params[0]));
        return { rows: found ? [found] : [] };
      }
      if (sql.includes('WHERE intent_hash = $1')) {
        const found = [...rows.values()]
          .filter((r) => r['intent_hash'] === params[0])
          .sort((a, b) => String(a['opened_at']).localeCompare(String(b['opened_at'])));
        return { rows: found };
      }
      if (sql.includes('ORDER BY opened_at DESC')) {
        let found = [...rows.values()];
        const statusMatch = sql.match(/status = \$(\d+)/);
        if (statusMatch) {
          found = found.filter((r) => r['status'] === params[Number(statusMatch[1]) - 1]);
        }
        const anchorMatch = sql.match(/anchor_id = \$(\d+)/);
        if (anchorMatch) {
          found = found.filter((r) => r['anchor_id'] === params[Number(anchorMatch[1]) - 1]);
        }
        const sinceMatch = sql.match(/opened_at >= \$(\d+)/);
        if (sinceMatch) {
          found = found.filter(
            (r) => String(r['opened_at']) >= String(params[Number(sinceMatch[1]) - 1])
          );
        }
        found.sort((a, b) => String(b['opened_at']).localeCompare(String(a['opened_at'])));
        return { rows: found };
      }
      return { rows: [] };
    });
  }

  beforeEach(() => {
    executor.query.mockReset();
    _resetRefundSchema();
    fakeTable();
  });

  it('creates the table once per process, not once per call', async () => {
    const store = new PostgresRefundStore();
    await store.open(refundCase({ id: 'a' }));
    await store.open(refundCase({ id: 'b', reason: 'expired_after_payment' }));
    const ddl = executor.query.mock.calls.filter(([sql]) => String(sql).includes('CREATE TABLE'));
    expect(ddl).toHaveLength(1);
    expect(String(ddl[0]?.[0])).toContain('refund_cases');
  });

  it('round-trips open, get, getByIntentHash, list and acknowledge', async () => {
    const store = new PostgresRefundStore();
    await store.open(refundCase({ id: 'old', openedAt: '2026-10-01T10:00:00.000Z' }));
    await store.open(
      refundCase({
        id: 'new',
        reason: 'expired_after_payment',
        openedAt: '2026-10-02T10:00:00.000Z',
      })
    );

    expect(await store.get('old')).toEqual(refundCase({ id: 'old' }));
    expect((await store.getByIntentHash('a'.repeat(64))).map((c) => c.id)).toEqual(['old', 'new']);
    expect((await store.list()).map((c) => c.id)).toEqual(['new', 'old']);
    expect((await store.list({ status: 'owed' })).map((c) => c.id)).toEqual(['new', 'old']);

    const acknowledged = await store.acknowledge('old', ackUpdate());
    expect(acknowledged).toMatchObject({
      status: 'acknowledged',
      refundedAt: '2026-10-03T00:00:00.000Z',
    });
    expect(await store.acknowledge('old', ackUpdate())).toBeNull();
  });

  it('returns false on a duplicate open and keeps the first record', async () => {
    const store = new PostgresRefundStore();
    expect(await store.open(refundCase())).toBe(true);
    expect(await store.open(refundCase({ id: 'rc-2', amountPaid: '200' }))).toBe(false);
    expect((await store.get('rc-1'))?.amountPaid).toBe('100');
  });

  it('sends ON CONFLICT (intent_hash, reason) DO NOTHING on open', async () => {
    const store = new PostgresRefundStore();
    await store.open(refundCase());
    const insert = executor.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO refund_cases')
    );
    expect(String(insert?.[0])).toContain('ON CONFLICT (intent_hash, reason) DO NOTHING');
  });

  it('guards acknowledge with status <> acknowledged and never deletes', async () => {
    const store = new PostgresRefundStore();
    await store.open(refundCase());
    await store.acknowledge('rc-1', ackUpdate());
    await store.get('rc-1');
    await store.list();
    const update = executor.query.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE refund_cases')
    );
    expect(String(update?.[0])).toContain("status <> 'acknowledged'");
    for (const [sql] of executor.query.mock.calls) {
      expect(String(sql)).not.toContain('DELETE');
    }
  });

  it('parses a broken payments_json as an empty list', async () => {
    const store = new PostgresRefundStore();
    await store.open(refundCase());
    executor.query.mockImplementationOnce(async (sql: string) => {
      if (sql.includes('WHERE id = $1')) {
        return {
          rows: [
            {
              id: 'rc-1',
              intent_hash: 'a'.repeat(64),
              reason: 'anchor_error_after_payment',
              anchor_id: 'cowrie',
              corridor: 'ngnt-ngn',
              direction: 'withdraw',
              signer_account: SIGNER,
              amount_paid: '100',
              status: 'owed',
              amount_refunded: null,
              refund_fee: null,
              payments_json: '{not json',
              opened_at: '2026-10-01T10:00:00.000Z',
              refunded_at: null,
              acknowledged_at: null,
              ack_hash: null,
              ack_signature: null,
              on_chain_check: null,
            },
          ],
        };
      }
      return { rows: [] };
    });
    expect((await store.get('rc-1'))?.payments).toEqual([]);
  });

  it('retries the DDL after a failed attempt instead of caching the failure', async () => {
    executor.query.mockRejectedValueOnce(new Error('connection refused'));
    const store = new PostgresRefundStore();
    await expect(store.list()).rejects.toThrow('connection refused');
    await expect(store.list()).resolves.toEqual([]);
  });
});

describe('getRefundStore', () => {
  beforeEach(() => {
    _setRefundStore(null);
    vi.unstubAllEnvs();
  });

  it('uses the in-memory store without a database, and keeps it between calls', () => {
    expect(getRefundStore()).toBeInstanceOf(InMemoryRefundStore);
    expect(getRefundStore()).toBe(getRefundStore());
  });

  it('uses Postgres when DATABASE_URL is set', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://localhost/test');
    expect(getRefundStore()).toBeInstanceOf(PostgresRefundStore);
  });

  it('honours an injected store, and drops it on reset', () => {
    const injected = new InMemoryRefundStore();
    _setRefundStore(injected);
    expect(getRefundStore()).toBe(injected);
    _setRefundStore(null);
    expect(getRefundStore()).not.toBe(injected);
  });
});
