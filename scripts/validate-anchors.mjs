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
// It also validates asset-issuer integrity (#489): each anchor must advertise its
// registered asset (e.g. USDC) under the canonical issuer in its stellar.toml
// [[CURRENCIES]], not a look-alike issuer reusing a trusted code. Mismatches are
// flagged with a ::warning:: but are kept out of the degraded ledger.
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
 * @property {string} [assetCode] Registered asset code (e.g. "USDC").
 * @property {string} [assetIssuer] Canonical issuer literal, when written inline.
 * @property {string} [assetIssuerRef] Identifier the source assigns to assetIssuer
 *   (e.g. "USDC_ISSUER") when it is a reference rather than a literal.
 *
 * @typedef {Object} Currency
 * @property {string} code
 * @property {string | null} issuer
 *
 * @typedef {Object} ProbeResult
 * @property {boolean} ok
 * @property {string | null} error
 * @property {Currency[]} [currencies] Parsed [[CURRENCIES]] from a resolved toml.
 *
 * @typedef {'match' | 'mismatch' | 'missing' | 'unverifiable'} IssuerStatus
 *
 * @typedef {Object} IssuerResult
 * @property {IssuerStatus} status
 * @property {string | null} advertisedIssuer
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
    if (!domain) continue;

    /** @type {AnchorRef} */
    const ref = { id, domain };
    const assetCode = block.match(/assetCode:\s*['"]([^'"]+)['"]/)?.[1];
    if (assetCode) ref.assetCode = assetCode;

    // assetIssuer may be a quoted literal (e.g. nTokens) or a bare identifier
    // reference (e.g. `assetIssuer: USDC_ISSUER`); capture whichever form appears.
    const assetIssuerLiteral = block.match(/assetIssuer:\s*['"]([^'"]+)['"]/)?.[1];
    if (assetIssuerLiteral) {
      ref.assetIssuer = assetIssuerLiteral;
    } else {
      const assetIssuerRef = block.match(/assetIssuer:\s*([A-Za-z_$][\w$]*)/)?.[1];
      if (assetIssuerRef) ref.assetIssuerRef = assetIssuerRef;
    }

    anchors.push(ref);
  }
  return anchors;
}

/**
 * Parse the `[[CURRENCIES]]` tables out of a raw stellar.toml. Returns each
 * currency's `code` and `issuer` (null when the entry omits an issuer). A
 * line-anchored, table-scoped scan keeps it dependency-free while ignoring
 * `issuer`/`code` keys that belong to other tables.
 *
 * @param {string} toml
 * @returns {Currency[]}
 */
export function parseCurrencies(toml) {
  // Split on each [[CURRENCIES]] header; slice(1) drops the preamble before the
  // first one. Each piece holds one currency table until the next table header.
  const sections = toml.split(/^[ \t]*\[\[[ \t]*CURRENCIES[ \t]*\]\][ \t]*$/im).slice(1);
  /** @type {Currency[]} */
  const currencies = [];
  for (const section of sections) {
    // Limit to this table: stop at the next `[` table header at line start.
    const body = section.split(/^[ \t]*\[/m)[0];
    const code = body.match(/^[ \t]*code[ \t]*=[ \t]*["']([^"']+)["']/im)?.[1];
    if (!code) continue;
    const issuer = body.match(/^[ \t]*issuer[ \t]*=[ \t]*["']([^"']+)["']/im)?.[1] ?? null;
    currencies.push({ code, issuer });
  }
  return currencies;
}

/**
 * Resolve the canonical issuer an anchor is expected to settle. Inline literals
 * are returned as-is; a `USDC_ISSUER` reference is resolved from the environment
 * (the same NEXT_PUBLIC_USDC_ISSUER the app reads). Returns null when the issuer
 * cannot be determined, in which case validation is reported `unverifiable`.
 *
 * @param {AnchorRef} anchor
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | null}
 */
export function resolveExpectedIssuer(anchor, env = process.env) {
  if (anchor.assetIssuer) return anchor.assetIssuer;
  if (anchor.assetIssuerRef === 'USDC_ISSUER') {
    const value = env.NEXT_PUBLIC_USDC_ISSUER?.trim();
    return value ? value : null;
  }
  return null;
}

/**
 * Compare an anchor's expected issuer against the issuer advertised for the same
 * asset code in its toml CURRENCIES. `mismatch` is the look-alike case (#489):
 * the anchor publishes a trusted code under a different issuer.
 *
 * @param {{ assetCode?: string, expectedIssuer: string | null }} anchor
 * @param {Currency[]} currencies
 * @returns {IssuerResult}
 */
export function validateIssuer(anchor, currencies) {
  const advertisedIssuer =
    currencies.find((c) => c.code === anchor.assetCode && c.issuer)?.issuer ?? null;

  if (!anchor.expectedIssuer) return { status: 'unverifiable', advertisedIssuer };
  if (advertisedIssuer === null) return { status: 'missing', advertisedIssuer };
  return advertisedIssuer === anchor.expectedIssuer
    ? { status: 'match', advertisedIssuer }
    : { status: 'mismatch', advertisedIssuer };
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
    return { ok: false, error: `invalid anchor domain: ${domain}`, currencies: [] };
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
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, currencies: [] };
    const toml = await res.text();
    const currencies = parseCurrencies(toml);
    if (!/^\s*TRANSFER_SERVER_SEP0024\s*=/im.test(toml)) {
      return { ok: false, error: 'missing TRANSFER_SERVER_SEP0024 (SEP-24)', currencies };
    }
    return { ok: true, error: null, currencies };
  } catch (err) {
    const code = err?.cause?.code ? `:${err.cause.code}` : '';
    return { ok: false, error: `${err?.name ?? 'Error'}${code}`, currencies: [] };
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

  // Asset-issuer validation (#489): confirm each reachable anchor settles its
  // canonical issuer and is not a look-alike. Reported only for probes that
  // returned a toml; it never touches the degraded ledger above.
  console.log('Asset-issuer validation (canonical issuer match):');
  /** @type {{ id: string, advertisedIssuer: string | null, expectedIssuer: string | null }[]} */
  const mismatches = [];
  for (const anchor of anchors) {
    if (!anchor.assetCode) continue;
    const expectedIssuer = resolveExpectedIssuer(anchor);
    const currencies = probesById[anchor.id]?.currencies ?? [];
    const { status, advertisedIssuer } = validateIssuer({ ...anchor, expectedIssuer }, currencies);
    const detail = advertisedIssuer ? ` advertised ${advertisedIssuer}` : '';
    console.log(
      `  ${anchor.id.padEnd(12)} ${anchor.assetCode.padEnd(6)} ${status.toUpperCase()}${detail}`
    );
    if (status === 'mismatch') mismatches.push({ id: anchor.id, advertisedIssuer, expectedIssuer });
  }
  if (mismatches.length > 0) {
    console.warn(
      `::warning::${mismatches.length} anchor(s) advertise a look-alike issuer: ${mismatches
        .map((m) => `${m.id} (${m.advertisedIssuer} != ${m.expectedIssuer})`)
        .join(', ')}`
    );
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
