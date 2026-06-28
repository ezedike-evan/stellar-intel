#!/usr/bin/env node
// Nightly anchor validator — stale-anchor auto-disable (#495 / B062).
//
// Resolves every registered anchor's `.well-known/stellar.toml` and maintains a
// per-anchor health ledger (constants/anchor-health.json). An anchor that fails
// resolution for `thresholdNights` consecutive runs is flagged `degraded` so the
// app can hide it from selectors (see lib/stellar/anchors.ts) WITHOUT the anchor
// being deleted from the registry — the flag clears automatically on the first
// successful resolution.
//
// Designed to run from the nightly workflow (one run == one "night").
//
// Usage:
//   node scripts/validate-anchors.mjs            # probe, update the ledger, print a summary
//   node scripts/validate-anchors.mjs --dry-run  # probe + print, do not write the ledger
//
// Env:
//   ANCHOR_DEGRADE_THRESHOLD   Override the consecutive-failure threshold (default 3).

import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const DEFAULT_THRESHOLD = 3;
const PROBE_TIMEOUT_MS = 15_000;
const USER_AGENT = 'stellar-intel-validate-anchors/1.0';

// A strict public-hostname shape: dot-separated labels with an alphabetic TLD.
// Rejects IPs, `localhost`, ports, userinfo (`@`) and paths — so a malformed
// registry entry can't steer the probe at an internal/unexpected host.
const HOSTNAME_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

const ROOT = new URL('../', import.meta.url);
const ANCHORS_SOURCE = new URL('constants/anchors.ts', ROOT);
const LEDGER_PATH = new URL('constants/anchor-health.json', ROOT);

/**
 * @typedef {Object} AnchorRef
 * @property {string} id
 * @property {string} domain
 *
 * @typedef {Object} ProbeResult
 * @property {boolean} ok
 * @property {string | null} error
 *
 * @typedef {Object} AnchorHealth
 * @property {number} consecutiveFailures
 * @property {boolean} degraded
 * @property {string | null} lastCheckedAt
 * @property {string} lastStatus
 * @property {string | null} lastError
 *
 * @typedef {Object} HealthLedger
 * @property {number} thresholdNights
 * @property {string | null} updatedAt
 * @property {Record<string, AnchorHealth>} anchors
 */

/**
 * Extract `{ id, domain }` for every anchor in constants/anchors.ts. The probe
 * domain is `serviceDomain` when present, else `homeDomain` — matching the
 * resolution order the app uses in lib/stellar/anchors.ts. Parsing the source
 * (rather than importing it) keeps this plain-Node script free of the TS/alias
 * toolchain while still treating constants/anchors.ts as the source of truth.
 *
 * @param {string} source
 * @returns {AnchorRef[]}
 */
export function parseAnchors(source) {
  // Match `const ANCHORS ... = [`, landing on the array's opening bracket — not
  // the `[]` of a `: Anchor[]` type annotation that may sit before the `=`.
  const decl = source.match(/const\s+ANCHORS\b[^=]*=\s*\[/);
  if (!decl) return [];
  const arrStart = decl.index + decl[0].length - 1;

  // Find the matching close bracket for the ANCHORS array (corridors arrays nest).
  let depth = 0;
  let arrEnd = -1;
  for (let i = arrStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        arrEnd = i;
        break;
      }
    }
  }
  if (arrEnd === -1) return [];

  // Anchor objects contain no nested braces, so `{ ... }` blocks isolate cleanly.
  const blocks = source.slice(arrStart, arrEnd + 1).match(/\{[^{}]*\}/g) ?? [];
  const anchors = [];
  for (const block of blocks) {
    const id = block.match(/id:\s*['"]([^'"]+)['"]/)?.[1];
    if (!id) continue;
    const home = block.match(/homeDomain:\s*['"]([^'"]+)['"]/)?.[1];
    const service = block.match(/serviceDomain:\s*['"]([^'"]+)['"]/)?.[1];
    const domain = service || home;
    if (domain) anchors.push({ id, domain });
  }
  return anchors;
}

/**
 * Fold a single probe result into an anchor's prior health record. Success resets
 * the failure streak; failure increments it. `degraded` latches on once the streak
 * reaches the threshold and clears on the next success.
 *
 * @param {AnchorHealth | undefined} prev
 * @param {ProbeResult} probe
 * @param {number} threshold
 * @param {string} now ISO timestamp
 * @returns {AnchorHealth}
 */
export function nextHealth(prev, probe, threshold, now) {
  const priorFailures = prev?.consecutiveFailures ?? 0;
  const consecutiveFailures = probe.ok ? 0 : priorFailures + 1;
  let lastError = null;
  if (!probe.ok) lastError = probe.error ?? 'unknown error';
  return {
    consecutiveFailures,
    degraded: consecutiveFailures >= threshold,
    lastCheckedAt: now,
    lastStatus: probe.ok ? 'ok' : 'fail',
    lastError,
  };
}

/**
 * Build the next ledger from the prior ledger and this run's probe results. Only
 * anchors present in `probesById` are kept, so anchors removed from the registry
 * are pruned from the ledger automatically.
 *
 * @param {Partial<HealthLedger> | undefined} prevLedger
 * @param {Record<string, ProbeResult>} probesById
 * @param {{ threshold: number, now: string }} opts
 * @returns {HealthLedger}
 */
export function applyProbes(prevLedger, probesById, { threshold, now }) {
  /** @type {Record<string, AnchorHealth>} */
  const anchors = {};
  for (const [id, probe] of Object.entries(probesById)) {
    anchors[id] = nextHealth(prevLedger?.anchors?.[id], probe, threshold, now);
  }
  return { thresholdNights: threshold, updatedAt: now, anchors };
}

/**
 * Probe a single anchor domain's stellar.toml. A 200 response that advertises
 * SEP-24 (`TRANSFER_SERVER_SEP0024`) is a success; anything else is a failure.
 *
 * @param {string} domain
 * @returns {Promise<ProbeResult>}
 */
async function probeDomain(domain) {
  // Validate the host before it reaches fetch: this rejects a malformed registry
  // entry and constrains the file-derived value to a known-safe URL shape.
  if (!HOSTNAME_RE.test(domain)) {
    return { ok: false, error: `invalid anchor domain: ${domain}` };
  }
  const url = new URL(`https://${domain}/.well-known/stellar.toml`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const toml = await res.text();
    if (!/^\s*TRANSFER_SERVER_SEP0024\s*=/im.test(toml)) {
      return { ok: false, error: 'missing TRANSFER_SERVER_SEP0024 (SEP-24)' };
    }
    return { ok: true, error: null };
  } catch (err) {
    const code = err?.cause?.code ? `:${err.cause.code}` : '';
    return { ok: false, error: `${err?.name ?? 'Error'}${code}` };
  } finally {
    clearTimeout(timer);
  }
}

function statusLabel(health) {
  if (health.degraded) return 'DEGRADED';
  return health.lastStatus === 'ok' ? 'ok' : 'fail';
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const source = await readFile(ANCHORS_SOURCE, 'utf8');
  const anchors = parseAnchors(source);

  if (anchors.length === 0) {
    console.warn('No anchors found in constants/anchors.ts; nothing to validate.');
    return;
  }

  /** @type {Partial<HealthLedger>} */
  let prevLedger = { anchors: {} };
  try {
    prevLedger = JSON.parse(await readFile(LEDGER_PATH, 'utf8'));
  } catch {
    // First run (or a malformed ledger): start from an empty ledger.
  }

  const threshold =
    Number(process.env.ANCHOR_DEGRADE_THRESHOLD) || prevLedger.thresholdNights || DEFAULT_THRESHOLD;
  const now = new Date().toISOString();

  // Probe in parallel, then reassemble in source order for deterministic diffs.
  const entries = anchors.map(async ({ id, domain }) => [id, await probeDomain(domain)]);
  const probesById = Object.fromEntries(await Promise.all(entries));
  const ledger = applyProbes(prevLedger, probesById, { threshold, now });

  console.log(`Anchor validation — ${now} (threshold: ${threshold} night(s))`);
  for (const { id, domain } of anchors) {
    const health = ledger.anchors[id];
    const detail = health.lastError ? ` — ${health.lastError}` : '';
    const streak = `streak ${health.consecutiveFailures}`;
    const line = `  ${id.padEnd(12)} ${domain.padEnd(28)} ${statusLabel(health)} (${streak})${detail}`;
    console.log(line);
  }

  const degraded = Object.keys(ledger.anchors).filter((id) => ledger.anchors[id].degraded);
  if (degraded.length > 0) {
    console.warn(`::warning::${degraded.length} anchor(s) degraded: ${degraded.join(', ')}`);
  }

  if (dryRun) {
    console.log('(dry run — ledger not written)');
    return;
  }
  await writeFile(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  console.log('Wrote constants/anchor-health.json');
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
