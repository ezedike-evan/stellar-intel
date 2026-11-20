import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('graphql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('graphql')>();
  return { ...actual, execute: vi.fn().mockRejectedValue(new Error('secret driver detail')) };
});

import { POST } from '@/app/api/graphql/route';
import { clearRateLimitStore } from '@/lib/api/rate-limit';

beforeEach(() => {
  clearRateLimitStore();
});

describe('POST /api/graphql — unhandled errors (#1349)', () => {
  it('returns a generic 500 without the thrown message', async () => {
    const res = await POST(
      new NextRequest('http://localhost/api/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '{ anchors { id } }' }),
      })
    );
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('secret driver detail');
    expect(JSON.parse(text)).toEqual({
      data: null,
      errors: [{ message: 'Internal server error' }],
    });
  });
});
