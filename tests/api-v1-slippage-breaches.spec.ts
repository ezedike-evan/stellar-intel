import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as listGET } from '@/app/api/v1/slippage-breaches/route';
import { GET as detailGET } from '@/app/api/v1/slippage-breaches/[intentHash]/route';
import { ANCHORS } from '@/constants/anchors';
import {
  InMemorySlippageBreachStore,
  _setSlippageBreachStore,
  type SlippageBreachStore,
} from '@/lib/reputation/slippage-breaches';
import { canonicalEvidenceJson } from '@/lib/reputation/slippage-evidence';
import type { SlippageBreach, SlippageEvidence } from '@/types/reputation';

vi.mock('@/lib/api/rate-limit', () => ({
  getClientIp: () => '127.0.0.1',
  checkRateLimit: async () => ({
    allowed: true,
    remaining: 59,
    resetAt: Date.now() + 60_000,
    retryAfter: 0,
  }),
}));

const validAnchor = ANCHORS[0]!.id;
const otherAnchor = ANCHORS.length > 1 ? ANCHORS[1]!.id : 'mykobo';

const HASH_1 = 'a'.repeat(64);
const HASH_2 = 'b'.repeat(64);
const HASH_3 = 'c'.repeat(64);

function createEvidence(
  intentHash: string,
  overrides: Partial<SlippageEvidence> = {}
): SlippageEvidence {
  return {
    v: 1,
    networkPassphrase: 'Test SDF Network ; September 2015',
    intentHash,
    anchorId: validAnchor,
    corridor: 'usdc-ngn',
    signerAccount: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    minReceive: '1000.00',
    anchorReported: {
      anchorTransactionId: 'tx-123',
      amountOut: '950.00',
      reportedBy: 'sender',
    },
    shortfall: '50.00',
    shortfallBps: 500,
    onChain: null,
    detectedAt: '2026-10-25T12:00:00.000Z',
    ...overrides,
  };
}

function createBreach(intentHash: string, overrides: Partial<SlippageBreach> = {}): SlippageBreach {
  const evidence = createEvidence(intentHash, overrides.evidence);
  const canonical = canonicalEvidenceJson(evidence);
  const evidenceHash = createHash('sha256').update(canonical).digest('hex');
  return {
    intentHash,
    anchorId: validAnchor,
    corridor: 'usdc-ngn',
    signerAccount: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    minReceive: '1000.00',
    amountOut: '950.00',
    shortfall: '50.00',
    shortfallBps: 500,
    stellarTransactionId: 'stellar-tx-abc',
    anchorTransactionId: 'tx-123',
    status: 'detected',
    rejectionReason: null,
    evidence,
    evidenceHash,
    detectedAt: '2026-10-25T12:00:00.000Z',
    verifiedAt: null,
    ...overrides,
  };
}

function callList(query = '') {
  return listGET(new Request(`http://localhost/api/v1/slippage-breaches${query}`) as never);
}

function callDetail(intentHash: string) {
  return detailGET(
    new Request(`http://localhost/api/v1/slippage-breaches/${intentHash}`) as never,
    {
      params: Promise.resolve({ intentHash }),
    }
  );
}

describe('Slippage Breaches API (Issue #2106)', () => {
  let store: InMemorySlippageBreachStore;

  beforeEach(() => {
    store = new InMemorySlippageBreachStore();
    _setSlippageBreachStore(store);
  });

  afterEach(() => {
    _setSlippageBreachStore(null);
  });

  describe('GET /api/v1/slippage-breaches (List)', () => {
    it('returns empty list when no breaches recorded with 60s cache control', async () => {
      const res = await callList();
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('public, max-age=60');
      expect(res.headers.get('x-ratelimit-limit')).toBe('60');

      const body = await res.json();
      expect(body).toEqual({ breaches: [] });
    });

    it('returns breaches ordered newest detectedAt first', async () => {
      const b1 = createBreach(HASH_1, { detectedAt: '2026-10-20T10:00:00.000Z' });
      const b2 = createBreach(HASH_2, { detectedAt: '2026-10-22T10:00:00.000Z' });
      const b3 = createBreach(HASH_3, { detectedAt: '2026-10-21T10:00:00.000Z' });

      await store.create(b1);
      await store.create(b2);
      await store.create(b3);

      const res = await callList();
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.breaches).toHaveLength(3);
      expect(body.breaches[0].intentHash).toBe(HASH_2);
      expect(body.breaches[1].intentHash).toBe(HASH_3);
      expect(body.breaches[2].intentHash).toBe(HASH_1);
    });

    it('strictly excludes signerAccount, recipient, and evidence from list items', async () => {
      const raw = createBreach(HASH_1) as unknown as Record<string, unknown>;
      raw['recipient'] = 'BANK_ACCOUNT_SECRET_12345';
      await store.create(raw as unknown as SlippageBreach);

      const res = await callList();
      const body = await res.json();
      const item = body.breaches[0];

      expect(item).toBeDefined();
      expect(item.intentHash).toBe(HASH_1);
      expect(item.anchorId).toBe(validAnchor);
      expect(item.shortfall).toBe('50.00');

      // Privacy verification:
      expect(item).not.toHaveProperty('signerAccount');
      expect(item).not.toHaveProperty('recipient');
      expect(item).not.toHaveProperty('evidence');
    });

    it('filters by anchorId', async () => {
      await store.create(createBreach(HASH_1, { anchorId: validAnchor }));
      await store.create(createBreach(HASH_2, { anchorId: otherAnchor }));

      const res = await callList(`?anchorId=${validAnchor}`);
      const body = await res.json();

      expect(body.breaches).toHaveLength(1);
      expect(body.breaches[0].anchorId).toBe(validAnchor);
      expect(body.breaches[0].intentHash).toBe(HASH_1);
    });

    it('filters by status', async () => {
      await store.create(createBreach(HASH_1, { status: 'detected' }));
      await store.create(
        createBreach(HASH_2, { status: 'verified', verifiedAt: '2026-10-26T12:00:00.000Z' })
      );

      const res = await callList('?status=verified');
      const body = await res.json();

      expect(body.breaches).toHaveLength(1);
      expect(body.breaches[0].status).toBe('verified');
      expect(body.breaches[0].intentHash).toBe(HASH_2);
    });

    it('supports custom limit parameter', async () => {
      await store.create(createBreach(HASH_1, { detectedAt: '2026-10-20T10:00:00.000Z' }));
      await store.create(createBreach(HASH_2, { detectedAt: '2026-10-22T10:00:00.000Z' }));
      await store.create(createBreach(HASH_3, { detectedAt: '2026-10-21T10:00:00.000Z' }));

      const res = await callList('?limit=2');
      const body = await res.json();

      expect(body.breaches).toHaveLength(2);
      expect(body.breaches[0].intentHash).toBe(HASH_2);
      expect(body.breaches[1].intentHash).toBe(HASH_3);
    });

    it('returns 400 validation_error on unknown anchorId', async () => {
      const res = await callList('?anchorId=nonexistent-anchor');
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error.code).toBe('validation_error');
      expect(body.error.message).toContain('Unknown anchor');
    });

    it('returns 400 validation_error on invalid status', async () => {
      const res = await callList('?status=pending');
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error.code).toBe('validation_error');
      expect(body.error.message).toContain('Invalid status');
    });

    it('returns 400 validation_error on invalid limit', async () => {
      for (const invalid of ['0', '-5', '501', 'abc', '1.5']) {
        const res = await callList(`?limit=${invalid}`);
        expect(res.status).toBe(400);

        const body = await res.json();
        expect(body.error.code).toBe('validation_error');
        expect(body.error.message).toBe('limit must be an integer between 1 and 500');
      }
    });

    it('returns 503 store_unavailable when breach store throws', async () => {
      const failingStore: SlippageBreachStore = {
        create: async () => false,
        get: async () => {
          throw new Error('Database connection failed');
        },
        list: async () => {
          throw new Error('Database connection failed');
        },
        resolveVerification: async () => null,
      };
      _setSlippageBreachStore(failingStore);

      const res = await callList();
      expect(res.status).toBe(503);

      const body = await res.json();
      expect(body.error.code).toBe('store_unavailable');
    });
  });

  describe('GET /api/v1/slippage-breaches/[intentHash] (Detail)', () => {
    it('returns 200 with full evidence and canonical evidence string', async () => {
      const breach = createBreach(HASH_1);
      await store.create(breach);

      const res = await callDetail(HASH_1);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('public, max-age=300');
      expect(res.headers.get('x-ratelimit-limit')).toBe('60');

      const body = await res.json();
      expect(body.intentHash).toBe(HASH_1);
      expect(body.evidence).toEqual(breach.evidence);
      expect(typeof body.canonicalEvidence).toBe('string');

      // Cryptographic verification: recomputing SHA-256 of canonicalEvidence matches evidenceHash
      const recomputedHash = createHash('sha256').update(body.canonicalEvidence).digest('hex');
      expect(recomputedHash).toBe(body.evidenceHash);
    });

    it('returns 400 validation_error on malformed intentHash', async () => {
      const malformedHashes = [
        'short-hash',
        'Z'.repeat(64), // uppercase non-hex
        'A'.repeat(64), // uppercase hex (must be lowercase)
        'a'.repeat(63), // 63 chars
        'a'.repeat(65), // 65 chars
        'g'.repeat(64), // non-hex
      ];

      for (const hash of malformedHashes) {
        const res = await callDetail(hash);
        expect(res.status).toBe(400);

        const body = await res.json();
        expect(body.error.code).toBe('validation_error');
        expect(body.error.message).toBe('intentHash must be a lowercase hex SHA-256 (64 chars)');
      }
    });

    it('returns 404 not_found on unknown intentHash', async () => {
      const res = await callDetail(HASH_2);
      expect(res.status).toBe(404);

      const body = await res.json();
      expect(body.error.code).toBe('not_found');
      expect(body.error.message).toContain(HASH_2);
    });

    it('returns 503 store_unavailable when store throws', async () => {
      const failingStore: SlippageBreachStore = {
        create: async () => false,
        get: async () => {
          throw new Error('Database connection failed');
        },
        list: async () => {
          throw new Error('Database connection failed');
        },
        resolveVerification: async () => null,
      };
      _setSlippageBreachStore(failingStore);

      const res = await callDetail(HASH_1);
      expect(res.status).toBe(503);

      const body = await res.json();
      expect(body.error.code).toBe('store_unavailable');
    });
  });
});
