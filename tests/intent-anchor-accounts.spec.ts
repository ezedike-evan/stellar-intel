import { describe, it, expect, vi, afterEach } from 'vitest';
import { ANCHORS } from '@/constants';

// #941 — the intent API used to hardcode two destination accounts. Neither
// existed on mainnet (Horizon returned 404 for both), and one belonged to an
// anchor absent from the registry. These tests pin that routing is now driven
// by verified configuration, and that the absence of it fails closed.

async function load() {
  vi.resetModules();
  return import('@/lib/intent/anchor-accounts');
}

const VALID_KEY = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('routingTargetsForCorridor (#941)', () => {
  it('returns nothing when no accounts are configured', async () => {
    vi.stubEnv('ANCHOR_PAYMENT_ACCOUNTS', '');
    const { routingTargetsForCorridor } = await load();

    // Fails closed. The previous behaviour was to return a fabricated address.
    expect(routingTargetsForCorridor('usdc-ngn')).toEqual([]);
  });

  it('returns only anchors that both serve the corridor and have an account', async () => {
    // ntokens does not serve usdc-ngn, so configuring it must not create a route.
    vi.stubEnv(
      'ANCHOR_PAYMENT_ACCOUNTS',
      JSON.stringify({ cowrie: VALID_KEY, ntokens: VALID_KEY })
    );
    const { routingTargetsForCorridor } = await load();

    expect(routingTargetsForCorridor('usdc-ngn').map((t) => t.anchorId)).toEqual(['cowrie']);
  });

  it('ignores an anchor that is not in the registry', async () => {
    // 'flutterwave' was the old usdc-kes target and has never been registered.
    vi.stubEnv('ANCHOR_PAYMENT_ACCOUNTS', JSON.stringify({ flutterwave: VALID_KEY }));
    const { routingTargetsForCorridor } = await load();

    expect(routingTargetsForCorridor('usdc-kes')).toEqual([]);
  });

  it('rejects a malformed account rather than routing to it', async () => {
    for (const bad of ['not-a-key', '', 'GSHORT', 12345, null]) {
      vi.stubEnv('ANCHOR_PAYMENT_ACCOUNTS', JSON.stringify({ cowrie: bad }));
      const { routingTargetsForCorridor } = await load();
      // A typo in this config is a payment to a stranger, so anything that is
      // not a well-formed public key is dropped rather than passed through.
      expect(routingTargetsForCorridor('usdc-ngn')).toEqual([]);
    }
  });

  it('survives malformed JSON without throwing', async () => {
    vi.stubEnv('ANCHOR_PAYMENT_ACCOUNTS', '{not json');
    const { routingTargetsForCorridor } = await load();

    expect(routingTargetsForCorridor('usdc-ngn')).toEqual([]);
  });

  it('carries the registry domain, not a configured one', async () => {
    vi.stubEnv('ANCHOR_PAYMENT_ACCOUNTS', JSON.stringify({ cowrie: VALID_KEY }));
    const { routingTargetsForCorridor } = await load();

    const target = routingTargetsForCorridor('usdc-ngn')[0];
    const registry = ANCHORS.find((a) => a.id === 'cowrie');
    // The domain is the registry's, so config cannot redirect an anchor's
    // identity — only supply its payment account.
    expect(target?.anchorDomain).toBe(registry?.homeDomain);
    expect(target?.anchorAccount).toBe(VALID_KEY);
  });
});

describe('registeredAnchorsForCorridor (#941)', () => {
  it('lists anchors regardless of payment configuration', async () => {
    vi.stubEnv('ANCHOR_PAYMENT_ACCOUNTS', '');
    const { registeredAnchorsForCorridor } = await load();

    // Used to explain *why* a corridor is unroutable, so it must report
    // anchors that exist but lack an account.
    expect(registeredAnchorsForCorridor('usdc-ngn')).toContain('cowrie');
    expect(registeredAnchorsForCorridor('usdc-kes')).toContain('moneygram');
    expect(registeredAnchorsForCorridor('usdc-nonexistent')).toEqual([]);
  });
});
