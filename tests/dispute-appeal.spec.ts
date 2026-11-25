// @vitest-environment node
import { describe, it, expect, beforeEach, beforeAll, afterEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/reputation/dispute/appeal/route';
import {
  _setDisputeStore,
  InMemoryDisputeStore,
  getDisputeStore,
  type Dispute,
} from '@/lib/reputation/disputes';
import {
  _setAdjudicationLog,
  InMemoryAdjudicationLog,
  getAdjudicationLog,
  publicDisputeRef,
} from '@/lib/reputation/adjudication-log';
import { APPEAL_WINDOW_MS } from '@/lib/reputation/dispute-ladder';

function signHash(keypair: Keypair, intentHash: string): string {
  const messageBytes = Buffer.from(intentHash, 'hex');
  const sig = keypair.sign(messageBytes);
  return Buffer.from(sig).toString('base64');
}

function makeAppealRequest(body: unknown, ip = '203.0.113.1'): NextRequest {
  return new NextRequest('http://localhost/api/reputation/dispute/appeal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

describe('POST /api/reputation/dispute/appeal (#2139)', () => {
  let disputeStore: InMemoryDisputeStore;
  let adjudicationLog: InMemoryAdjudicationLog;
  let filer: Keypair;
  const intentHash = '1'.repeat(64);

  beforeAll(() => {
    filer = Keypair.random();
  });

  beforeEach(() => {
    disputeStore = new InMemoryDisputeStore();
    adjudicationLog = new InMemoryAdjudicationLog();
    _setDisputeStore(disputeStore);
    _setAdjudicationLog(adjudicationLog);
  });

  afterEach(() => {
    _setDisputeStore(null);
    _setAdjudicationLog(null);
  });

  async function seedDispute(overrides: Partial<Dispute> = {}): Promise<Dispute> {
    const dispute: Dispute = {
      id: 'disp-uuid-12345678',
      intentHash,
      publicKey: filer.publicKey(),
      anchorId: 'moneygram',
      reason: 'delayed payment',
      status: 'rejected',
      createdAt: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
      resolvedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
      category: 'delayed',
      level: 'review',
      levelDeadline: '2026-11-08T00:00:00.000Z',
      subjectKind: 'outcome',
      subjectRef: intentHash,
      appealedAt: null,
      ...overrides,
    };
    await disputeStore.create(dispute);
    return dispute;
  }

  it('allows filer to appeal a rejected dispute within 14 days and logs action', async () => {
    const dispute = await seedDispute();
    const ref = publicDisputeRef(dispute.id);
    const signature = signHash(filer, intentHash);

    const res = await POST(
      makeAppealRequest({
        intentHash,
        publicKey: filer.publicKey(),
        signature,
        ref,
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ref).toBe(ref);
    expect(body.level).toBe('appeal');
    expect(body.levelDeadline).toBeDefined();

    // Verify dispute state in store
    const updated = await disputeStore.get(dispute.id);
    expect(updated?.status).toBe('open');
    expect(updated?.level).toBe('appeal');
    expect(updated?.appealedAt).toBeDefined();
    expect(updated?.resolvedAt).toBeNull();

    // Verify adjudication log
    const log = await adjudicationLog.list();
    expect(log).toHaveLength(1);
    expect(log[0]?.action).toBe('appealed');
    expect(log[0]?.level).toBe('appeal');
    expect(log[0]?.disputeRef).toBe(ref);
    expect(log[0]?.anchorId).toBe('moneygram');
  });

  it('rejects an appeal with 409 NOT_RESOLVED when dispute is still open', async () => {
    const dispute = await seedDispute({ status: 'open', resolvedAt: null });
    const ref = publicDisputeRef(dispute.id);
    const signature = signHash(filer, intentHash);

    const res = await POST(
      makeAppealRequest({
        intentHash,
        publicKey: filer.publicKey(),
        signature,
        ref,
      })
    );

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('NOT_RESOLVED');
  });

  it('rejects a second appeal after another decision with 409 ALREADY_APPEALED', async () => {
    const dispute = await seedDispute({
      status: 'rejected',
      appealedAt: '2026-11-06T00:00:00.000Z',
    });
    const ref = publicDisputeRef(dispute.id);
    const signature = signHash(filer, intentHash);

    const res = await POST(
      makeAppealRequest({
        intentHash,
        publicKey: filer.publicKey(),
        signature,
        ref,
      })
    );

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('ALREADY_APPEALED');
  });

  it('rejects an appeal outside the 14-day window with 410 APPEAL_WINDOW_CLOSED', async () => {
    // 14 days + 1 ms ago
    const resolvedTime = Date.now() - (APPEAL_WINDOW_MS + 1000);
    const dispute = await seedDispute({
      status: 'rejected',
      resolvedAt: new Date(resolvedTime).toISOString(),
    });
    const ref = publicDisputeRef(dispute.id);
    const signature = signHash(filer, intentHash);

    const res = await POST(
      makeAppealRequest({
        intentHash,
        publicKey: filer.publicKey(),
        signature,
        ref,
      })
    );

    expect(res.status).toBe(410);
    expect((await res.json()).code).toBe('APPEAL_WINDOW_CLOSED');
  });

  it('rejects with 403 when signature belongs to a different key', async () => {
    const dispute = await seedDispute();
    const ref = publicDisputeRef(dispute.id);
    const other = Keypair.random();
    const wrongSig = signHash(other, intentHash);

    const res = await POST(
      makeAppealRequest({
        intentHash,
        publicKey: filer.publicKey(),
        signature: wrongSig,
        ref,
      })
    );

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('FORBIDDEN');
  });

  it('rejects with 403 when publicKey is not the original filer', async () => {
    const dispute = await seedDispute();
    const ref = publicDisputeRef(dispute.id);
    const stranger = Keypair.random();
    const signature = signHash(stranger, intentHash);

    const res = await POST(
      makeAppealRequest({
        intentHash,
        publicKey: stranger.publicKey(),
        signature,
        ref,
      })
    );

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('FORBIDDEN');
  });

  it('answers 404 for an unknown dispute reference', async () => {
    await seedDispute();
    const unknownRef = '0000000000000000';
    const signature = signHash(filer, intentHash);

    const res = await POST(
      makeAppealRequest({
        intentHash,
        publicKey: filer.publicKey(),
        signature,
        ref: unknownRef,
      })
    );

    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('NOT_FOUND');
  });
});
