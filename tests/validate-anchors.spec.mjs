import { describe, it, expect, vi } from 'vitest';
import {
  nextHealth,
  applyProbes,
  parseAnchors,
  parseCurrencies,
  resolveExpectedIssuer,
  validateIssuer,
} from '../scripts/validate-anchors.mjs';

const OK = { ok: true, error: null };
const FAIL = { ok: false, error: 'HTTP 521' };
const NOW = '2026-06-26T04:17:00.000Z';

describe('validate-anchors: failure streak tracking', () => {
  it('increments the streak on failure and resets it on success', () => {
    const after1 = nextHealth(undefined, FAIL, 3, NOW);
    expect(after1.consecutiveFailures).toBe(1);
    expect(after1.degraded).toBe(false);
    expect(after1.lastStatus).toBe('fail');
    expect(after1.lastError).toBe('HTTP 521');

    const after2 = nextHealth(after1, FAIL, 3, NOW);
    expect(after2.consecutiveFailures).toBe(2);
    expect(after2.degraded).toBe(false);

    const recovered = nextHealth(after2, OK, 3, NOW);
    expect(recovered.consecutiveFailures).toBe(0);
    expect(recovered.degraded).toBe(false);
    expect(recovered.lastStatus).toBe('ok');
    expect(recovered.lastError).toBe(null);
  });

  it('flags an anchor degraded after N consecutive failures and clears on recovery', () => {
    let health = nextHealth(undefined, FAIL, 3, NOW);
    health = nextHealth(health, FAIL, 3, NOW);
    expect(health.degraded).toBe(false); // 2 nights — still below threshold

    health = nextHealth(health, FAIL, 3, NOW); // 3rd night hits the threshold
    expect(health.consecutiveFailures).toBe(3);
    expect(health.degraded).toBe(true);

    health = nextHealth(health, OK, 3, NOW); // a single good night clears the flag
    expect(health.degraded).toBe(false);
    expect(health.consecutiveFailures).toBe(0);
  });

  it('respects a custom threshold', () => {
    const oneNight = nextHealth(undefined, FAIL, 1, NOW);
    expect(oneNight.degraded).toBe(true);
  });

  it('rebuilds the ledger from a run, pruning anchors no longer probed', () => {
    const prev = {
      thresholdNights: 3,
      updatedAt: null,
      anchors: {
        moneygram: {
          consecutiveFailures: 2,
          degraded: false,
          lastCheckedAt: null,
          lastStatus: 'fail',
          lastError: 'HTTP 521',
        },
        retired: {
          consecutiveFailures: 0,
          degraded: false,
          lastCheckedAt: null,
          lastStatus: 'ok',
          lastError: null,
        },
      },
    };

    const ledger = applyProbes(prev, { moneygram: FAIL, cowrie: OK }, { threshold: 3, now: NOW });

    expect(ledger.thresholdNights).toBe(3);
    expect(ledger.updatedAt).toBe(NOW);
    expect(ledger.anchors.moneygram.degraded).toBe(true); // 2 + 1 == threshold
    expect(ledger.anchors.cowrie.consecutiveFailures).toBe(0);
    expect(ledger.anchors.retired).toBeUndefined(); // pruned: not probed this run
  });
});

describe('validate-anchors: parseAnchors', () => {
  it('parses id + probe domain (serviceDomain wins over homeDomain)', () => {
    const source = `
      export const ANCHORS: Anchor[] = [
        {
          id: 'moneygram',
          homeDomain: 'mgusd.moneygram.com',
          serviceDomain: 'stellar.moneygram.com',
        },
        {
          id: 'cowrie',
          homeDomain: 'cowrie.exchange',
        },
      ];
      export const CORRIDORS = [{ id: 'usdc-ngn', homeDomain: 'should-not-match' }];
    `;
    expect(parseAnchors(source)).toEqual([
      { id: 'moneygram', domain: 'stellar.moneygram.com' },
      { id: 'cowrie', domain: 'cowrie.exchange' },
    ]);
  });

  it('captures assetCode and a literal vs referenced assetIssuer', () => {
    const source = `
      export const ANCHORS: Anchor[] = [
        {
          id: 'cowrie',
          homeDomain: 'cowrie.exchange',
          assetCode: 'USDC',
          assetIssuer: USDC_ISSUER,
        },
        {
          id: 'ntokens',
          homeDomain: 'ntokens.com',
          assetCode: 'BRL',
          assetIssuer: 'GDVKY2GU2DRXWTBEYJJWSFXIGBZV6AZNBVVSUHEPZI54LIS6BA7DVVSP',
        },
      ];
    `;
    expect(parseAnchors(source)).toEqual([
      { id: 'cowrie', domain: 'cowrie.exchange', assetCode: 'USDC', assetIssuerRef: 'USDC_ISSUER' },
      {
        id: 'ntokens',
        domain: 'ntokens.com',
        assetCode: 'BRL',
        assetIssuer: 'GDVKY2GU2DRXWTBEYJJWSFXIGBZV6AZNBVVSUHEPZI54LIS6BA7DVVSP',
      },
    ]);
  });
});

describe('validate-anchors: asset-issuer validation (#489)', () => {
  const CANONICAL = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
  const LOOKALIKE = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

  it('parses [[CURRENCIES]] code and issuer, defaulting a missing issuer to null', () => {
    const toml = `
      ANCHOR_QUOTE_SERVER = "https://example.com/q"

      [[CURRENCIES]]
      code = "USDC"
      issuer = "${CANONICAL}"

      [[CURRENCIES]]
      code = "EURC"

      [DOCUMENTATION]
      ORG_NAME = "Example"
    `;
    expect(parseCurrencies(toml)).toEqual([
      { code: 'USDC', issuer: CANONICAL },
      { code: 'EURC', issuer: null },
    ]);
  });

  it('resolveExpectedIssuer prefers a literal, else resolves USDC_ISSUER from env', () => {
    expect(resolveExpectedIssuer({ assetIssuer: LOOKALIKE })).toBe(LOOKALIKE);
    expect(
      resolveExpectedIssuer(
        { assetIssuerRef: 'USDC_ISSUER' },
        { NEXT_PUBLIC_USDC_ISSUER: CANONICAL }
      )
    ).toBe(CANONICAL);
    expect(resolveExpectedIssuer({ assetIssuerRef: 'USDC_ISSUER' }, {})).toBeNull();
    expect(resolveExpectedIssuer({}, {})).toBeNull();
  });

  it('flags a look-alike issuer as a mismatch', () => {
    const result = validateIssuer({ assetCode: 'USDC', expectedIssuer: CANONICAL }, [
      { code: 'USDC', issuer: LOOKALIKE },
    ]);
    expect(result).toEqual({ status: 'mismatch', advertisedIssuer: LOOKALIKE });
  });

  it('passes the canonical issuer and reports missing / unverifiable cases', () => {
    expect(
      validateIssuer({ assetCode: 'USDC', expectedIssuer: CANONICAL }, [
        { code: 'USDC', issuer: CANONICAL },
      ])
    ).toEqual({ status: 'match', advertisedIssuer: CANONICAL });

    expect(
      validateIssuer({ assetCode: 'USDC', expectedIssuer: CANONICAL }, [
        { code: 'USDC', issuer: null },
      ])
    ).toEqual({ status: 'missing', advertisedIssuer: null });

    expect(
      validateIssuer({ assetCode: 'USDC', expectedIssuer: null }, [
        { code: 'USDC', issuer: CANONICAL },
      ])
    ).toEqual({ status: 'unverifiable', advertisedIssuer: CANONICAL });
  });
});

// The runtime selectors read the committed health ledger, so mock it to prove a
// degraded anchor is hidden from corridor selection while healthy peers remain.
vi.mock('@/constants/anchor-health.json', () => ({
  default: {
    thresholdNights: 3,
    updatedAt: '2026-06-26T04:17:00.000Z',
    anchors: {
      moneygram: {
        consecutiveFailures: 3,
        degraded: true,
        lastCheckedAt: '2026-06-26T04:17:00.000Z',
        lastStatus: 'fail',
        lastError: 'HTTP 521',
      },
      cowrie: {
        consecutiveFailures: 0,
        degraded: false,
        lastCheckedAt: '2026-06-26T04:17:00.000Z',
        lastStatus: 'ok',
        lastError: null,
      },
      anclap: {
        consecutiveFailures: 0,
        degraded: false,
        lastCheckedAt: '2026-06-26T04:17:00.000Z',
        lastStatus: 'ok',
        lastError: null,
      },
    },
  },
}));

describe('anchors selector: degraded anchors are hidden', () => {
  it('omits a degraded anchor from getAnchorsByCorridorId', async () => {
    const mod = await import('@/lib/stellar/anchors');

    expect(mod.isAnchorDegraded('moneygram')).toBe(true);
    expect(mod.getDegradedAnchorIds()).toEqual(['moneygram']);

    // usdc-ngn is served by moneygram (degraded) + cowrie (healthy) → only cowrie shows.
    const ngn = mod.getAnchorsByCorridorId('usdc-ngn').map((a) => a.id);
    expect(ngn).toContain('cowrie');
    expect(ngn).not.toContain('moneygram');

    // usdc-kes is served only by moneygram → degraded leaves it empty.
    expect(mod.getAnchorsByCorridorId('usdc-kes')).toEqual([]);
  });
});
