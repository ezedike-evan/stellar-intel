import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InMemoryRefundStore,
  PostgresRefundStore,
  _resetRefundSchema,
  _setRefundStore,
  getRefundStore,
  toRefundCase,
  type RefundAckUpdate,
  type RefundCase,
} from '@/lib/refunds/store';

const executor = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('@/lib/reputation/pool', () => ({
  getSqlExecutor: () => executor,
  hasDatabaseUrl: () => Boolean(process.env.DATABASE_URL),
}));

function refundCase(overrides: Partial<RefundCase> = {}): RefundCase {
  return {
    id: 'r-1',
    intentHash: 'a'.repeat(64),
    reason: 'anchor_error_after_payment',
    anchorId: 'moneygram',
    corridor: 'USDC-NGN',
    direction: 'withdraw',
    signerAccount: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    amountPaid: '100.00',
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

function ack(overrides: Partial<RefundAckUpdate> = {}): RefundAckUpdate {
  return {
    amountRefunded: '99.50',
    refundFee: '0.50',
    payments: [{ id: 'p-1', idType: 'stellar', amount: '99.50', fee: '0.50' }],
    ackHash: 'b'.repeat(64),
    ackSignature: 'c'.repeat(128),
    acknowledgedAt: '2026-10-05T12:00:00.000Z',
    onChainCheck: 'verified',
    ...overrides,
  };
}

describe('InMemoryRefundStore', () => {
  let store: InMemoryRefundStore;

  beforeEach(() => {
    store = new InMemoryRefundStore();
  });

  it('opens a case and gets it back', async () => {
    expect(await store.open(refundCase())).toBe(true);
    expect(await store.get('r-1')).toEqual(refundCase());
  });

  it('returns null for an unknown id', async () => {
    expect(await store.get('missing')).toBeNull();
  });

  it('refuses a second case for the same intent and reason, keeping the first', async () => {
    expect(await store.open(refundCase())).toBe(true);
    expect(await store.open(refundCase({ id: 'r-2', amountPaid: '5.00' }))).toBe(false);
    expect(await store.get('r-2')).toBeNull();
    expect(await store.get('r-1')).toEqual(refundCase());
  });

  it('allows the same intent with a different reason', async () => {
    expect(await store.open(refundCase())).toBe(true);
    expect(await store.open(refundCase({ id: 'r-2', reason: 'slippage_breach' }))).toBe(true);
    expect(await store.getByIntentHash('a'.repeat(64))).toHaveLength(2);
  });

  it('lists every case for an intent oldest first', async () => {
    await store.open(
      refundCase({ id: 'new', reason: 'slippage_breach', openedAt: '2026-10-03T00:00:00.000Z' })
    );
    await store.open(refundCase({ id: 'old', openedAt: '2026-10-01T00:00:00.000Z' }));
    await store.open(refundCase({ id: 'other', intentHash: 'f'.repeat(64) }));
    expect((await store.getByIntentHash('a'.repeat(64))).map((c) => c.id)).toEqual(['old', 'new']);
  });

  it('lists newest first and honours each filter field', async () => {
    await store.open(
      refundCase({ id: 'r-1', intentHash: '1'.repeat(64), openedAt: '2026-10-01T00:00:00.000Z' })
    );
    await store.open(
      refundCase({
        id: 'r-2',
        intentHash: '2'.repeat(64),
        anchorId: 'cowrie',
        openedAt: '2026-10-02T00:00:00.000Z',
      })
    );
    await store.open(
      refundCase({
        id: 'r-3',
        intentHash: '3'.repeat(64),
        status: 'refunded',
        refundedAt: '2026-10-03T06:00:00.000Z',
        openedAt: '2026-10-03T00:00:00.000Z',
      })
    );
    const ids = async (filter?: Parameters<InMemoryRefundStore['list']>[0]) =>
      (await store.list(filter)).map((c) => c.id);

    expect(await ids()).toEqual(['r-3', 'r-2', 'r-1']);
    expect(await ids({ status: 'owed' })).toEqual(['r-2', 'r-1']);
    expect(await ids({ status: 'refunded' })).toEqual(['r-3']);
    expect(await ids({ anchorId: 'cowrie' })).toEqual(['r-2']);
    expect(await ids({ openedSince: '2026-10-02T00:00:00.000Z' })).toEqual(['r-3', 'r-2']);
    expect(await ids({ status: 'owed', anchorId: 'moneygram' })).toEqual(['r-1']);
  });

  it('acknowledges an owed case and fills refundedAt from the acknowledgement', async () => {
    await store.open(refundCase());
    const acknowledged = await store.acknowledge('r-1', ack());
    expect(acknowledged).toEqual(
      refundCase({
        status: 'acknowledged',
        amountRefunded: '99.50',
        refundFee: '0.50',
        payments: [{ id: 'p-1', idType: 'stellar', amount: '99.50', fee: '0.50' }],
        acknowledgedAt: '2026-10-05T12:00:00.000Z',
        refundedAt: '2026-10-05T12:00:00.000Z',
        ackHash: 'b'.repeat(64),
        ackSignature: 'c'.repeat(128),
        onChainCheck: 'verified',
      })
    );
    expect(await store.get('r-1')).toEqual(acknowledged);
  });

  it('keeps an existing refundedAt when acknowledging a refunded case', async () => {
    await store.open(
      refundCase({
        status: 'refunded',
        reason: 'anchor_refunded',
        refundedAt: '2026-10-02T08:00:00.000Z',
      })
    );
    const acknowledged = await store.acknowledge('r-1', ack());
    expect(acknowledged?.status).toBe('acknowledged');
    expect(acknowledged?.refundedAt).toBe('2026-10-02T08:00:00.000Z');
  });

  it('returns null when acknowledging twice or an unknown id', async () => {
    await store.open(refundCase());
    expect(await store.acknowledge('r-1', ack())).not.toBeNull();
    expect(await store.acknowledge('r-1', ack({ amountRefunded: '1.00' }))).toBeNull();
    expect((await store.get('r-1'))?.amountRefunded).toBe('99.50');
    expect(await store.acknowledge('missing', ack())).toBeNull();
  });

  it('never hands out internal references', async () => {
    const original = refundCase({
      payments: [{ id: 'p-0', idType: 'external', amount: '1.00', fee: '0.00' }],
    });
    await store.open(original);
    original.anchorId = 'changed';
    original.payments[0]!.amount = '999';

    const fetched = (await store.get('r-1'))!;
    fetched.status = 'acknowledged';
    fetched.payments.push({ id: 'p-9', idType: 'stellar', amount: '9', fee: '0' });
    (await store.list())[0]!.payments[0]!.fee = '5';
    (await store.getByIntentHash('a'.repeat(64)))[0]!.anchorId = 'x';

    const update = ack();
    const acknowledged = (await store.acknowledge('r-1', update))!;
    update.payments[0]!.amount = '0';
    acknowledged.payments[0]!.id = 'tampered';

    const stored = (await store.get('r-1'))!;
    expect(stored.anchorId).toBe('moneygram');
    expect(stored.payments).toEqual([
      { id: 'p-1', idType: 'stellar', amount: '99.50', fee: '0.50' },
    ]);
  });
});

describe('toRefundCase', () => {
  const row = {
    id: 'r-1',
    intent_hash: 'a'.repeat(64),
    reason: 'anchor_error_after_payment',
    anchor_id: 'moneygram',
    corridor: 'USDC-NGN',
    direction: 'withdraw',
    signer_account: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    amount_paid: '100.00',
    status: 'owed',
    amount_refunded: null,
    refund_fee: null,
    payments_json: '[]',
    opened_at: '2026-10-01T10:00:00.000Z',
    refunded_at: null,
    acknowledged_at: null,
    ack_hash: null,
    ack_signature: null,
    on_chain_check: null,
  };

  it('maps every column', () => {
    expect(toRefundCase(row)).toEqual(refundCase());
  });

  it('parses payments and falls back to none when payments_json is not a list', () => {
    const payments = [{ id: 'p-1', idType: 'stellar', amount: '1', fee: '0' }];
    expect(toRefundCase({ ...row, payments_json: JSON.stringify(payments) }).payments).toEqual(
      payments
    );
    for (const bad of ['not json', '{"a":1}', 'null', '', null, 42]) {
      expect(toRefundCase({ ...row, payments_json: bad }).payments).toEqual([]);
    }
  });
});

describe('PostgresRefundStore', () => {
  /** A refund_cases table good enough to exercise the store's SQL. */
  function fakeTable() {
    const rows = new Map<string, Record<string, unknown>>();
    executor.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('CREATE TABLE') || sql.includes('CREATE INDEX')) return { rows: [] };
      if (sql.includes('INSERT INTO refund_cases')) {
        const columns = [
          'id',
          'intent_hash',
          'reason',
          'anchor_id',
          'corridor',
          'direction',
          'signer_account',
          'amount_paid',
          'status',
          'amount_refunded',
          'refund_fee',
          'payments_json',
          'opened_at',
          'refunded_at',
          'acknowledged_at',
          'ack_hash',
          'ack_signature',
          'on_chain_check',
        ];
        const row = Object.fromEntries(columns.map((c, i) => [c, params[i]]));
        const conflict = [...rows.values()].some(
          (r) => r['intent_hash'] === row['intent_hash'] && r['reason'] === row['reason']
        );
        if (conflict) return { rows: [] };
        rows.set(String(row['id']), row);
        return { rows: [{ id: row['id'] }] };
      }
      if (sql.includes('UPDATE refund_cases')) {
        const [id, amountRefunded, refundFee, paymentsJson, ackHash, ackSignature, at, check] =
          params;
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
          acknowledged_at: at,
          on_chain_check: check,
          refunded_at: found['refunded_at'] ?? at,
        };
        rows.set(String(id), updated);
        return { rows: [updated] };
      }
      if (sql.includes('WHERE id = $1')) {
        const found = rows.get(String(params[0]));
        return { rows: found ? [found] : [] };
      }
      if (sql.includes('WHERE intent_hash = $1')) {
        return {
          rows: [...rows.values()]
            .filter((r) => r['intent_hash'] === params[0])
            .sort((a, b) => String(a['opened_at']).localeCompare(String(b['opened_at']))),
        };
      }
      if (sql.includes('SELECT * FROM refund_cases')) {
        return {
          rows: [...rows.values()].sort((a, b) =>
            String(b['opened_at']).localeCompare(String(a['opened_at']))
          ),
        };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });
    return rows;
  }

  const executed = () => executor.query.mock.calls.map(([sql]) => String(sql));

  beforeEach(() => {
    executor.query.mockReset();
    _resetRefundSchema();
  });

  it('runs the DDL once across calls, with the table, primary key and unique pair', async () => {
    fakeTable();
    const store = new PostgresRefundStore();
    await store.get('a');
    await store.list();
    const ddl = executed().filter((sql) => sql.includes('CREATE TABLE'));
    expect(ddl).toHaveLength(1);
    expect(ddl[0]).toContain('CREATE TABLE IF NOT EXISTS refund_cases');
    expect(ddl[0]).toContain('PRIMARY KEY (id)');
    expect(ddl[0]).toContain('UNIQUE (intent_hash, reason)');
    expect(ddl[0]).toContain("payments_json   TEXT NOT NULL DEFAULT '[]'");
  });

  it('retries the DDL after a failure instead of poisoning the process', async () => {
    executor.query.mockRejectedValueOnce(new Error('connection reset'));
    const store = new PostgresRefundStore();
    await expect(store.get('a')).rejects.toThrow('connection reset');
    fakeTable();
    await expect(store.get('a')).resolves.toBeNull();
  });

  it('opens with ON CONFLICT (intent_hash, reason) DO NOTHING and reports a duplicate', async () => {
    fakeTable();
    const store = new PostgresRefundStore();
    const payments = [{ id: 'p-1', idType: 'external' as const, amount: '1.00', fee: '0.10' }];
    expect(await store.open(refundCase({ payments }))).toBe(true);
    expect(await store.open(refundCase({ id: 'r-2' }))).toBe(false);
    const insert = executed().find((sql) => sql.includes('INSERT INTO refund_cases'))!;
    expect(insert).toContain('ON CONFLICT (intent_hash, reason) DO NOTHING');
    expect(insert).toContain('RETURNING id');
    expect(await store.get('r-1')).toEqual(refundCase({ payments }));
    expect(await store.get('r-2')).toBeNull();
  });

  it('acknowledges with one guarded UPDATE, and only once', async () => {
    fakeTable();
    const store = new PostgresRefundStore();
    await store.open(refundCase());
    const acknowledged = await store.acknowledge('r-1', ack());
    expect(acknowledged).toMatchObject({
      status: 'acknowledged',
      refundedAt: '2026-10-05T12:00:00.000Z',
      payments: ack().payments,
    });
    expect(await store.acknowledge('r-1', ack())).toBeNull();
    const updates = executed().filter((sql) => sql.includes('UPDATE'));
    expect(updates).toHaveLength(2);
    for (const sql of updates) {
      expect(sql).toContain("WHERE id = $1 AND status <> 'acknowledged'");
      expect(sql).toContain('RETURNING *');
      expect(sql).toContain('COALESCE(refunded_at, $7)');
    }
  });

  it('passes list filters as parameters, newest first', async () => {
    fakeTable();
    const store = new PostgresRefundStore();
    await store.list({
      status: 'owed',
      anchorId: 'moneygram',
      openedSince: '2026-10-01T00:00:00.000Z',
    });
    const [sql, params] = executor.query.mock.calls.at(-1)!;
    expect(sql).toBe(
      'SELECT * FROM refund_cases WHERE status = $1 AND anchor_id = $2 AND opened_at >= $3 ORDER BY opened_at DESC'
    );
    expect(params).toEqual(['owed', 'moneygram', '2026-10-01T00:00:00.000Z']);
  });

  it('orders an intent oldest first', async () => {
    fakeTable();
    const store = new PostgresRefundStore();
    await store.getByIntentHash('a'.repeat(64));
    expect(executed().at(-1)).toContain('WHERE intent_hash = $1 ORDER BY opened_at ASC');
  });

  it('never deletes anything', async () => {
    fakeTable();
    const store = new PostgresRefundStore();
    await store.open(refundCase());
    await store.get('r-1');
    await store.getByIntentHash('a'.repeat(64));
    await store.list({ status: 'owed' });
    await store.acknowledge('r-1', ack());
    await store.acknowledge('r-1', ack());
    for (const sql of executed()) expect(sql.toUpperCase()).not.toContain('DELETE');
  });
});

describe('getRefundStore', () => {
  const saved = process.env.DATABASE_URL;

  afterEach(() => {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
    _setRefundStore(null);
  });

  it('uses Postgres when DATABASE_URL is set', () => {
    process.env.DATABASE_URL = 'postgres://localhost/test';
    expect(getRefundStore()).toBeInstanceOf(PostgresRefundStore);
  });

  it('uses the in-memory store otherwise', () => {
    delete process.env.DATABASE_URL;
    expect(getRefundStore()).toBeInstanceOf(InMemoryRefundStore);
  });

  it('honours a pinned store, and dropping the pin drops the in-memory state', async () => {
    delete process.env.DATABASE_URL;
    const pinned = new InMemoryRefundStore();
    _setRefundStore(pinned);
    expect(getRefundStore()).toBe(pinned);

    _setRefundStore(null);
    await getRefundStore().open(refundCase());
    _setRefundStore(null);
    expect(await getRefundStore().get('r-1')).toBeNull();
  });
});
