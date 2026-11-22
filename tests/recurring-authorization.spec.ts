import { describe, it, expect } from 'vitest';
import { hashStandingAuthorization } from '@/lib/recurring/authorization';
import type { StandingAuthorizationTerms } from '@/types/recurring';

describe('hashStandingAuthorization', () => {
  const terms: StandingAuthorizationTerms = {
    type: 'recurring-authorization',
    version: 1,
    sender: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    corridorId: 'usdc-ngn',
    sourceAsset: 'USDC',
    destinationAsset: 'NGN',
    amount: '100',
    perPeriodCap: '500',
    period: 'weekly',
    startDate: '2026-01-01T00:00:00.000Z',
    anchorAllowlist: ['cowrie', 'mykobo'],
    nonce: 'test-nonce-123',
  };

  it('hashes deterministically', async () => {
    const h1 = await hashStandingAuthorization(terms);
    const h2 = await hashStandingAuthorization(terms);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when terms change', async () => {
    const h1 = await hashStandingAuthorization(terms);
    const h2 = await hashStandingAuthorization({ ...terms, amount: '101' });
    expect(h1).not.toBe(h2);
  });
});
