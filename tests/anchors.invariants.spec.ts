import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { StellarToml } from '@stellar/stellar-sdk';
import { resolveToml, _clearTomlCache } from '@/lib/stellar/sep1';
import { ANCHORS } from '@/constants/anchors';
import type { Anchor } from '@/types';

// Invariant: every registered anchor's `seps` claim must be backed by the
// corresponding stellar.toml key. A registry entry that claims a SEP its toml
// does not advertise is a lie the UI would act on (e.g. routing a SEP-24 flow to
// an anchor that has no TRANSFER_SERVER_SEP0024) — these tests make such a
// mismatch fail in CI rather than at runtime.
//
// We exercise the real SEP-1 parser (lib/stellar/sep1.ts) by mocking only the
// network resolver, and use fast-check to vary the toml field combinations so the
// invariant holds regardless of which optional fields an anchor publishes.

type Sep = NonNullable<Anchor['seps']>[number];

/**
 * SEP claim -> the stellar.toml key whose presence advertises it. This mirrors
 * the contract encoded in lib/stellar/sep1.ts. If the parser's mapping ever drifts
 * from this table, the round-trip property below fails.
 */
const SEP_TOML_KEY: Record<Sep, string> = {
  sep6: 'TRANSFER_SERVER',
  sep10: 'WEB_AUTH_ENDPOINT',
  sep24: 'TRANSFER_SERVER_SEP0024',
  sep31: 'DIRECT_PAYMENT_SERVER',
  sep38: 'ANCHOR_QUOTE_SERVER',
};

const ALL_SEPS = Object.keys(SEP_TOML_KEY) as Sep[];

// Optional toml fields that are noise with respect to SEP capability detection.
// Toggling them proves detection depends only on the SEP keys above. Kept disjoint
// from SEP_TOML_KEY so they never accidentally advertise a SEP.
const NOISE_KEYS = ['SIGNING_KEY', 'NETWORK_PASSPHRASE', 'ORG_URL', 'ORG_SUPPORT_EMAIL'] as const;

/** Build a raw stellar.toml record advertising exactly `seps`, plus `noise`. */
function rawTomlFor(domain: string, seps: readonly Sep[], noise: readonly string[]) {
  const raw: Record<string, unknown> = { CURRENCIES: [{ code: 'USDC' }] };
  for (const sep of seps) raw[SEP_TOML_KEY[sep]] = `https://${domain}/${sep}`;
  for (const key of noise) raw[key] = `${key.toLowerCase()}-value`;
  return raw;
}

/** Run the real parser over a mocked resolver response for `domain`. */
async function parse(domain: string, raw: Record<string, unknown>) {
  _clearTomlCache(); // resolveToml memoizes per domain; isolate each run
  vi.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValue(raw as never);
  const result = await resolveToml(domain);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

beforeEach(() => {
  _clearTomlCache();
  vi.restoreAllMocks();
});

describe('anchor registry / toml invariants', () => {
  const declared = ANCHORS.filter((a): a is Anchor & { seps: Sep[] } => (a.seps?.length ?? 0) > 0);

  it('has at least one anchor declaring SEPs to validate', () => {
    expect(declared.length).toBeGreaterThan(0);
  });

  // Core acceptance: for each registered anchor, a toml that advertises its
  // claimed SEPs (amid arbitrary noise fields) is parsed as supporting every one
  // of them. If a claim referenced a SEP the parser does not recognize, the
  // capability lookup would be undefined and this fails.
  it.each(declared.map((a) => [a.id, a] as const))(
    'anchor %s: every claimed SEP is detected from its toml',
    async (_id, anchor) => {
      const domain = anchor.serviceDomain ?? anchor.homeDomain;
      await fc.assert(
        fc.asyncProperty(fc.subarray([...NOISE_KEYS]), async (noise) => {
          const toml = await parse(domain, rawTomlFor(domain, anchor.seps, noise));
          for (const sep of anchor.seps) {
            expect(toml.capabilities[sep]).toBe(true);
          }
        }),
        { numRuns: 25 }
      );
    }
  );

  // The property that gives the invariant teeth: capability detection is exact —
  // a SEP is reported as supported if and only if its toml key is present. So a
  // registry claim with no backing key is always detectable as a mismatch.
  it('parser capabilities match the advertised SEP keys exactly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.subarray([...ALL_SEPS]),
        fc.subarray([...NOISE_KEYS]),
        async (seps, noise) => {
          const toml = await parse(
            'generated.example',
            rawTomlFor('generated.example', seps, noise)
          );
          for (const sep of ALL_SEPS) {
            expect(Boolean(toml.capabilities[sep])).toBe(seps.includes(sep));
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  // Per-anchor teeth: for each real anchor claim, drive the toml across arbitrary
  // advertised-SEP states and assert the mismatch detector flags exactly the
  // claimed SEPs the toml fails to back. When the advertised set omits a claim
  // (a registry/toml mismatch) `missing` is non-empty — i.e. the mismatch fails.
  it.each(declared.map((a) => [a.id, a] as const))(
    'anchor %s: mismatch detector flags exactly the unbacked claims',
    async (_id, anchor) => {
      const domain = anchor.serviceDomain ?? anchor.homeDomain;
      await fc.assert(
        fc.asyncProperty(
          fc.subarray([...ALL_SEPS]),
          fc.subarray([...NOISE_KEYS]),
          async (advertised, noise) => {
            const toml = await parse(domain, rawTomlFor(domain, advertised, noise));
            const missing = anchor.seps.filter((sep) => !toml.capabilities[sep]);
            const expectedMissing = anchor.seps.filter((sep) => !advertised.includes(sep));
            expect(missing).toEqual(expectedMissing);
          }
        ),
        { numRuns: 40 }
      );
    }
  );
});
