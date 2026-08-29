import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { expandIntent, type GenericIntent } from '@/lib/intent/generic';
import { POST } from '@/app/api/intent/route';
import { clearRateLimitStore } from '@/lib/api/rate-limit';

const OFFRAMP = {
  sourceAsset: 'USDC',
  destinationAsset: 'NGN',
  amount: '100',
  sender: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  recipient: 'NGN-BANK-ACCOUNT-123',
};

function postIntent(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => clearRateLimitStore());

describe('expandIntent (#818)', () => {
  it('collapses a single off-ramp to one immediate leg', () => {
    const legs = expandIntent({ type: 'offramp', ...OFFRAMP });
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({
      type: 'offramp',
      amount: '100',
      sequence: 0,
      executeAfterSeconds: 0,
    });
  });

  it('expands a recurring intent into one leg per occurrence, spaced by interval', () => {
    const intent: GenericIntent = {
      type: 'recurring',
      interval: 'daily',
      occurrences: 3,
      template: OFFRAMP,
    };
    const legs = expandIntent(intent);
    expect(legs).toHaveLength(3);
    expect(legs.map((l) => l.sequence)).toEqual([0, 1, 2]);
    expect(legs.map((l) => l.executeAfterSeconds)).toEqual([0, 86_400, 172_800]);
    expect(legs.every((l) => l.type === 'offramp' && l.amount === '100')).toBe(true);
  });
});

describe('POST /api/intent (#818)', () => {
  it('returns the collapsed plan for a single off-ramp', async () => {
    const res = await POST(postIntent({ type: 'offramp', ...OFFRAMP }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { type: string; count: number; intents: unknown[] };
    expect(data.type).toBe('offramp');
    expect(data.count).toBe(1);
    expect(data.intents).toHaveLength(1);
  });

  it('returns one leg per occurrence for a recurring intent', async () => {
    const res = await POST(
      postIntent({ type: 'recurring', interval: 'weekly', occurrences: 4, template: OFFRAMP })
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      count: number;
      intents: { executeAfterSeconds: number }[];
    };
    expect(data.count).toBe(4);
    expect(data.intents[3]?.executeAfterSeconds).toBe(3 * 604_800);
  });

  it('rejects an unknown intent type with a validation error', async () => {
    const res = await POST(postIntent({ type: 'yield', ...OFFRAMP }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});
