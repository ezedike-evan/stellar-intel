#!/usr/bin/env node
// Anchor fleet survey — reproducible classification of Stellar anchors by SEP support.
//
// Pulls every account tagged `anchor` from the stellar.expert public directory,
// fetches each domain's `stellar.toml`, and classifies it by the same keys the
// runtime uses in lib/stellar/server-rates.ts:
//
//   TRANSFER_SERVER          -> SEP-6  (programmatic deposit/withdraw)
//   TRANSFER_SERVER_SEP0024  -> SEP-24 (interactive hosted deposit/withdraw)
//   ANCHOR_QUOTE_SERVER      -> SEP-38 (firm-quote RFQ)
//   DIRECT_PAYMENT_SERVER    -> SEP-31 (cross-border payments)
//
// This is the script behind the "Anchor Fleet Status" section of maintainer.md.
// Re-run it to refresh the 41/11/30/51 snapshot and surface anchors that have
// since come online.
//
// Usage:
//   node scripts/anchor-survey.mjs            # human summary
//   node scripts/anchor-survey.mjs --json     # machine-readable JSON
//   node scripts/anchor-survey.mjs --json > anchors.json
//   node scripts/anchor-survey.mjs --recheck  # Markdown tables for docs/ANCHOR_FLEET_RECHECK.md
//   node scripts/anchor-survey.mjs --concurrency 8   # parallel lookups (default 12, clamped 1-32)
//   ANCHOR_SURVEY_CONCURRENCY=8 node scripts/anchor-survey.mjs   # same, via env (flag wins)
//
// Notes / caveats (see also docs + maintainer.md):
//   - The directory is NOT comprehensive (Stellar is permissionless). It also
//     lists anchors by their issuer/home domain, which is often distinct from the
//     service subdomain that actually hosts SEP endpoints (e.g. MoneyGram is listed
//     as `mgusd.moneygram.com` — issuer-only — while the live SEP-24 service runs
//     at `stellar.moneygram.com`). Treat the transfer-capable count as a FLOOR.
//   - "Transfer-capable" != "fiat off-ramp we care about": some hits are crypto
//     anchors or DEX gateways with no fiat corridor.

import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { fetchDirectoryCandidates } from './lib/directory.mjs';
import { isImpersonation } from './lib/impersonation.mjs';

const DIRECTORY_URL = 'https://api.stellar.expert/explorer/public/directory?tag[]=anchor&limit=200';
const PER_ANCHOR_TIMEOUT_MS = 12_000;
// The system resolver starts failing above ~12 concurrent lookups (2026-09-23
// census), which shows up as false "DNS does not resolve" rows.
const DEFAULT_CONCURRENCY = 12;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 32;
// Wait before the single retry when DNS itself failed, so a resolver hiccup can clear.
const DNS_RETRY_DELAY_MS = 1000;
const DNS_RETRY_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN']);

/**
 * Reads the value that follows a `--flag` in argv, or returns null when the flag
 * is absent. `--flag value` and `--flag=value` are both accepted.
 * @param {string} flag
 * @param {string[]} argv
 * @returns {string | null}
 */
function flagValue(flag, argv = process.argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag) return argv[i + 1] ?? null;
    if (argv[i].startsWith(`${flag}=`)) return argv[i].slice(flag.length + 1);
  }
  return null;
}

/**
 * Resolve the lookup concurrency: `--concurrency N` (or `--concurrency=N`),
 * else `ANCHOR_SURVEY_CONCURRENCY`, else 12; unparseable values fall through to
 * the next source; the result is clamped to 1-32.
 *
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 */
export function parseConcurrency(argv = [], env = {}) {
  const parse = (raw) => {
    if (raw == null || String(raw).trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  };

  let fromFlag = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--concurrency') {
      fromFlag = parse(argv[i + 1]);
    } else if (argv[i].startsWith('--concurrency=')) {
      fromFlag = parse(argv[i].slice('--concurrency='.length));
    }
  }

  const value = fromFlag ?? parse(env.ANCHOR_SURVEY_CONCURRENCY) ?? DEFAULT_CONCURRENCY;
  return Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, value));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --census <path>: a committed roster of anchor domains that outlives any single
// directory response. Domains listed there are surveyed alongside the live
// directory pull, and the file is rewritten with the union so a domain the
// directory later drops is not lost from the fleet's memory (#1323).
const censusPath = flagValue('--census');

// Notes carried into the recheck ledger for domains that map to a known anchor
// or are otherwise worth a second look. Keyed by directory domain.
const RECHECK_NOTES = {
  'cowrie.exchange': 'Listed anchor — home-domain probe only; SEP-24 service confirmed separately',
  'mgusd.moneygram.com': 'MoneyGram issuer domain; live service runs at stellar.moneygram.com',
  'mykobo.co': 'EUR off-ramp candidate (see #482)',
  'merge.lobstr.co': 'LOBSTR aggregator subdomain',
  'dead.apay.io': 'Legacy/retired subdomain',
  'old.repocoin.io': 'Legacy/retired subdomain',
  'old.sureremit.co': 'Legacy/retired subdomain',
};

// Human-readable symptom for an "unconfirmed" domain's failure reason.
export function symptom(reason) {
  return (
    {
      'HTTP 400': 'HTTP 400 (bad request)',
      'HTTP 403': 'HTTP 403 (forbidden)',
      'HTTP 404': 'HTTP 404 (no toml)',
      'HTTP 521': 'HTTP 521 (origin down)',
      'TypeError:ENOTFOUND': 'DNS does not resolve',
      'TypeError:ECONNREFUSED': 'connection refused',
      'TypeError:ERR_TLS_CERT_ALTNAME_INVALID': 'TLS cert name mismatch',
      'TypeError:UNABLE_TO_GET_ISSUER_CERT_LOCALLY': 'TLS chain incomplete',
      AbortError: 'timed out mid-response',
    }[reason] ?? reason
  );
}

/**
 * Render the unreachable/unconfirmed Markdown tables for the fleet-recheck
 * ledger. "Unreachable" is the connection-timeout set (no TLS handshake);
 * everything else answered in some form but served no usable toml.
 */
export function renderRecheck(dead, date) {
  const unreachable = dead
    .filter((d) => d.reason === 'TypeError:UND_ERR_CONNECT_TIMEOUT')
    .map((d) => d.domain)
    .sort();
  const unconfirmed = dead
    .filter((d) => d.reason !== 'TypeError:UND_ERR_CONNECT_TIMEOUT')
    .sort((a, b) => a.domain.localeCompare(b.domain));
  const note = (domain) => RECHECK_NOTES[domain] ?? '';

  const lines = [];
  lines.push(`<!-- generated by: node scripts/anchor-survey.mjs --recheck on ${date} -->`);
  lines.push(`## Unreachable (${unreachable.length})`, '');
  lines.push('| # | Domain | First seen | Last checked | Notes |');
  lines.push('|--:|---|---|---|---|');
  unreachable.forEach((domain, i) => {
    lines.push(`| ${i + 1} | \`${domain}\` | ${date} | ${date} | ${note(domain)} |`);
  });
  lines.push('', `## Unconfirmed (${unconfirmed.length})`, '');
  lines.push('| # | Domain | Symptom | Last checked | Notes |');
  lines.push('|--:|---|---|---|---|');
  unconfirmed.forEach((d, i) => {
    lines.push(
      `| ${i + 1} | \`${d.domain}\` | ${symptom(d.reason)} | ${date} | ${note(d.domain)} |`
    );
  });
  return lines.join('\n');
}

/**
 * Classify a single survey result into one of four fleet tiers (#1319):
 *
 *   - `excluded`    — flagged as impersonation (`result.excluded` set); never a
 *                     candidate for anything.
 *   - `routable`    — a live withdraw rail: SEP-6 or SEP-24 whose `/info` probe
 *                     returned `ok` with at least one asset code in `withdraw`
 *                     or `withdrawExchange`. Whether that rail is fiat or crypto
 *                     is judged later, at onboarding.
 *   - `health-only` — a reachable toml that advertises SEP-6, SEP-24 or SEP-31
 *                     but is not routable: the rail `/info` failed, only SEP-31
 *                     is offered, or no withdraw asset is enabled.
 *   - `listed`      — everything else: a reachable issuer-only toml, or an
 *                     unreachable domain.
 *
 * The `rails` shape (per-rail `/info` results with `withdraw` / `withdrawExchange`
 * asset lists) is produced by the multi-source probe. When it is absent — a
 * toml-only result — no rail can be proven routable, so an advertised transfer
 * SEP lands in `health-only` until a probe confirms a live withdraw asset.
 *
 * @param {Record<string, unknown>} result
 * @returns {'excluded' | 'routable' | 'health-only' | 'listed'}
 */
export function tierOf(result) {
  if (result.excluded) return 'excluded';

  const rails = /** @type {Record<string, any>} */ (result.rails ?? {});
  const railRoutable = (rail) =>
    Boolean(
      rail &&
      rail.ok === true &&
      ((rail.withdraw && rail.withdraw.length > 0) ||
        (rail.withdrawExchange && rail.withdrawExchange.length > 0))
    );
  if (railRoutable(rails.sep6) || railRoutable(rails.sep24)) return 'routable';

  if (!result.reachable) return 'listed';

  const advertisesTransfer = Boolean(
    result.sep6 || result.sep24 || result.sep31 || rails.sep6 || rails.sep24 || rails.sep31
  );
  return advertisesTransfer ? 'health-only' : 'listed';
}

/**
 * Read the domain roster from a census file. Missing file → empty roster (the
 * first run seeds it); malformed file → empty roster with a warning, so a bad
 * commit never aborts the survey.
 * @param {string} path
 * @returns {Promise<string[]>}
 */
async function readCensus(path) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.domains) ? parsed.domains : [];
  } catch {
    console.warn(`[anchor-survey] census file ${path} is not valid JSON; ignoring it`);
    return [];
  }
}

/**
 * Rewrite the census file with the sorted union of every domain surveyed this
 * run, so the roster only ever grows and the fleet keeps a memory of domains the
 * live directory later drops.
 * @param {string} path
 * @param {string[]} domains
 */
async function writeCensus(path, domains) {
  const body = {
    $comment:
      'Persistent roster of anchor domains surveyed by scripts/anchor-survey.mjs (--census). ' +
      'The union of this list and the live stellar.expert directory is surveyed each run, and ' +
      'this file is rewritten with the union so a domain the directory later drops is not lost.',
    updatedAt: new Date().toISOString(),
    domains: [...new Set(domains)].sort(),
  };
  await writeFile(path, `${JSON.stringify(body, null, 2)}\n`);
}

/**
 * Pull the anchor-tagged directory and return the distinct domains, merged with
 * any domains carried in the census roster.
 * @param {string[]} censusDomains
 */
async function fetchAnchorDomains(censusDomains = []) {
  const candidates = await fetchDirectoryCandidates();
  const domains = new Set(candidates.map((candidate) => candidate.domain));
  for (const domain of censusDomains) domains.add(domain);
  return [...domains].sort();
}

/** Single fetch attempt; throws on network/TLS failure, returns null on non-200. */
async function attempt(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PER_ANCHOR_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': 'stellar-intel-anchor-survey/1.0' },
    });
    if (!res.ok) return { status: res.status, toml: null };
    return { status: res.status, toml: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

const TOML_ENDPOINT_KEYS = {
  sep6: 'TRANSFER_SERVER',
  sep24: 'TRANSFER_SERVER_SEP0024',
  sep31: 'DIRECT_PAYMENT_SERVER',
  sep38: 'ANCHOR_QUOTE_SERVER',
  sep10: 'WEB_AUTH_ENDPOINT',
  sep12: 'KYC_SERVER',
};

/**
 * Pull SEP endpoint URLs out of a raw stellar.toml without a full TOML parse.
 * Line-anchored, quoted values only; only `https://` URLs are returned,
 * everything else is null (plain http, relative paths, missing keys).
 *
 * @param {string} toml
 * @returns {{ sep6: string | null, sep24: string | null, sep31: string | null,
 *   sep38: string | null, sep10: string | null, sep12: string | null }}
 */
export function parseTomlEndpoints(toml) {
  const out = { sep6: null, sep24: null, sep31: null, sep38: null, sep10: null, sep12: null };
  if (typeof toml !== 'string') return out;
  for (const [field, key] of Object.entries(TOML_ENDPOINT_KEYS)) {
    const match = new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, 'im').exec(toml);
    const value = match?.[1]?.trim() ?? null;
    out[field] = value && value.startsWith('https://') ? value : null;
  }
  return out;
}

// Fixed, well-formed Stellar public key used only as the `account` query
// parameter for SEP-10 liveness probes. It is unfunded, holds nothing, and its
// secret was never stored: nothing is ever signed with it.
export const PROBE_ACCOUNT = 'GBGE3HRVH4LGSNZXVLEBITOCQZFWHCGRUM2DY6GHZCHQQEXLCOFP2BWD';

// SEP-10 liveness must mirror how wallets call the endpoint: always with
// `?account=`. MoneyGram's https://stellar.moneygram.com/stellaradapterservice/auth
// answers a bare GET with HTTP 500 but a GET with `?account=` with HTTP 400
// (census 2026-09-23), so a bare probe would mark the busiest anchor on the
// network as down. Any status < 500 means the service is up.
export async function checkSep10Liveness(url, { fetchImpl = fetch } = {}) {
  const probeUrl = `${url}${url.includes('?') ? '&' : '?'}account=${PROBE_ACCOUNT}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PER_ANCHOR_TIMEOUT_MS);
  try {
    const res = await fetchImpl(probeUrl, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': 'stellar-intel-anchor-survey/1.0' },
    });
    return { url, status: res.status, alive: res.status < 500 };
  } catch (err) {
    const error = `${err?.name ?? 'Error'}${err?.cause?.code ? `:${err.cause.code}` : ''}`;
    return { url, status: null, alive: false, error };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch + classify a single domain's stellar.toml. Retries once.
 *
 * A reachable toml whose rails point at another institution's hosts (see
 * scripts/lib/impersonation.mjs) is flagged `excluded: 'impersonation'` and
 * never counts as transfer-capable.
 *
 * NOTE: Node's `fetch` (undici) verifies TLS and uses the runtime CA store, so a
 * domain with an expired/mismatched cert — or a runtime missing CA certs — fails
 * with TypeError ("fetch failed") even though `curl` (or a browser) might succeed.
 * `err.cause?.code` is captured so cross-environment drift is debuggable. The
 * authoritative reachable/transfer-capable split is the documented curl crawl; a
 * strict cert-verifying client legitimately sees fewer.
 */
export async function classify(domain) {
  const url = `https://${domain}/.well-known/stellar.toml`;
  let last;
  for (let i = 0; i < 2; i++) {
    try {
      const { status, toml } = await attempt(url);
      if (toml == null) return { domain, reachable: false, reason: `HTTP ${status}` };
      const has = (key) => new RegExp(`^\\s*${key}\\s*=`, 'im').test(toml);
      const result = {
        domain,
        reachable: true,
        sep6: has('TRANSFER_SERVER'),
        sep24: has('TRANSFER_SERVER_SEP0024'),
        sep38: has('ANCHOR_QUOTE_SERVER'),
        sep31: has('DIRECT_PAYMENT_SERVER'),
      };
      const endpoints = parseTomlEndpoints(toml);
      if (isImpersonation(domain, Object.values(endpoints))) {
        result.excluded = 'impersonation';
      }
      if (endpoints.sep10) result.sep10 = await checkSep10Liveness(endpoints.sep10);
      return result;
    } catch (err) {
      last = `${err?.name ?? 'Error'}${err?.cause?.code ? `:${err.cause.code}` : ''}`;
      if (i === 0 && DNS_RETRY_CODES.has(err?.cause?.code)) await sleep(DNS_RETRY_DELAY_MS);
    }
  }
  return { domain, reachable: false, reason: last };
}

/** Map over items with a fixed concurrency limit. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function main() {
  const asJson = process.argv.includes('--json');
  const asRecheck = process.argv.includes('--recheck');
  const concurrency = parseConcurrency(process.argv.slice(2), process.env);
  const censusDomains = censusPath ? await readCensus(censusPath) : [];
  const domains = await fetchAnchorDomains(censusDomains);
  const results = await mapLimit(domains, concurrency, classify);

  // Persist the surveyed roster back to the census so it accumulates over time.
  if (censusPath) await writeCensus(censusPath, domains);

  const live = results.filter((r) => r.reachable);
  const dead = results.filter((r) => !r.reachable);
  const any6 = live.filter((r) => r.sep6);
  const any24 = live.filter((r) => r.sep24);
  const both = live.filter((r) => r.sep6 && r.sep24);
  const only6 = live.filter((r) => r.sep6 && !r.sep24);
  const only24 = live.filter((r) => r.sep24 && !r.sep6);
  const transferCapable = live.filter((r) => (r.sep6 || r.sep24) && !r.excluded);
  const issuerOnly = live.filter((r) => !r.sep6 && !r.sep24);

  // Fleet tiers (#1319). Every result is tagged in place, then grouped into
  // domain lists so downstream consumers (the diff, the re-crawl) can track
  // movement between tiers without re-deriving the classification.
  for (const result of results) {
    result.tier = tierOf(result);
  }
  const tiers = {
    routable: results.filter((r) => r.tier === 'routable').map((r) => r.domain),
    healthOnly: results.filter((r) => r.tier === 'health-only').map((r) => r.domain),
    listed: results.filter((r) => r.tier === 'listed').map((r) => r.domain),
    excluded: results.filter((r) => r.tier === 'excluded').map((r) => r.domain),
  };

  if (asRecheck) {
    console.log(renderRecheck(dead, new Date().toISOString().slice(0, 10)));
    return;
  }

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          source: DIRECTORY_URL,
          totals: {
            tagged: domains.length,
            reachable: live.length,
            unreachable: dead.length,
            transferCapable: transferCapable.length,
            issuerOnly: issuerOnly.length,
            sep6: any6.length,
            sep24: any24.length,
            both: both.length,
            only6: only6.length,
            only24: only24.length,
            sep38: live.filter((r) => r.sep38).length,
            sep31: live.filter((r) => r.sep31).length,
            tiers: {
              routable: tiers.routable.length,
              healthOnly: tiers.healthOnly.length,
              listed: tiers.listed.length,
              excluded: tiers.excluded.length,
            },
          },
          tiers,
          transferCapableDomains: transferCapable.map((r) => r.domain),
          issuerOnlyDomains: issuerOnly.map((r) => r.domain),
          unreachableDomains: dead.map((r) => r.domain),
          results,
        },
        null,
        2
      )
    );
    return;
  }

  const line = (label, n) => console.log(`  ${label.padEnd(28)}${n}`);
  console.log(`Stellar anchor fleet survey — ${new Date().toISOString()}`);
  console.log(`Source: ${DIRECTORY_URL}\n`);
  line('directory-tagged domains:', domains.length);
  line('stellar.toml reachable:', live.length);
  line('unreachable / no toml:', dead.length);
  console.log('\nFleet tiers:');
  line('routable:', tiers.routable.length);
  line('health-only:', tiers.healthOnly.length);
  line('listed:', tiers.listed.length);
  line('excluded:', tiers.excluded.length);
  console.log('  (routable = live withdraw rail; fiat vs crypto is judged at onboarding)');
  console.log(`\nOf the ${live.length} live tomls:`);
  line('transfer-capable:', transferCapable.length);
  line('issuer-only:', issuerOnly.length);
  line('SEP-6 (any):', any6.length);
  line('SEP-24 (any):', any24.length);
  line('SEP-6 only:', only6.length);
  line('SEP-24 only:', only24.length);
  line('both SEP-6 & SEP-24:', both.length);
  line('also SEP-38 quotes:', live.filter((r) => r.sep38).length);
  line('also SEP-31 payments:', live.filter((r) => r.sep31).length);
  console.log(`\nTransfer-capable: ${transferCapable.map((r) => r.domain).join(', ')}`);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
