import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// #733 — every public route must be rate-limited, and stay that way.
//
// A coverage assertion rather than a per-route test: the failure mode here is a
// *new* route shipping without a limit, which no amount of testing the existing
// ones catches. Twenty routes were uncovered while lib/api/openapi.ts described
// the limit as universal.

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

/** Routes deliberately exempt, each with a reason that has to survive review. */
const EXEMPT: Record<string, string> = {
  'app/api/publisher/tick/route.ts':
    'Cron-only, bearer-gated on CRON_SECRET; a limit here would throttle the scheduler itself.',
  'app/api/reputation/reconcile/route.ts': 'Cron-only, bearer-gated on CRON_SECRET.',
  'app/api/reputation/refresh/route.ts': 'Cron-only, bearer-gated on CRON_SECRET.',
  'app/api/graphql/route.ts': 'Limited inside the yoga handler.',
};

describe('rate-limit coverage (#733)', () => {
  const files = [...routeFiles('app/api'), ...routeFiles('app/v1')];

  it('finds the route files at all', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('every non-exempt route enforces a limit', () => {
    const uncovered = files.filter((f) => {
      if (EXEMPT[f]) return false;
      const src = readFileSync(f, 'utf8');
      return !/enforceRateLimit|checkRateLimit|withV1/.test(src);
    });

    expect(uncovered).toEqual([]);
  });

  it('exemptions all point at routes that still exist', () => {
    const stale = Object.keys(EXEMPT).filter((f) => !files.includes(f));
    expect(stale).toEqual([]);
  });
});
