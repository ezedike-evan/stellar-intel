import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { clearRateLimitStore } from '@/lib/api/rate-limit';
import { POST as disputesPOST } from '@/app/api/admin/disputes/route';
import { GET as failuresGET } from '@/app/api/webhooks/failures/route';

const ADMIN_SECRET = 'correct-admin-key-super-secret-xyz';

function postDisputes(key: string | null, ip: string): NextRequest {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-forwarded-for': ip,
  };
  if (key !== null) {
    headers['x-admin-key'] = key;
  }
  return new NextRequest('http://localhost/api/admin/disputes', {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: 'disp-1', action: 'accept' }),
  });
}

function getFailures(key: string | null, ip: string): NextRequest {
  const headers: Record<string, string> = {
    'x-forwarded-for': ip,
  };
  if (key !== null) {
    headers['x-admin-key'] = key;
  }
  return new NextRequest('http://localhost/api/webhooks/failures', {
    method: 'GET',
    headers,
  });
}

describe('Admin failed authentication throttling (#2198)', () => {
  beforeEach(() => {
    clearRateLimitStore();
    vi.stubEnv('ADMIN_SECRET_KEY', ADMIN_SECRET);
  });

  afterEach(() => {
    clearRateLimitStore();
    vi.unstubAllEnvs();
  });

  it('throttles after 10 failed admin attempts on POST /api/admin/disputes', async () => {
    const ip = '198.51.100.1';

    // First 10 wrong-key attempts should answer 401
    for (let i = 0; i < 10; i++) {
      const res = await disputesPOST(postDisputes('wrong-key', ip));
      expect(res.status).toBe(401);
    }

    // 11th wrong-key attempt should answer 429 with Retry-After
    const resThrottled = await disputesPOST(postDisputes('wrong-key', ip));
    expect(resThrottled.status).toBe(429);
    expect(resThrottled.headers.get('retry-after')).toBeTruthy();

    // A correct-key request from the same IP still succeeds because successful auth is not counted
    const resSuccess = await disputesPOST(postDisputes(ADMIN_SECRET, ip));
    // The dispute id may not exist in store, but it passes authentication (non-401/non-429)
    expect(resSuccess.status).not.toBe(401);
    expect(resSuccess.status).not.toBe(429);

    // A wrong key from a different IP is still 401 (independent rate-limit bucket)
    const resOtherIp = await disputesPOST(postDisputes('wrong-key', '198.51.100.2'));
    expect(resOtherIp.status).toBe(401);
  });

  it('throttles after 10 failed admin attempts on GET /api/webhooks/failures', async () => {
    const ip = '198.51.100.5';

    // First 10 wrong-key attempts answer 403
    for (let i = 0; i < 10; i++) {
      const res = await failuresGET(getFailures('wrong-key', ip));
      expect(res.status).toBe(403);
    }

    // 11th wrong-key attempt answers 429
    const resThrottled = await failuresGET(getFailures('wrong-key', ip));
    expect(resThrottled.status).toBe(429);
    expect(resThrottled.headers.get('retry-after')).toBeTruthy();
  });
});
