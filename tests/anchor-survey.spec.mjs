import { describe, it, expect } from 'vitest';
import { buildCensus } from '../scripts/anchor-survey.mjs';

const GENERATED_AT = '2026-09-27T00:00:00.000Z';

const REGISTRY = [
  { id: 'cowrie', homeDomain: 'cowrie.exchange', serviceDomain: 'api.cowrie.exchange' },
];

const RESULTS = [
  {
    domain: 'api.cowrie.exchange',
    reachable: true,
    sep6: true,
    sep24: false,
    sep31: false,
    sep38: false,
    sep10: true,
    withdrawAssets: ['USDC'],
    depositAssets: [],
    receiveAssets: [],
    sources: ['https://api.stellar.expert/explorer/public/directory?tag[]=anchor&limit=200'],
    checkedAt: GENERATED_AT,
  },
  {
    domain: 'healthonly.example',
    reachable: true,
    sep6: false,
    sep24: false,
    sep31: true,
    sep38: false,
    sep10: false,
    withdrawAssets: [],
    depositAssets: [],
    receiveAssets: ['USDC'],
    sources: ['https://api.stellar.expert/explorer/public/directory?tag[]=anchor&limit=200'],
    checkedAt: GENERATED_AT,
  },
  {
    domain: 'listed.example',
    reachable: true,
    sep6: false,
    sep24: false,
    sep31: false,
    sep38: false,
    sep10: false,
    withdrawAssets: [],
    depositAssets: [],
    receiveAssets: [],
    sources: ['https://api.stellar.expert/explorer/public/directory?tag[]=anchor&limit=200'],
    checkedAt: GENERATED_AT,
  },
  {
    domain: 'dead.example',
    reachable: false,
    reason: 'HTTP 404',
    checkedAt: GENERATED_AT,
  },
];

describe('anchor-survey: buildCensus', () => {
  it('produces one row per non-excluded result, only counting excluded ones', () => {
    const census = buildCensus(RESULTS, REGISTRY, GENERATED_AT);

    expect(census.generatedAt).toBe(GENERATED_AT);
    expect(census.rows).toHaveLength(3);
    expect(census.counts).toEqual({ routable: 1, healthOnly: 1, listed: 1, excluded: 1 });
  });

  it('sorts rows by tier then domain', () => {
    const census = buildCensus(RESULTS, REGISTRY, GENERATED_AT);
    expect(census.rows.map((r) => r.tier)).toEqual(['routable', 'health-only', 'listed']);
    expect(census.rows.map((r) => r.domain)).toEqual([
      'api.cowrie.exchange',
      'healthonly.example',
      'listed.example',
    ]);
  });

  it('matches registeredAnchorId on home or service domain', () => {
    const census = buildCensus(RESULTS, REGISTRY, GENERATED_AT);
    const cowrie = census.rows.find((r) => r.domain === 'api.cowrie.exchange');
    const healthOnly = census.rows.find((r) => r.domain === 'healthonly.example');

    expect(cowrie.registeredAnchorId).toBe('cowrie');
    expect(healthOnly.registeredAnchorId).toBeNull();
  });

  it('carries the seps and asset fields through for each row', () => {
    const census = buildCensus(RESULTS, REGISTRY, GENERATED_AT);
    const cowrie = census.rows.find((r) => r.domain === 'api.cowrie.exchange');

    expect(cowrie.seps).toEqual({
      sep6: true,
      sep24: false,
      sep31: false,
      sep38: false,
      sep10: true,
    });
    expect(cowrie.withdrawAssets).toEqual(['USDC']);
  });

  it('defaults missing asset/source fields to empty arrays', () => {
    const census = buildCensus(
      [{ domain: 'bare.example', reachable: true, sep6: true }],
      [],
      GENERATED_AT
    );
    const [row] = census.rows;
    expect(row.withdrawAssets).toEqual([]);
    expect(row.depositAssets).toEqual([]);
    expect(row.receiveAssets).toEqual([]);
    expect(row.sources).toEqual([]);
  });
});
