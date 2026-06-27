#!/usr/bin/env node
// Registry guard — every registered anchor must be transfer-capable.
//
// Asserts that each anchor in constants/anchors.ts resolves to a domain that the
// committed survey snapshot (scripts/anchor-survey.snapshot.json) classifies as
// "transfer-capable" (advertises SEP-6 TRANSFER_SERVER and/or SEP-24
// TRANSFER_SERVER_SEP0024). This stops us from registering — and routing quotes
// through — an anchor the fleet survey says cannot actually move value.
//
// An anchor matches if EITHER its serviceDomain or its homeDomain is in the
// snapshot's transfer-capable set. Anchors that are legitimately transfer-capable
// but invisible to the survey are listed in ALLOWLIST with a reason: the public
// directory the survey crawls lists some anchors by their issuer/home domain
// rather than the service subdomain that hosts the live SEP endpoints (MoneyGram
// is the canonical case — directory-listed as the issuer-only `mgusd.moneygram.com`
// while SEP-24 runs at `stellar.moneygram.com`). See scripts/anchor-survey.mjs.
//
// Usage:
//   node scripts/check-registry.mjs        # exits non-zero on any violation
//
// Regenerate the snapshot before re-surveying:
//   node scripts/anchor-survey.mjs --json > scripts/anchor-survey.snapshot.json

import { readFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const ANCHORS_PATH = resolve(repoRoot, 'constants/anchors.ts');
const SNAPSHOT_PATH = resolve(__dirname, 'anchor-survey.snapshot.json');

/**
 * Anchors that the survey cannot see as transfer-capable, but which we know are,
 * keyed by anchor id with the reason they need an exception. Keep this small and
 * documented — every entry is a promise to re-survey, not a way to silence the
 * guard. An entry whose anchor is no longer registered, or that the snapshot now
 * covers on its own, is flagged below so it can be removed.
 */
const ALLOWLIST = {
  moneygram:
    'Directory lists the issuer-only domain (mgusd.moneygram.com); live SEP-24 runs at the service domain stellar.moneygram.com, which the survey does not crawl.',
};

/** Extract the `[...]` literal assigned to `export const ANCHORS`. */
function extractAnchorsArray(source) {
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

/** Parse the anchor object literals we care about: id + home/service domains. */
function parseAnchors(arrayBody) {
  const anchors = [];
  // Each anchor is a brace-delimited object; corridors use `[ ]`, never `{ }`,
  // so a flat split on top-level objects is sufficient and robust.
  const objectRe = /\{[^{}]*\}/g;
  const field = (chunk, key) => {
    const m = chunk.match(new RegExp(`\\b${key}\\s*:\\s*['"]([^'"]+)['"]`));
    return m ? m[1] : undefined;
  };
  for (const [chunk] of arrayBody.matchAll(objectRe)) {
    const id = field(chunk, 'id');
    if (!id) continue;
    anchors.push({
      id,
      name: field(chunk, 'name') ?? id,
      homeDomain: field(chunk, 'homeDomain'),
      serviceDomain: field(chunk, 'serviceDomain'),
    });
  }
  return anchors;
}

function loadTransferCapableSet() {
  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8'));
  const domains = snapshot.transferCapableDomains;
  if (!Array.isArray(domains) || domains.length === 0) {
    throw new Error(
      'snapshot has no transferCapableDomains — regenerate it with anchor-survey.mjs'
    );
  }
  return new Set(domains.map((d) => d.toLowerCase()));
}

function main() {
  const anchors = parseAnchors(extractAnchorsArray(readFileSync(ANCHORS_PATH, 'utf-8')));
  if (anchors.length === 0) {
    throw new Error('parsed 0 anchors from constants/anchors.ts — has the format changed?');
  }
  const transferCapable = loadTransferCapableSet();

  const rel = (p) => relative(repoRoot, p).replace(/\\/g, '/');
  const isCapable = (a) =>
    [a.serviceDomain, a.homeDomain].some((d) => d && transferCapable.has(d.toLowerCase()));

  const violations = [];
  const allowed = [];
  for (const a of anchors) {
    const domain = a.serviceDomain ?? a.homeDomain ?? '(no domain)';
    if (isCapable(a)) continue;
    if (a.id in ALLOWLIST) {
      allowed.push(a);
      continue;
    }
    violations.push({ ...a, domain });
  }

  // Allowlist hygiene: surface entries that are stale (anchor unregistered) or
  // now redundant (snapshot covers the anchor on its own). These are warnings,
  // not failures, so a fresh survey never breaks an unrelated build.
  const registeredIds = new Set(anchors.map((a) => a.id));
  for (const id of Object.keys(ALLOWLIST)) {
    if (!registeredIds.has(id)) {
      console.warn(`warning: ALLOWLIST entry "${id}" is not a registered anchor — remove it.`);
    }
  }
  for (const a of allowed) {
    if (isCapable(a)) {
      console.warn(
        `warning: anchor "${a.id}" is allowlisted but is now transfer-capable — remove it from ALLOWLIST.`
      );
    }
  }

  console.log(`Registry guard — ${anchors.length} anchor(s) in ${rel(ANCHORS_PATH)}`);
  console.log(
    `Transfer-capable snapshot: ${transferCapable.size} domain(s) in ${rel(SNAPSHOT_PATH)}\n`
  );
  for (const a of anchors) {
    const domain = a.serviceDomain ?? a.homeDomain ?? '(no domain)';
    const mark = isCapable(a) ? 'ok' : a.id in ALLOWLIST ? 'allowlisted' : 'FAIL';
    console.log(`  ${mark.padEnd(12)}${a.id.padEnd(12)}${domain}`);
  }

  if (violations.length > 0) {
    console.error(
      `\nRegistry check failed: ${violations.length} anchor(s) are not transfer-capable and not allowlisted:`
    );
    for (const v of violations) {
      console.error(`  - ${v.id} (${v.domain}) is absent from the survey transfer-capable set.`);
    }
    console.error(
      `\nFix one of:\n` +
        `  - Remove the anchor from ${rel(ANCHORS_PATH)} if it cannot move value.\n` +
        `  - Re-run the survey if it has since come online: node scripts/anchor-survey.mjs --json > ${rel(SNAPSHOT_PATH)}\n` +
        `  - Add it to ALLOWLIST in ${rel(__dirname + '/check-registry.mjs')} with a reason if the survey cannot see its service domain.`
    );
    process.exit(1);
  }

  console.log(`\nAll registered anchors are transfer-capable or allowlisted.`);
}

try {
  main();
} catch (err) {
  console.error(`check-registry: ${err.message}`);
  process.exit(1);
}
