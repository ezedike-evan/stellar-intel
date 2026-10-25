// @vitest-environment node
//
// Live check: every anchor in the registry still serves a parseable
// stellar.toml that advertises the SEPs the registry claims for it (#1409).
//
// Run only by `npm run test:live` (the scheduled live-anchor-checks workflow),
// never by `npm test`. A failure here means a third-party anchor changed or is
// down, not that this repository regressed, which is why it lives apart from
// the mocked suite. See tests/live/README.md.

import { beforeEach, describe, expect, it } from 'vitest';
import { ANCHORS } from '@/constants/anchors';
import { _clearTomlCache, resolveToml } from '@/lib/stellar/sep1';

describe('registered anchors serve the stellar.toml the registry claims', () => {
  beforeEach(() => {
    _clearTomlCache();
  });

  it.each(ANCHORS)(
    '$id',
    async (anchor) => {
      const domain = anchor.serviceDomain ?? anchor.homeDomain;

      // The app's own fetch and parse, not a re-implementation of it.
      const result = await resolveToml(domain);
      expect(
        result.ok,
        `${anchor.id}: stellar.toml for ${domain} did not resolve: ${result.ok ? '' : result.error}`
      ).toBe(true);
      if (!result.ok) return;

      for (const sep of anchor.seps ?? []) {
        expect(
          result.data.capabilities[sep],
          `${anchor.id}: ${domain} does not advertise ${sep}, which the registry claims`
        ).toBe(true);
      }
    },
    30_000
  );
});
