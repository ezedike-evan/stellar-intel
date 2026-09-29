#!/usr/bin/env node
// Anchor fleet survey â€” reproducible classification of Stellar anchors by SEP support.
//
// Builds a candidate domain set from EVERY source (the registry in
// constants/anchors.ts, the full stellar.expert directory, top stellar.expert
// asset home domains and the SDF Anchor Directory), fetches each domain's
// `stellar.toml`, and classifies it by the same keys the runtime uses in
// lib/stellar/server-rates.ts:
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
//   node scripts/anchor-survey.mjs --sources registry,sdf-anchor-directory
//                                             # limit candidate sources (default: all)
//
// Notes / caveats (see also docs + maintainer.md):
//   - The directory is NOT comprehensive (Stellar is permissionless). It also
//     lists anchors by their issuer/home domain, which is often distinct from the
//     service subdomain that actually hosts SEP endpoints (e.g. MoneyGram is listed
//     as `mgusd.moneygram.com` â€” issuer-only â€” while the live SEP-24 service runs
//     at `stellar.moneygram.com`). Treat the transfer-capable count as a FLOOR.
//   - "Transfer-capable" != "fiat off-ramp we care about": some hits are crypto
//     anchors or DEX gateways with no fiat corridor.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { fetchDirectoryAll } from './lib/directory.mjs';
import { fetchTopAssetDomains } from './lib/asset-seeds.mjs';
import { fetchSdfAnchorDirectoryDomains } from './lib/sdf-directory.mjs';
import { HOSTNAME_RE, parseAnchors } from './validate-anchors.mjs';

// The primary directory URL. Kept as the JSON `source` field for older readers
// of the snapshot that expect a single source URL.
const DIRECTORY_URL = 'https://api.stellar.expert/explorer/public/directory?limit=200';
// File URL when run under plain Node; module runners like Vitest serve modules
// over http:// so fall back to the repo root (every caller runs from there).
const REGISTRY_URL = new URL('../constants/anchors.ts', import.meta.url);
const REGISTRY_PATH =
  REGISTRY_URL.protocol === 'file:'
    ? fileURLToPath(REGISTRY_URL)
    : resolve(process.cwd(), 'constants/anchors.ts');
const PER_ANCHOR_TIMEOUT_MS = 12_000;
const CONCURRENCY = 24;

/** Every candidate source, in the order they are consulted. */
export const SURVEY_SOURCES = [
  'registry',
  'stellar.expert-directory',
  'stellar.expert-assets',
  'sdf-anchor-directory',
];

// Sources that hit the network. When every selected remote source fails the
// survey has no external data left to run on and exits 1; `registry` reads a
// local file and never counts here.
const REMOTE_SOURCES = new Set([
  'stellar.expert-directory',
  'stellar.expert-assets',
  'sdf-anchor-directory',
]);

const asJson = process.argv.includes('--json');
const asRecheck = process.argv.includes('--recheck');

// Notes carried into the recheck ledger for domains that map to a known anchor
// or are otherwise worth a second look. Keyed by directory domain.
const RECHECK_NOTES = {
  'cowrie.exchange':
    'Listed anchor â€” home-domain probe only; SEP-24 service confirmed separately',
  'mgusd.moneygram.com': 'MoneyGram issuer domain; live service runs at stellar.moneygram.com',
  'mykobo.co': 'EUR off-ramp candidate (see #482)',
  'merge.lobstr.co': 'LOBSTR aggregator subdomain',
  'dead.apay.io': 'Legacy/retired subdomain',
  'old.repocoin.io': 'Legacy/retired subdomain',
  'old.sureremit.co': 'Legacy/retired subdomain',
};

// Human-readable symptom for an "unconfirmed" domain's failure reason.
function symptom(reason) {
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
function renderRecheck(dead, date) {
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
 * Pull every registered anchor's home and service domains from
 * constants/anchors.ts. `parseAnchors` returns `domain = serviceDomain ||
 * homeDomain`, so both raw hosts are read off the same block â€” an anchor whose
 * service host differs from its home host contributes both as candidates.
 */
async function fetchRegistryDomains() {
  const source = await readFile(REGISTRY_PATH, 'utf8');
  const rows = [];
  for (const anchor of parseAnchors(source)) {
    for (const raw of [anchor.homeDomain, anchor.serviceDomain]) {
      if (raw) rows.push({ domain: raw, sources: ['registry'] });
    }
  }
  return rows;
}

const SOURCE_FETCHERS = {
  registry: fetchRegistryDomains,
  'stellar.expert-directory': async () =>
    (await fetchDirectoryAll()).map((row) => ({
      domain: row.domain,
      sources: ['stellar.expert-directory'],
    })),
  'stellar.expert-assets': () => fetchTopAssetDomains(),
  'sdf-anchor-directory': () => fetchSdfAnchorDirectoryDomains(),
};

/**
 * Build the merged survey candidate set from the requested sources.
 *
 * Every source contributes `{ domain, sources }` rows; they are lower-cased,
 * validated against the same `HOSTNAME_RE` scripts/validate-anchors.mjs uses
 * (malformed hostnames like `localhost` or bare IPs are dropped) and merged by
 * domain, unioning each row's `sources` so every candidate records where it
 * came from. A source that throws is logged (`console.warn`) and skipped â€” but
 * if every selected REMOTE source fails the survey has no external data left
 * and this throws, so `main` exits 1.
 *
 * @param {{ sources?: string[] | string }} [opts]
 *   `sources` limits which of `SURVEY_SOURCES` run (default: all). Unknown
 *   names are warned about and ignored; an empty selection throws.
 * @returns {Promise<{
 *   candidates: { domain: string, sources: string[] }[],
 *   sources: string[],
 *   failed: string[],
 * }>} `candidates` sorted by domain, `sources` the sources that succeeded,
 *   `failed` the ones that threw.
 */
export async function collectCandidates({ sources } = {}) {
  const requested =
    sources == null
      ? [...SURVEY_SOURCES]
      : (typeof sources === 'string' ? sources.split(',') : sources)
          .map((name) => name.trim())
          .filter(Boolean);
  const unknown = requested.filter((name) => !SURVEY_SOURCES.includes(name));
  if (unknown.length > 0) {
    console.warn(`collectCandidates: unknown source(s) ignored: ${unknown.join(', ')}`);
  }
  const selected = SURVEY_SOURCES.filter((name) => requested.includes(name));
  if (selected.length === 0) {
    throw new Error(
      `collectCandidates: no valid sources selected (known: ${SURVEY_SOURCES.join(', ')})`
    );
  }

  const used = [];
  const failed = [];
  /** @type {Map<string, Set<string>>} */
  const byDomain = new Map();

  for (const name of selected) {
    let rows;
    try {
      rows = await SOURCE_FETCHERS[name]();
    } catch (err) {
      console.warn(`collectCandidates: source ${name} failed: ${err?.message ?? err}`);
      failed.push(name);
      continue;
    }
    used.push(name);

    for (const row of rows ?? []) {
      if (!row?.domain) continue;
      const domain = row.domain.toLowerCase();
      if (!HOSTNAME_RE.test(domain)) continue;
      let entry = byDomain.get(domain);
      if (!entry) {
        entry = new Set();
        byDomain.set(domain, entry);
      }
      entry.add(name);
      for (const extra of row.sources ?? []) {
        if (extra && extra !== name) entry.add(extra);
      }
    }
  }

  const remoteSelected = selected.filter((name) => REMOTE_SOURCES.has(name));
  if (remoteSelected.length > 0 && remoteSelected.every((name) => failed.includes(name))) {
    throw new Error(`all remote candidate sources failed: ${remoteSelected.join(', ')}`);
  }

  const candidates = [...byDomain.entries()]
    .map(([domain, set]) => ({ domain, sources: [...set] }))
    .sort((a, b) => a.domain.localeCompare(b.domain));
  return { candidates, sources: used, failed };
}

/** Parse a `--sources a,b,c` flag; returns undefined when the flag is absent. */
function parseSourcesArg(argv) {
  const index = argv.indexOf('--sources');
  if (index === -1) return undefined;
  return argv[index + 1] ?? '';
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

/**
 * Fetch + classify a single domain's stellar.toml. Retries once.
 *
 * NOTE: Node's `fetch` (undici) verifies TLS and uses the runtime CA store, so a
 * domain with an expired/mismatched cert â€” or a runtime missing CA certs â€” fails
 * with TypeError ("fetch failed") even though `curl` (or a browser) might succeed.
 * `err.cause?.code` is captured so cross-environment drift is debuggable. The
 * authoritative reachable/transfer-capable split is the documented curl crawl; a
 * strict cert-verifying client legitimately sees fewer.
 */
async function classify(domain) {
  const url = `https://${domain}/.well-known/stellar.toml`;
  let last;
  for (let i = 0; i < 2; i++) {
    try {
      const { status, toml } = await attempt(url);
      if (toml == null) return { domain, reachable: false, reason: `HTTP ${status}` };
      const has = (key) => new RegExp(`^\\s*${key}\\s*=`, 'im').test(toml);
      return {
        domain,
        reachable: true,
        sep6: has('TRANSFER_SERVER'),
        sep24: has('TRANSFER_SERVER_SEP0024'),
        sep38: has('ANCHOR_QUOTE_SERVER'),
        sep31: has('DIRECT_PAYMENT_SERVER'),
      };
    } catch (err) {
      last = `${err?.name ?? 'Error'}${err?.cause?.code ? `:${err.cause.code}` : ''}`;
    }
  }
  return { domain, reachable: false, reason: last };
}

/** Map over items with a fixed concurrency limit. */
async function mapLimit(items, limit, fn) {
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
  const { candidates, sources: usedSources } = await collectCandidates({
    sources: parseSourcesArg(process.argv),
  });
  const sourcesByDomain = new Map(
    candidates.map((candidate) => [candidate.domain, candidate.sources])
  );
  const domains = [...sourcesByDomain.keys()].sort();
  const results = await mapLimit(domains, CONCURRENCY, classify);
  for (const result of results) result.sources = sourcesByDomain.get(result.domain) ?? [];

  const live = results.filter((r) => r.reachable);
  const dead = results.filter((r) => !r.reachable);
  const any6 = live.filter((r) => r.sep6);
  const any24 = live.filter((r) => r.sep24);
  const both = live.filter((r) => r.sep6 && r.sep24);
  const only6 = live.filter((r) => r.sep6 && !r.sep24);
  const only24 = live.filter((r) => r.sep24 && !r.sep6);
  const transferCapable = live.filter((r) => r.sep6 || r.sep24);
  const issuerOnly = live.filter((r) => !r.sep6 && !r.sep24);

  if (asRecheck) {
    console.log(renderRecheck(dead, new Date().toISOString().slice(0, 10)));
    return;
  }

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          // Legacy single-source field for older readers; `sources` lists every
          // source this run actually consulted.
          source: DIRECTORY_URL,
          sources: usedSources,
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
          },
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
  console.log(`Stellar anchor fleet survey â€” ${new Date().toISOString()}`);
  console.log(`Sources: ${usedSources.join(', ')}\n`);
  line('candidate domains:', domains.length);
  line('stellar.toml reachable:', live.length);
  line('unreachable / no toml:', dead.length);
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

// Guard the run so the module stays importable for tests (collectCandidates et
// al.) without kicking off a full survey crawl on import.
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
