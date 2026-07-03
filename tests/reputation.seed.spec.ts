import { describe, expect, it } from 'vitest';
import type { Anchor } from '@/types';
import { InMemoryReputationStore } from '@/lib/reputation/store';
import {
  BOOTSTRAP_SEED_PREFIX,
  buildBootstrapSeeds,
  isBootstrapRow,
  seedReputationStore,
} from '@/lib/reputation/seed';

const NOW = new Date('2026-06-30T00:00:00.000Z');

const TEST_ANCHORS: Anchor[] = [
  {
    id: 'alpha',
    name: 'Alpha Anchor',
    homeDomain: 'alpha.example',
    corridors: ['usdc-ngn', 'usdc-kes'],
    assetCode: 'USDC',
    assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  },
  {
    id: 'beta',
    name: 'Beta Anchor',
    homeDomain: 'beta.example',
    corridors: ['usdc-ghs'],
    assetCode: 'USDC',
    assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  },
];

describe('buildBootstrapSeeds', () => {
  it('produces one row per anchor×corridor', () => {
    const seeds = buildBootstrapSeeds(TEST_ANCHORS, NOW);
    expect(seeds).toHaveLength(3);
  });

  it('each row carries the correct anchorId and corridor', () => {
    const seeds = buildBootstrapSeeds(TEST_ANCHORS, NOW);
    expect(seeds.find((r) => r.anchorId === 'alpha' && r.corridor === 'usdc-ngn')).toBeDefined();
    expect(seeds.find((r) => r.anchorId === 'alpha' && r.corridor === 'usdc-kes')).toBeDefined();
    expect(seeds.find((r) => r.anchorId === 'beta' && r.corridor === 'usdc-ghs')).toBeDefined();
  });

  it('marks rows as bootstrap source via intentHash prefix', () => {
    const seeds = buildBootstrapSeeds(TEST_ANCHORS, NOW);
    for (const row of seeds) {
      expect(row.intentHash.startsWith(`${BOOTSTRAP_SEED_PREFIX}::`)).toBe(true);
    }
  });

  it('intentHash is deterministic for the same anchor×corridor', () => {
    const [a] = buildBootstrapSeeds(TEST_ANCHORS, NOW);
    const [b] = buildBootstrapSeeds(TEST_ANCHORS, new Date('2099-01-01T00:00:00.000Z'));
    expect(a!.intentHash).toBe(b!.intentHash);
  });

  it('sets outcome to completed and no delivery fields', () => {
    const seeds = buildBootstrapSeeds(TEST_ANCHORS, NOW);
    for (const row of seeds) {
      expect(row.outcome).toBe('completed');
      expect(row.deliveredAmount).toBeNull();
      expect(row.deliveredRate).toBeNull();
      expect(row.reconciledAt).toBeNull();
      expect(row.disputed).toBe(false);
    }
  });
});

describe('isBootstrapRow', () => {
  it('returns true for bootstrap intentHash', () => {
    const [seed] = buildBootstrapSeeds(TEST_ANCHORS, NOW);
    expect(isBootstrapRow(seed!)).toBe(true);
  });

  it('returns false for a real intentHash', () => {
    expect(isBootstrapRow({ intentHash: 'abc123def456' })).toBe(false);
  });
});

describe('seedReputationStore', () => {
  it('appends one row per anchor×corridor and returns the count', async () => {
    const store = new InMemoryReputationStore();
    const count = await seedReputationStore(store, TEST_ANCHORS, NOW);
    expect(count).toBe(3);
    const all = await store.query({});
    expect(all).toHaveLength(3);
    await store.close();
  });

  it('seeded anchors appear in per-anchor queries', async () => {
    const store = new InMemoryReputationStore();
    await seedReputationStore(store, TEST_ANCHORS, NOW);

    const alphaRows = await store.query({ anchorId: 'alpha' });
    expect(alphaRows).toHaveLength(2);

    const betaRows = await store.query({ anchorId: 'beta' });
    expect(betaRows).toHaveLength(1);
    await store.close();
  });

  it('is idempotent — re-seeding replaces, not duplicates', async () => {
    const store = new InMemoryReputationStore();
    await seedReputationStore(store, TEST_ANCHORS, NOW);
    await seedReputationStore(store, TEST_ANCHORS, new Date('2099-01-01T00:00:00.000Z'));
    const all = await store.query({});
    expect(all).toHaveLength(3);
    await store.close();
  });

  it('all seeded rows are identified as bootstrap', async () => {
    const store = new InMemoryReputationStore();
    await seedReputationStore(store, TEST_ANCHORS, NOW);
    const all = await store.query({});
    for (const row of all) {
      expect(isBootstrapRow(row)).toBe(true);
    }
    await store.close();
  });
});
