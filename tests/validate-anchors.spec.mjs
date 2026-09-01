import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  nextHealth,
  applyProbes,
  formatLedgerDigest,
  parseAnchors,
  parseCurrencies,
  probeDomain,
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
      { id: 'moneygram', domain: 'stellar.moneygram.com', requiresSep24: false },
      { id: 'cowrie', domain: 'cowrie.exchange', requiresSep24: false },
    ]);
  });

  it('uses the corrected live service hosts in the production registry', () => {
    const source = readFileSync(join(process.cwd(), 'constants/anchors.ts'), 'utf8');
    const domains = Object.fromEntries(
      parseAnchors(source)
        .filter(({ id }) => ['cowrie', 'mykobo', 'zeam'].includes(id))
        .map(({ id, domain }) => [id, domain])
    );

    expect(domains).toEqual({
      cowrie: 'api.cowrie.exchange',
      mykobo: 'mykobo.co',
      zeam: 'zeam.money',
    });
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
      {
        id: 'cowrie',
        domain: 'cowrie.exchange',
        requiresSep24: false,
        assetCode: 'USDC',
        assetIssuerRef: 'USDC_ISSUER',
      },
      {
        id: 'ntokens',
        domain: 'ntokens.com',
        requiresSep24: false,
        assetCode: 'BRL',
        assetIssuer: 'GDVKY2GU2DRXWTBEYJJWSFXIGBZV6AZNBVVSUHEPZI54LIS6BA7DVVSP',
      },
    ]);
  });

  // #1121 — cowrie (seps: ['sep6', 'sep10']) was flagged DEGRADED for lacking
  // TRANSFER_SERVER_SEP0024, a rail it never registers. requiresSep24 must
  // only be true for an anchor whose own `seps` lists 'sep24'.
  it('sets requiresSep24 only for an anchor whose seps includes sep24', () => {
    const source = `
      export const ANCHORS: Anchor[] = [
        {
          id: 'cowrie',
          homeDomain: 'cowrie.exchange',
          seps: ['sep6', 'sep10'],
        },
        {
          id: 'ngnc',
          homeDomain: 'ngnc.online',
          seps: ['sep24'],
        },
      ];
    `;
    const anchors = parseAnchors(source);
    expect(anchors.find((a) => a.id === 'cowrie')?.requiresSep24).toBe(false);
    expect(anchors.find((a) => a.id === 'ngnc')?.requiresSep24).toBe(true);
  });
});

describe('validate-anchors: probeDomain SEP-24 requirement (#1121)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockToml(body, status = 200) {
    global.fetch = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(body),
    });
  }

  it('passes an anchor with no SEP-24 line when it does not require SEP-24', async () => {
    mockToml('SIGNING_KEY = "G..."');
    const result = await probeDomain('cowrie.exchange', false);
    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
  });

  it('fails an anchor missing SEP-24 when it does require it', async () => {
    mockToml('SIGNING_KEY = "G..."');
    const result = await probeDomain('ngnc.online', true);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('missing TRANSFER_SERVER_SEP0024 (SEP-24)');
  });

  it('passes when SEP-24 is present, regardless of the requirement', async () => {
    mockToml('TRANSFER_SERVER_SEP0024 = "https://example.com/sep24"');
    expect((await probeDomain('example.com', true)).ok).toBe(true);
    expect((await probeDomain('example.com', false)).ok).toBe(true);
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

describe('validate-anchors: ledger digest for the nightly alert (#1015)', () => {
  const ledger = {
    thresholdNights: 3,
    updatedAt: NOW,
    anchors: {
      moneygram: {
        consecutiveFailures: 0,
        degraded: false,
        lastCheckedAt: NOW,
        lastStatus: 'ok',
        lastError: null,
      },
      mykobo: {
        consecutiveFailures: 1,
        degraded: false,
        lastCheckedAt: NOW,
        lastStatus: 'fail',
        lastError: 'TypeError:ENOTFOUND',
      },
      zeam: {
        consecutiveFailures: 3,
        degraded: true,
        lastCheckedAt: NOW,
        lastStatus: 'fail',
        lastError: 'HTTP 404',
      },
    },
  };

  it('states status, streak and degraded flag for every anchor', () => {
    const lines = formatLedgerDigest(ledger).split('\n');

    expect(lines[0]).toBe('moneygram | ok   | fails 0 | degraded no');
    expect(lines[1]).toBe('mykobo    | fail | fails 1 | degraded no — TypeError:ENOTFOUND');
    expect(lines[2]).toBe('zeam      | fail | fails 3 | degraded yes — HTTP 404');
  });

  it('counts the failing and degraded anchors against the threshold', () => {
    const digest = formatLedgerDigest(ledger);

    expect(digest).toContain('2 of 3 anchor(s) failing, 1 degraded (threshold 3 night(s)).');
    // The bug this replaces: a down anchor rendering as something a reader
    // scanning the alert could take for an all-clear.
    expect(digest).not.toMatch(/mykobo\s+\|\s+ok/);
  });

  it('says so plainly when nothing was probed', () => {
    expect(formatLedgerDigest({ thresholdNights: 3, anchors: {} })).toBe(
      'ledger is empty — no anchors were probed'
    );
    expect(formatLedgerDigest(undefined)).toBe('ledger is empty — no anchors were probed');
  });
});

describe('nightly alert wiring (#1015)', () => {
  const workflow = readFileSync(join(process.cwd(), '.github/workflows/nightly.yml'), 'utf8');

  it('carries the digest from the probing job into the alert body', () => {
    expect(workflow).toContain('node scripts/validate-anchors.mjs --github-output');
    expect(workflow).toContain('ledger: ${{ steps.probe.outputs.ledger }}');
    expect(workflow).toContain('LEDGER_DIGEST: ${{ needs.anchor-health-ledger.outputs.ledger }}');
    // A failure in the ledger job itself leaves the output empty, so the block
    // needs the same fallback shape the TOML block already has.
    expect(workflow).toContain(
      "process.env.LEDGER_DIGEST || '(anchor-health-ledger did not report)'"
    );
  });

  it('labels the home-domain probe for what it measures', () => {
    expect(workflow).toContain('home-domain TOML resolution');
    expect(workflow).not.toContain('Anchor summary');
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
