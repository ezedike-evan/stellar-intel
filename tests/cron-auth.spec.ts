import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { checkCronAuth } from '@/lib/api/cron-auth';

afterEach(() => {
  vi.unstubAllEnvs();
});

function req(authorization?: string): NextRequest {
  return new NextRequest('http://localhost/api/publisher/tick', {
    headers: authorization ? { authorization } : {},
  });
}

describe('checkCronAuth', () => {
  it('fails CLOSED with 500 when CRON_SECRET is unset (was fail-open)', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const res = checkCronAuth(req('Bearer undefined'));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(500);
    // The old inline check authenticated `Bearer undefined` when the secret was
    // unset; it must not now.
  });

  it('rejects a wrong bearer token with 401', () => {
    vi.stubEnv('CRON_SECRET', 'right-secret');
    const res = checkCronAuth(req('Bearer wrong-secret'));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it('rejects a missing Authorization header with 401', () => {
    vi.stubEnv('CRON_SECRET', 'right-secret');
    const res = checkCronAuth(req());
    expect(res!.status).toBe(401);
  });

  it('accepts the correct bearer token (returns null)', () => {
    vi.stubEnv('CRON_SECRET', 'right-secret');
    expect(checkCronAuth(req('Bearer right-secret'))).toBeNull();
  });
});
