import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Replace the request logger with one that records everything it is asked to
// log, so the test can look at exactly what the route would have written.
const logged = vi.hoisted(() => ({ lines: [] as string[] }));

vi.mock('@/lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/logger')>();
  const record = (...args: unknown[]) => {
    logged.lines.push(JSON.stringify(args));
  };
  const recorder = {
    trace: record,
    debug: record,
    info: record,
    warn: record,
    error: record,
    fatal: record,
  };
  return {
    ...actual,
    withRequestLogger: async (
      _request: NextRequest,
      _name: string,
      fn: (logger: typeof recorder) => Promise<unknown>
    ) => fn(recorder),
  };
});

import { POST } from '@/app/api/intent/offramp/route';
import { clearRateLimitStore } from '@/lib/api/rate-limit';
import { clearIdempotencyStore } from '@/lib/api/idempotency';

const SENDER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const RECIPIENT = 'RECIPIENT-BANK-ACCOUNT-0000987654';

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/intent/offramp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.90' },
    body: JSON.stringify(body),
  });
}

const intent = {
  type: 'offramp',
  sourceAsset: 'USDC',
  destinationAsset: 'NGN',
  amount: '100',
  sender: SENDER,
  recipient: RECIPIENT,
};

beforeEach(() => {
  logged.lines.length = 0;
  clearRateLimitStore();
  clearIdempotencyStore();
});

describe('POST /api/intent/offramp — no personal data in logs (#1366)', () => {
  it('does not log the sender or recipient when routing fails with NO_ROUTE', async () => {
    const res = await POST(post({ ...intent, destinationAsset: 'EUR' }));
    expect(res.status).toBe(400);

    const all = logged.lines.join('\n');
    expect(all).toContain('no_route');
    expect(all).not.toContain(RECIPIENT);
    expect(all).not.toContain(SENDER);
  });

  it('still logs which corridor failed, and why', async () => {
    await POST(post({ ...intent, destinationAsset: 'EUR' }));

    const line = logged.lines.find((l) => l.includes('no_route'));
    expect(line).toBeDefined();
    expect(line).toContain('"sourceAsset":"USDC"');
    expect(line).toContain('"destinationAsset":"EUR"');
    expect(line).toContain('"code":"NO_ROUTE"');
  });

  it('does not log the submitted values when validation fails', async () => {
    const res = await POST(post({ ...intent, amount: 'not-a-number', recipient: RECIPIENT }));
    expect(res.status).toBe(400);

    const all = logged.lines.join('\n');
    expect(all).toContain('validation_failed');
    expect(all).not.toContain('not-a-number');
    expect(all).not.toContain(RECIPIENT);
  });
});
