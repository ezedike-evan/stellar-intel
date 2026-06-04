import { describe, expect, it } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { getCorrelationId, withRequestLogger } from '@/lib/logger';

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/test', { method: 'POST', headers });
}

describe('withRequestLogger', () => {
  it('echoes a provided x-correlation-id back on the response', async () => {
    const res = await withRequestLogger(makeRequest({ 'x-correlation-id': 'abc-123' }), 'api.test', async () =>
      NextResponse.json({ ok: true })
    );

    expect(res.headers.get('x-correlation-id')).toBe('abc-123');
  });

  it('generates a correlation id when the request omits one', async () => {
    const res = await withRequestLogger(makeRequest(), 'api.test', async () =>
      NextResponse.json({ ok: true })
    );

    const id = res.headers.get('x-correlation-id');
    expect(id).toBeTruthy();
    expect(id?.length).toBeGreaterThan(0);
  });

  it('exposes the correlation id to the handler via AsyncLocalStorage', async () => {
    let seen: string | undefined;
    await withRequestLogger(makeRequest({ 'x-correlation-id': 'ctx-9' }), 'api.test', async () => {
      seen = getCorrelationId();
      return NextResponse.json({ ok: true });
    });

    expect(seen).toBe('ctx-9');
  });

  it('logs and returns a 500 (with correlation id) when the handler throws', async () => {
    const res = await withRequestLogger(makeRequest({ 'x-correlation-id': 'boom-1' }), 'api.test', async () => {
      throw new Error('handler exploded');
    });

    expect(res.status).toBe(500);
    expect(res.headers.get('x-correlation-id')).toBe('boom-1');
    await expect(res.json()).resolves.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('does not leak the correlation id outside the request scope', async () => {
    await withRequestLogger(makeRequest({ 'x-correlation-id': 'scoped' }), 'api.test', async () =>
      NextResponse.json({ ok: true })
    );

    expect(getCorrelationId()).toBeUndefined();
  });
});
