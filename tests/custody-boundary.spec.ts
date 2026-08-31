import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { envSchema } from '@/lib/env';

/**
 * Custody boundary guard (#1147).
 *
 * docs/NON_CUSTODY.md and docs/PRODUCTION_AUDIT.md §1 both state that this
 * app never takes custody of user funds, and describe it as architectural —
 * no code path could take custody, not merely a policy against it. Nothing in
 * CI checked that. A server-side signing key, a held secret, or a route that
 * submits a transaction on a user's behalf would previously have merged
 * green.
 *
 * Source scan, not a runtime test — the invariant is about what code exists
 * (does anything under `lib/`/`app/` construct a signer from a raw secret?),
 * not what one execution path happens to do. Same shape as the raw-grey
 * scanner in tests/contrast.spec.ts: a walker, a banned pattern, and an
 * explicit, reasoned exemption list rather than a bare pass.
 *
 * `packages/publisher` is the one legitimate exception: the off-chain
 * publisher signs and submits reputation-oracle transactions with its own
 * key (`PUBLISHER_SECRET`) to record outcomes on-chain — never a user's key,
 * never a user's transaction. It is exempted by not being walked at all
 * (below), and `keeps its documented reason true` asserts that exemption
 * hasn't quietly become unnecessary or, worse, insufficient.
 *
 * Deliberately not scanned: `scripts/` and `tests/` both use
 * `Keypair.fromSecret` legitimately (deploy/admin tooling run by hand with an
 * operator's own key; test fixtures). Neither ships in the deployed app or
 * runs against a user's funds, so including them would mean documenting
 * exemptions for tooling this invariant was never about — see "Done when:
 * PUBLISHER_SECRET is the only exemption" in #1147.
 */

const SCAN_DIRS = ['lib', 'app'];

/** Directories excused from the scan entirely, each with a reason. */
const EXEMPT_DIRS: Array<{ dir: string; reason: string }> = [
  {
    dir: join('packages', 'publisher'),
    reason:
      "Signs and submits reputation-oracle transactions with the publisher's own key " +
      '(PUBLISHER_SECRET), never a user key or a user-built transaction.',
  },
];

function sourceFiles(dir: string, exts: string[] = ['.ts', '.tsx']): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next' || entry === '__tests__') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path, exts));
    } else if (
      exts.some((ext) => entry.endsWith(ext)) &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.test.tsx') &&
      !entry.endsWith('.spec.ts') &&
      !entry.endsWith('.spec.tsx')
    ) {
      out.push(path);
    }
  }
  return out;
}

/**
 * A raw Stellar secret seed constructed into a signer — the thing that turns
 * "we read a string" into "we can move funds". Matches whichever SDK a file
 * imports it from (`@stellar/stellar-sdk`, `stellar-sdk`, `@stellar/*`), since
 * the invariant is about the call, not which package re-exports `Keypair`.
 */
const CUSTODY_PATTERN = /\bKeypair\s*\.\s*fromSecret\s*\(/;

describe('custody boundary: no server-held user signing key (#1147)', () => {
  const files = SCAN_DIRS.flatMap((dir) => sourceFiles(dir));

  it('scans a non-trivial number of files', () => {
    // Guards against the walker silently returning nothing and the suite
    // going green because it checked zero files.
    expect(files.length).toBeGreaterThan(100);
  });

  it('finds no Keypair.fromSecret under lib/ or app/', () => {
    const violations: string[] = [];

    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (CUSTODY_PATTERN.test(line)) {
          violations.push(`${file}:${i + 1} — ${line.trim()}`);
        }
      });
    }

    expect(
      violations,
      'A module under lib/ or app/ constructs a Stellar signer from a raw secret. ' +
        "That is custody: this app never holds a user's key, so this either needs " +
        "moving into packages/publisher (if it is legitimately the publisher's own " +
        'key) or removing.\n' +
        violations.join('\n')
    ).toEqual([]);
  });

  it('every exempt directory still exists and is still outside the scan', () => {
    for (const { dir } of EXEMPT_DIRS) {
      expect(statSync(dir).isDirectory(), `${dir} no longer exists — stale exemption`).toBe(true);
      expect(
        SCAN_DIRS.some((scanned) => dir === scanned || dir.startsWith(`${scanned}${'/'}`)),
        `${dir} is exempted but is not actually inside a scanned directory — the exemption does nothing`
      ).toBe(false);
    }
  });

  it('packages/publisher still needs its exemption — it really does hold a signing key', () => {
    // The inverse of the two checks above: if the publisher package ever
    // stops constructing a signer from a secret, the exemption is no longer
    // describing anything real and should be removed, not left to quietly
    // permit whatever replaces it unexamined.
    const publisherFiles = sourceFiles(join('packages', 'publisher', 'src'));
    const usesCustodyPattern = publisherFiles.some((file) =>
      CUSTODY_PATTERN.test(readFileSync(file, 'utf8'))
    );
    expect(
      usesCustodyPattern,
      'packages/publisher no longer constructs a Keypair from a secret — its exemption ' +
        'in this spec is stale and should be removed.'
    ).toBe(true);
  });

  it('declares no user-facing secret-key variable in the client env schema', () => {
    // lib/env.ts validates NEXT_PUBLIC_* variables, which are inlined into
    // client JavaScript at build time and shipped to every visitor's browser.
    // A NEXT_PUBLIC_*_SECRET or *_PRIVATE_KEY there would not be a server-side
    // custody risk — it would be a secret handed directly to the public.
    const keys = Object.keys(envSchema.shape);
    const suspicious = keys.filter((key) => /secret|private_key/i.test(key));

    expect(
      suspicious,
      `The client env schema declares a variable that looks like a secret: ${suspicious.join(', ')}. ` +
        'Anything validated here is bundled into client JavaScript.'
    ).toEqual([]);
  });
});
