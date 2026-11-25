import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/intent/status/route';
import { clearRateLimitStore } from '@/lib/api/rate-limit';
import {
  InMemorySettlementStatusStore,
  _setSettlementStatusStore,
} from '@/lib/webhooks/settlement-status';
import * as sep24Module from '@/lib/stellar/sep24';
import { SepError } from '@/lib/stellar/errors';
import * as loggerModule from '@/lib/logger';

const VALID_TRANSFER_SERVER = 'https://stellar.moneygram.com/sep24';
const JWT = 'mock-bearer-jwt-token-xyz';

function makeRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  const allHeaders: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${JWT}`,
    ...headers,
  };
  return new NextRequest('http://localhost/api/intent/status', {
    method: 'POST',
    headers: allHeaders,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const VALID_BODY = {
  anchorId: 'moneygram',
  transferServer: VALID_TRANSFER_SERVER,
  transactionId: 'txn-12345',
  protocol: 'sep24',
  direction: 'withdraw',
  intentHash: 'a'.repeat(64),
};

describe('POST /api/intent/status', () => {
  let store: InMemorySettlementStatusStore;
  let getSep24TxSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clearRateLimitStore();
    store = new InMemorySettlementStatusStore();
    _setSettlementStatusStore(store);
    getSep24TxSpy = vi.spyOn(sep24Module, 'getSep24Transaction');
  });

  afterEach(() => {
    _setSettlementStatusStore(null);
    vi.restoreAllMocks();
  });

  it('records initial status observation with changed=true and previous=null', async () => {
    getSep24TxSpy.mockResolvedValueOnce({
      id: 'txn-12345',
      status: 'pending_anchor',
      more_info_url: 'https://example.com/info',
    } as any);

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data).toEqual({
      status: 'pending_anchor',
      previous: null,
      changed: true,
      terminal: false,
    });
  });

  it('reports changed=false and preserves previous status on unchanged second call', async () => {
    getSep24TxSpy
      .mockResolvedValueOnce({
        id: 'txn-12345',
        status: 'pending_anchor',
      } as any)
      .mockResolvedValueOnce({
        id: 'txn-12345',
        status: 'pending_anchor',
      } as any);

    const first = await POST(makeRequest(VALID_BODY));
    expect(first.status).toBe(200);

    const second = await POST(makeRequest(VALID_BODY));
    expect(second.status).toBe(200);
    const data = await second.json();

    expect(data).toEqual({
      status: 'pending_anchor',
      previous: 'pending_anchor',
      changed: false,
      terminal: false,
    });
  });

  it('reports changed=true and terminal=true on transition to completed', async () => {
    getSep24TxSpy
      .mockResolvedValueOnce({
        id: 'txn-12345',
        status: 'pending_anchor',
      } as any)
      .mockResolvedValueOnce({
        id: 'txn-12345',
        status: 'completed',
      } as any);

    await POST(makeRequest(VALID_BODY));

    const second = await POST(makeRequest(VALID_BODY));
    expect(second.status).toBe(200);
    const data = await second.json();

    expect(data).toEqual({
      status: 'completed',
      previous: 'pending_anchor',
      changed: true,
      terminal: true,
    });
  });

  it('returns 400 TRANSFER_SERVER_NOT_ALLOWED for non-allowlisted transfer servers', async () => {
    const res = await POST(
      makeRequest({
        ...VALID_BODY,
        transferServer: 'https://evil.attacker.com/sep24',
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe('TRANSFER_SERVER_NOT_ALLOWED');
  });

  it('returns 401 when Authorization header is missing or empty', async () => {
    const noAuth = new NextRequest('http://localhost/api/intent/status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    });
    const resNoAuth = await POST(noAuth);
    expect(resNoAuth.status).toBe(401);
    expect((await resNoAuth.json()).code).toBe('UNAUTHORIZED');

    const emptyAuth = new NextRequest('http://localhost/api/intent/status', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' },
      body: JSON.stringify(VALID_BODY),
    });
    const resEmptyAuth = await POST(emptyAuth);
    expect(resEmptyAuth.status).toBe(401);
  });

  it('returns 400 VALIDATION_ERROR on unknown anchorId or bad schema', async () => {
    const res = await POST(
      makeRequest({
        ...VALID_BODY,
        anchorId: 'non-existent-anchor',
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 INVALID_JSON on unparseable json', async () => {
    const req = new NextRequest('http://localhost/api/intent/status', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${JWT}`,
      },
      body: 'this-is-not-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_JSON');
  });

  it('returns 502 UPSTREAM_ERROR on anchor SepError', async () => {
    getSep24TxSpy.mockRejectedValueOnce(
      new SepError('Anchor internal error', 'INTERNAL_ERROR', 500, 'upstream-fail')
    );

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.code).toBe('UPSTREAM_ERROR');
    expect(data.message).toBe('Upstream anchor returned an error');
  });

  it('never leaks or logs the JWT in logs', async () => {
    getSep24TxSpy.mockResolvedValueOnce({
      id: 'txn-12345',
      status: 'pending_anchor',
    } as any);

    const logCalls: any[] = [];
    const originalWithRequestLogger = loggerModule.withRequestLogger;
    vi.spyOn(loggerModule, 'withRequestLogger').mockImplementation(async (req, scope, handler) => {
      const dummyLogger = {
        info: vi.fn((obj) => logCalls.push(obj)),
        warn: vi.fn((obj) => logCalls.push(obj)),
        error: vi.fn((obj) => logCalls.push(obj)),
        debug: vi.fn((obj) => logCalls.push(obj)),
      };
      return handler(dummyLogger as any);
    });

    await POST(makeRequest(VALID_BODY));

    const stringifiedLogs = JSON.stringify(logCalls);
    expect(stringifiedLogs).not.toContain(JWT);
  });
});
