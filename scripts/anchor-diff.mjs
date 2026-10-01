#!/usr/bin/env node
// Anchor fleet diff — compares a fresh `anchor-survey.mjs --json` run against the
// committed snapshot (scripts/anchor-survey.snapshot.json) and reports which
// domains newly became transfer-capable (SEP-6/SEP-24) or dropped out of that
// bucket. Used by the monthly re-crawl workflow (#492) to flag fleet changes
// worth a maintainer's attention — new anchors to consider onboarding, or
// integrated anchors whose registered domain stopped resolving as transfer-capable.
//
// Usage:
//   node scripts/anchor-survey.mjs --json | node scripts/anchor-diff.mjs
//   node scripts/anchor-diff.mjs path/to/fresh-survey.json
//   node scripts/anchor-diff.mjs --snapshot scripts/anchor-survey.snapshot.json path/to/fresh-survey.json
//
// Exit code: 0 when the fleet is unchanged, 2 when a change is detected (so a
// workflow can branch on `$?` without parsing stdout). Other failures exit 1.

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const DEFAULT_SNAPSHOT_PATH = new URL('scripts/anchor-survey.snapshot.json', ROOT);

/**
 * @param {string[]} argv
 * @returns {{ snapshotPath: string | URL, freshPath: string | null }}
 */
function parseArgs(argv) {
  let snapshotPath = DEFAULT_SNAPSHOT_PATH;
  let freshPath = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--snapshot') {
      snapshotPath = argv[++i];
    } else if (!argv[i].startsWith('--')) {
      freshPath = argv[i];
    }
  }
  return { snapshotPath, freshPath };
}

/**
 * @param {string[]} before
 * @param {string[]} after
 * @returns {{ added: string[], removed: string[] }}
 */
export function diffDomainList(before, after) {
  const beforeSet = new Set(before ?? []);
  const afterSet = new Set(after ?? []);
  const added = [...afterSet].filter((d) => !beforeSet.has(d)).sort();
  const removed = [...beforeSet].filter((d) => !afterSet.has(d)).sort();
  return { added, removed };
}

/**
 * @typedef {{
 *   transferCapableDomains?: string[],
 *   issuerOnlyDomains?: string[],
 *   unreachableDomains?: string[],
 *   tiers?: { routable?: string[], healthOnly?: string[], listed?: string[], excluded?: string[] },
 * }} Snapshot
 */

/**
 * @param {Snapshot} before
 * @param {Snapshot} after
 */
export function diffSnapshots(before, after) {
  const diff = {};

  // Survey tiers (#1320). Only diffed when BOTH snapshots carry `tiers` — a
  // committed snapshot that predates #1319 has none, and inventing empty tiers
  // for it would report every current tier member as "new". `excluded` is
  // intentionally left out: an impersonation entry appearing or disappearing is
  // not a fleet-capability change worth a diff section.
  if (before.tiers && after.tiers) {
    diff.routable = diffDomainList(before.tiers.routable, after.tiers.routable);
    diff.healthOnly = diffDomainList(before.tiers.healthOnly, after.tiers.healthOnly);
    diff.listed = diffDomainList(before.tiers.listed, after.tiers.listed);
  }

  diff.transferCapable = diffDomainList(
    before.transferCapableDomains,
    after.transferCapableDomains
  );
  diff.issuerOnly = diffDomainList(before.issuerOnlyDomains, after.issuerOnlyDomains);
  diff.unreachable = diffDomainList(before.unreachableDomains, after.unreachableDomains);

  return diff;
}

/**
 * @param {ReturnType<typeof diffSnapshots>} diff
 */
export function hasChanges(diff) {
  return Object.values(diff).some((d) => d.added.length > 0 || d.removed.length > 0);
}

function section(title, { added, removed }) {
  if (added.length === 0 && removed.length === 0) return '';
  const lines = [`### ${title}`];
  if (added.length > 0) lines.push('', '**New:**', ...added.map((d) => `- \`${d}\``));
  if (removed.length > 0) lines.push('', '**Lost:**', ...removed.map((d) => `- \`${d}\``));
  return lines.join('\n');
}

/**
 * @param {ReturnType<typeof diffSnapshots>} diff
 */
export function formatDiff(diff) {
  if (!hasChanges(diff)) return 'No fleet changes since the last committed snapshot.';
  const sections = [];
  // Tier sections lead, but only when the diff carries them (both snapshots had
  // `tiers`). A pre-tiers snapshot skips them without a placeholder.
  if (diff.routable) sections.push(section('Routable', diff.routable));
  if (diff.healthOnly) sections.push(section('Health-only', diff.healthOnly));
  if (diff.listed) sections.push(section('Listed', diff.listed));
  sections.push(
    section('Transfer-capable (SEP-6 / SEP-24)', diff.transferCapable),
    section('Issuer-only', diff.issuerOnly),
    section('Unreachable', diff.unreachable)
  );
  return sections.filter(Boolean).join('\n\n');
}

async function main() {
  const { snapshotPath, freshPath } = parseArgs(process.argv.slice(2));

  const [snapshotRaw, freshRaw] = await Promise.all([
    readFile(snapshotPath, 'utf8'),
    freshPath ? readFile(freshPath, 'utf8') : readStdin(),
  ]);

  const before = JSON.parse(snapshotRaw);
  const after = JSON.parse(freshRaw);
  const diff = diffSnapshots(before, after);

  console.log(formatDiff(diff));
  process.exitCode = hasChanges(diff) ? 2 : 0;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
