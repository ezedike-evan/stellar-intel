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
//
// Notes / caveats (see also docs + maintainer.md):
//   - The directory is NOT comprehensive (Stellar is permissionless). It also
//     lists anchors by their issuer/home domain, which is often distinct from the
//     service subdomain that actually hosts SEP endpoints (e.g. MoneyGram is listed
//     as `mgusd.moneygram.com` — issuer-only — while the live SEP-24 service runs
//     at `stellar.moneygram.com`). Treat the transfer-capable count as a FLOOR.
//   - "Transfer-capable" != "fiat off-ramp we care about": some hits are crypto
//     anchors or DEX gateways with no fiat corridor.

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { fetchDirectoryCandidates } from './lib/directory.mjs';
import { extractAnchorsArray, parseAnchors, ANCHORS_PATH } from './check-registry.mjs';

const DIRECTORY_URL = 'https://api.stellar.expert/explorer/public/directory?tag[]=anchor&limit=200';
const PER_ANCHOR_TIMEOUT_MS = 12_000;
const CONCURRENCY = 24;

const asJson = process.argv.includes('--json');
const asRecheck = process.argv.includes('--recheck');
const censusIdx = process.argv.indexOf('--census');
const censusPath = censusIdx !== -1 ? process.argv[censusIdx + 1] : null;

const TIER_ORDER = { routable: 0, 'health-only': 1, listed: 2 };

/** The tier a live-classified result falls into, or null when excluded. */
function tierOf(result) {
  if (result.excluded || result.reachable === false) return null;
  if (result.sep6 || result.sep24) return 'routable';
  if (result.sep31) return 'health-only';
  return 'listed';
}

/**
 * Build the committed anchor census — one row per non-excluded survey result,
 * sorted by tier then domain — from the full survey `results` array and the
 * registered anchors from constants/anchors.ts. Pure: takes whatever shape
 * `results` rows already carry (asset lists, sources) rather than fetching
 * anything itself, so it is trivially unit-testable against fixtures.
 *
 * @param {Array<Record<string, unknown>>} results
 * @param {Array<{ id: string; homeDomain?: string; serviceDomain?: string }>} registryAnchors
 * @param {string | null} generatedAt
 */
export function buildCensus(results, registryAnchors, generatedAt) {
  const registryByDomain = new Map();
  for (const anchor of registryAnchors ?? []) {
    for (const domain of [anchor.homeDomain, anchor.serviceDomain]) {
      if (domain) registryByDomain.set(domain.toLowerCase(), anchor.id);
    }
  }

  const counts = { routable: 0, healthOnly: 0, listed: 0, excluded: 0 };
  const rows = [];

  for (const result of results) {
    const tier = tierOf(result);
    if (tier === null) {
      counts.excluded += 1;
      continue;
    }
    if (tier === 'routable') counts.routable += 1;
    else if (tier === 'health-only') counts.healthOnly += 1;
    else counts.listed += 1;

    rows.push({
      domain: result.domain,
      tier,
      seps: {
        sep6: Boolean(result.sep6),
        sep24: Boolean(result.sep24),
        sep31: Boolean(result.sep31),
        sep38: Boolean(result.sep38),
        sep10: Boolean(result.sep10),
      },
      withdrawAssets: result.withdrawAssets ?? [],
      depositAssets: result.depositAssets ?? [],
      receiveAssets: result.receiveAssets ?? [],
      sources: result.sources ?? [],
      registeredAnchorId: registryByDomain.get(result.domain.toLowerCase()) ?? null,
      checkedAt: result.checkedAt ?? generatedAt,
    });
  }

  rows.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.domain.localeCompare(b.domain));

  const sources = [...new Set(rows.flatMap((r) => r.sources))].sort();

  return { generatedAt, sources, counts, rows };
}

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

/** Pull the anchor-tagged directory and return the distinct domains. */
async function fetchAnchorDomains() {
  const candidates = await fetchDirectoryCandidates();
  const domains = new Set(candidates.map((candidate) => candidate.domain));
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

/**
 * Fetch + classify a single domain's stellar.toml. Retries once.
 *
 * NOTE: Node's `fetch` (undici) verifies TLS and uses the runtime CA store, so a
 * domain with an expired/mismatched cert — or a runtime missing CA certs — fails
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
        sep10: has('WEB_AUTH_ENDPOINT'),
        sources: [DIRECTORY_URL],
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
  const domains = await fetchAnchorDomains();
  const results = await mapLimit(domains, CONCURRENCY, classify);

  const live = results.filter((r) => r.reachable);
  const dead = results.filter((r) => !r.reachable);
  const any6 = live.filter((r) => r.sep6);
  const any24 = live.filter((r) => r.sep24);
  const both = live.filter((r) => r.sep6 && r.sep24);
  const only6 = live.filter((r) => r.sep6 && !r.sep24);
  const only24 = live.filter((r) => r.sep24 && !r.sep6);
  const transferCapable = live.filter((r) => r.sep6 || r.sep24);
  const issuerOnly = live.filter((r) => !r.sep6 && !r.sep24);
  const generatedAt = new Date().toISOString();

  if (censusPath) {
    const registryAnchors = parseAnchors(extractAnchorsArray(readFileSync(ANCHORS_PATH, 'utf-8')));
    const census = buildCensus(results, registryAnchors, generatedAt);
    writeFileSync(censusPath, JSON.stringify(census, null, 2) + '\n');
  }

  if (asRecheck) {
    console.log(renderRecheck(dead, new Date().toISOString().slice(0, 10)));
    return;
  }

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          generatedAt,
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
  console.log(`Stellar anchor fleet survey — ${new Date().toISOString()}`);
  console.log(`Source: ${DIRECTORY_URL}\n`);
  line('directory-tagged domains:', domains.length);
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

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
