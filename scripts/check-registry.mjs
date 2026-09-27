// Registry guard — every registered anchor must be transfer-capable (or, with a
// tiered snapshot, in the tier its own SEP support requires).
//
// Asserts that each anchor in constants/anchors.ts resolves to a domain the
// committed survey snapshot (scripts/anchor-survey.snapshot.json) backs up. This
// stops us from registering — and routing quotes through — an anchor the fleet
// survey says cannot actually move value.
//
// Legacy snapshot (no `tiers`): an anchor matches if EITHER its serviceDomain or
// homeDomain is in `transferCapableDomains`.
//
// Tiered snapshot (`snapshot.tiers = { routable, healthOnly, excluded }`, each a
// domain list):
//   - an anchor in `tiers.excluded` fails, regardless of ALLOWLIST;
//   - an anchor whose `seps` includes sep6 or sep24 must be in `tiers.routable`;
//   - an anchor whose `seps` includes sep31 but neither sep6 nor sep24 must be in
//     `tiers.routable` or `tiers.healthOnly`;
//   - an anchor with none of sep6/sep24/sep31 has no tier requirement to check.
//
// Anchors that are legitimately transfer-capable but invisible to the survey are
// listed in ALLOWLIST with a reason: the public directory the survey crawls
// lists some anchors by their issuer/home domain rather than the service
// subdomain that hosts the live SEP endpoints (MoneyGram is the canonical case
// — directory-listed as the issuer-only `mgusd.moneygram.com` while SEP-24 runs
// at `stellar.moneygram.com`). See scripts/anchor-survey.mjs.
//
// Usage:
//   node scripts/check-registry.mjs        # exits non-zero on any violation
//
// Regenerate the snapshot before re-surveying:
//   node scripts/anchor-survey.mjs --json > scripts/anchor-survey.snapshot.json

import { readFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
export const ANCHORS_PATH = resolve(repoRoot, 'constants/anchors.ts');
const SNAPSHOT_PATH = resolve(__dirname, 'anchor-survey.snapshot.json');

/**
 * Anchors that the survey cannot see as transfer-capable, but which we know are,
 * keyed by anchor id with the reason they need an exception. Keep this small and
 * documented — every entry is a promise to re-survey, not a way to silence the
 * guard. An entry whose anchor is no longer registered, or that the snapshot now
 * covers on its own, is flagged below so it can be removed.
 */
export const ALLOWLIST = {
  moneygram:
    'Directory lists the issuer-only domain (mgusd.moneygram.com); live SEP-24 runs at the service domain stellar.moneygram.com, which the survey does not crawl.',
};

/** Extract the `[...]` literal assigned to `export const ANCHORS`. */
export function extractAnchorsArray(source) {
  const decl = source.indexOf('export const ANCHORS');
  if (decl === -1) throw new Error('could not find `export const ANCHORS` in constants/anchors.ts');
  // Start after the `=` so the `[]` in the `Anchor[]` type annotation is skipped.
  const eq = source.indexOf('=', decl);
  const open = source.indexOf('[', eq);
  if (eq === -1 || open === -1) throw new Error('could not find ANCHORS array opening bracket');

  // Walk forward tracking bracket depth so the matching close bracket is found
  // even with nested corridor arrays.
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error('unterminated ANCHORS array literal');
}

/** Parse the anchor object literals we care about: id, home/service domains, seps. */
export function parseAnchors(arrayBody) {
  const anchors = [];
  // Each anchor is a brace-delimited object; corridors use `[ ]`, never `{ }`,
  // so a flat split on top-level objects is sufficient and robust.
  const objectRe = /\{[^{}]*\}/g;
  const field = (chunk, key) => {
    const m = chunk.match(new RegExp(`\\b${key}\\s*:\\s*['"]([^'"]+)['"]`));
    return m ? m[1] : undefined;
  };
  const arrayField = (chunk, key) => {
    const m = chunk.match(new RegExp(`\\b${key}\\s*:\\s*\\[([^\\]]*)\\]`));
    if (!m) return [];
    return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(([, v]) => v);
  };
  for (const [chunk] of arrayBody.matchAll(objectRe)) {
    const id = field(chunk, 'id');
    if (!id) continue;
    anchors.push({
      id,
      name: field(chunk, 'name') ?? id,
      homeDomain: field(chunk, 'homeDomain'),
      serviceDomain: field(chunk, 'serviceDomain'),
      seps: arrayField(chunk, 'seps'),
    });
  }
  return anchors;
}

function loadSnapshot() {
  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8'));
  if (!snapshot.tiers) {
    const domains = snapshot.transferCapableDomains;
    if (!Array.isArray(domains) || domains.length === 0) {
      throw new Error(
        'snapshot has no transferCapableDomains — regenerate it with anchor-survey.mjs'
      );
    }
  }
  return snapshot;
}

function domainOf(anchor) {
  return anchor.serviceDomain ?? anchor.homeDomain ?? null;
}

/** An anchor matches a domain list if EITHER its serviceDomain or homeDomain is in it. */
function inTier(tierDomains, anchor) {
  if (!Array.isArray(tierDomains)) return false;
  const set = new Set(tierDomains.map((d) => d.toLowerCase()));
  return [anchor.serviceDomain, anchor.homeDomain].some((d) => d && set.has(d.toLowerCase()));
}

/**
 * Evaluate every registered anchor against the snapshot.
 *
 * @param {ReturnType<typeof parseAnchors>} anchors
 * @param {Record<string, unknown>} snapshot
 * @param {Record<string, string>} allowlist
 * @returns {Array<{ id: string, name: string, domain: string, tier: string | null, ok: boolean, allowlisted: boolean, forcedFail: boolean, reason: string | null }>}
 */
export function evaluate(anchors, snapshot, allowlist) {
  const tiers = snapshot.tiers;
  const transferCapable = new Set(
    (snapshot.transferCapableDomains ?? []).map((d) => d.toLowerCase())
  );

  return anchors.map((a) => {
    const domain = domainOf(a) ?? '(no domain)';
    const seps = a.seps ?? [];

    if (tiers) {
      if (inTier(tiers.excluded, a)) {
        return {
          ...a,
          domain,
          tier: 'excluded',
          ok: false,
          allowlisted: false,
          forcedFail: true,
          reason: 'anchor domain is in tiers.excluded',
        };
      }

      const wantsRoutable = seps.includes('sep6') || seps.includes('sep24');
      const wantsHealthOnly = !wantsRoutable && seps.includes('sep31');

      let ok = true;
      let tier = null;
      let reason = null;

      if (wantsRoutable) {
        ok = inTier(tiers.routable, a);
        tier = ok ? 'routable' : null;
        reason = ok ? null : 'sep6/sep24 anchor must be in tiers.routable';
      } else if (wantsHealthOnly) {
        ok = inTier(tiers.routable, a) || inTier(tiers.healthOnly, a);
        tier = !ok ? null : inTier(tiers.routable, a) ? 'routable' : 'health-only';
        reason = ok ? null : 'sep31-only anchor must be in tiers.routable or tiers.healthOnly';
      } else {
        tier = inTier(tiers.routable, a)
          ? 'routable'
          : inTier(tiers.healthOnly, a)
            ? 'health-only'
            : inTier(tiers.listed, a)
              ? 'listed'
              : null;
      }

      const allowlisted = !ok && a.id in allowlist;
      return {
        ...a,
        domain,
        tier,
        baseOk: ok,
        ok: ok || allowlisted,
        allowlisted,
        forcedFail: false,
        reason,
      };
    }

    // Legacy snapshot: today's transferCapableDomains-only behaviour. An
    // anchor matches if EITHER its serviceDomain or homeDomain is covered.
    const ok = [a.serviceDomain, a.homeDomain].some(
      (d) => d && transferCapable.has(d.toLowerCase())
    );
    const allowlisted = !ok && a.id in allowlist;
    return {
      ...a,
      domain,
      tier: ok ? 'routable' : null,
      baseOk: ok,
      ok: ok || allowlisted,
      allowlisted,
      forcedFail: false,
      reason: ok ? null : 'absent from the survey transfer-capable set',
    };
  });
}

function main() {
  const anchors = parseAnchors(extractAnchorsArray(readFileSync(ANCHORS_PATH, 'utf-8')));
  if (anchors.length === 0) {
    throw new Error('parsed 0 anchors from constants/anchors.ts — has the format changed?');
  }
  const snapshot = loadSnapshot();
  const evaluated = evaluate(anchors, snapshot, ALLOWLIST);

  const rel = (p) => relative(repoRoot, p).replace(/\\/g, '/');
  const violations = evaluated.filter((a) => !a.ok);
  const allowed = evaluated.filter((a) => a.allowlisted);

  // Allowlist hygiene: surface entries that are stale (anchor unregistered) or
  // now redundant (the anchor now passes on its own). Warnings, not failures, so
  // a fresh survey never breaks an unrelated build.
  const registeredIds = new Set(anchors.map((a) => a.id));
  for (const id of Object.keys(ALLOWLIST)) {
    if (!registeredIds.has(id)) {
      console.warn(`warning: ALLOWLIST entry "${id}" is not a registered anchor — remove it.`);
    }
  }
  for (const a of allowed) {
    if (a.baseOk) {
      console.warn(
        `warning: anchor "${a.id}" is allowlisted but is now transfer-capable on its own — remove it from ALLOWLIST.`
      );
    }
  }

  console.log(`Registry guard — ${anchors.length} anchor(s) in ${rel(ANCHORS_PATH)}`);
  console.log(`Snapshot: ${rel(SNAPSHOT_PATH)}${snapshot.tiers ? ' (tiered)' : ' (legacy)'}\n`);
  for (const a of evaluated) {
    const mark = a.ok ? (a.allowlisted ? 'allowlisted' : 'ok') : 'FAIL';
    const tier = a.tier ?? '-';
    console.log(`  ${mark.padEnd(12)}${a.id.padEnd(12)}${tier.padEnd(12)}${a.domain}`);
  }

  if (violations.length > 0) {
    console.error(`\nRegistry check failed: ${violations.length} anchor(s) failed:`);
    for (const v of violations) {
      console.error(`  - ${v.id} (${v.domain}): ${v.reason}`);
    }
    console.error(
      `\nFix one of:\n` +
        `  - Remove the anchor from ${rel(ANCHORS_PATH)} if it cannot move value.\n` +
        `  - Re-run the survey if it has since come online: node scripts/anchor-survey.mjs --json > ${rel(SNAPSHOT_PATH)}\n` +
        `  - Add it to ALLOWLIST in ${rel(__dirname + '/check-registry.mjs')} with a reason if the survey cannot see its service domain (not available for tiers.excluded).`
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\nAll registered anchors pass the registry guard.`);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    main();
  } catch (err) {
    console.error(`check-registry: ${err.message}`);
    process.exitCode = 1;
  }
}
