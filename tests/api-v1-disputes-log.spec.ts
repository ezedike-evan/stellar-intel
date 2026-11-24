// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/v1/disputes/log/route';
import { InMemoryAdjudicationLog, _setAdjudicationLog } from '@/lib/reputation/adjudication-log';

describe('GET /api/v1/disputes/log (#2133)', () => {
  let memoryLog: InMemoryAdjudicationLog;

  beforeEach(() => {
    memoryLog = new InMemoryAdjudicationLog();
    _setAdjudicationLog(memoryLog);
  });

  it('empty log returns entries: [], head: null, verification.ok: true', async () => {
    const req = new NextRequest('http://localhost:3000/api/v1/disputes/log');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('x-ratelimit-limit')).toBe('60');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');

    const data = await res.json();
    expect(data.entries).toEqual([]);
    expect(data.head).toBeNull();
    expect(data.verification).toEqual({ ok: true, length: 0, head: '0'.repeat(64) });
    expect(data.summary).toEqual({
      filed: 0,
      resolved: 0,
      accepted: 0,
      rejected: 0,
      open: 0,
      appealed: 0,
    });
    expect(data.hashFormat).toBe('stellar-intel/adjudication/v1');
  });

  it('serves pagination with afterSeq and limit, while summary is over all entries', async () => {
    await memoryLog.append({
      disputeRef: 'a1b2c3d4e5f60001',
      anchorId: 'cowrie',
      category: 'delayed',
      level: 'anchor',
      action: 'filed',
      rationale: 'Dispute 1 filed',
      decidedAt: '2026-01-01T00:00:00.000Z',
    });
    await memoryLog.append({
      disputeRef: 'a1b2c3d4e5f60002',
      anchorId: 'mykobo',
      category: 'wrong_amount',
      level: 'anchor',
      action: 'filed',
      rationale: 'Dispute 2 filed',
      decidedAt: '2026-01-02T00:00:00.000Z',
    });
    await memoryLog.append({
      disputeRef: 'a1b2c3d4e5f60002',
      anchorId: 'mykobo',
      category: 'wrong_amount',
      level: 'review',
      action: 'accepted',
      rationale: 'Dispute 2 accepted',
      decidedAt: '2026-01-03T00:00:00.000Z',
    });

    const req = new NextRequest('http://localhost:3000/api/v1/disputes/log?afterSeq=1&limit=1');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].seq).toBe(2);
    expect(data.entries[0].disputeRef).toBe('a1b2c3d4e5f60002');
    expect(data.head).toEqual({ seq: 3, entryHash: expect.any(String) });
    expect(data.verification.ok).toBe(true);
    expect(data.verification.length).toBe(3);
    // Summary is computed over all entries
    expect(data.summary).toEqual({
      filed: 2,
      resolved: 1,
      accepted: 1,
      rejected: 0,
      open: 1,
      appealed: 0,
    });
  });

  it('rejects limit=0 with 400 VALIDATION_ERROR', async () => {
    const req = new NextRequest('http://localhost:3000/api/v1/disputes/log?limit=0');
    const res = await GET(req);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe('VALIDATION_ERROR');
    expect(data.error.message).toMatch(/limit/i);
  });

  it('rejects invalid afterSeq with 400 VALIDATION_ERROR', async () => {
    const req = new NextRequest('http://localhost:3000/api/v1/disputes/log?afterSeq=-1');
    const res = await GET(req);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe('VALIDATION_ERROR');
  });

  it('response contains no G... Stellar account and no publicKey field', async () => {
    await memoryLog.append({
      disputeRef: 'a1b2c3d4e5f60001',
      anchorId: 'cowrie',
      category: 'delayed',
      level: 'anchor',
      action: 'filed',
      rationale: 'Clean rationale without accounts',
      decidedAt: '2026-01-01T00:00:00.000Z',
    });

    const req = new NextRequest('http://localhost:3000/api/v1/disputes/log');
    const res = await GET(req);
    const text = await res.text();

    expect(text).not.toMatch(/G[A-Z0-9]{55}/);
    expect(text).not.toContain('publicKey');
  });
});
