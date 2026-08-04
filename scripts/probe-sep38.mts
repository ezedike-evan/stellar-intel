/**
 * SEP-38 capability probe (#720).
 *
 * Answers one question with evidence rather than assumption: which registered
 * anchors can actually serve a firm quote, and for which assets.
 *
 *   npx tsx scripts/probe-sep38.mts                    # print a report
 *   npx tsx scripts/probe-sep38.mts --write-fixture    # refresh the committed capture
 *
 * Deliberately never exits non-zero on an anchor being unreachable. Third-party
 * availability is not a repository defect, and a check that reds the build when
 * someone else's server is down gets ignored.
 */

import { writeFileSync } from 'node:fs';

const ANCHORS = [
  { id: 'moneygram', homeDomain: 'stellar.moneygram.com' },
  { id: 'cowrie', homeDomain: 'cowrie.exchange' },
  { id: 'anclap', homeDomain: 'anclap.com' },
  { id: 'ngnc', homeDomain: 'ngnc.online' },
  { id: 'mykobo', homeDomain: 'mykobo.co' },
  { id: 'ntokens', homeDomain: 'ntokens.com' },
  { id: 'zeam', homeDomain: 'zeam.money' },
] as const;

const FIXTURE = 'tests/fixtures/sep38/capability-capture.json';
const TIMEOUT_MS = 20_000;
const RETRIES = 3;
const RETRY_DELAY_MS = 1_000;

interface AnchorResult {
  homeDomain: string;
  tomlHttp: number | null;
  anchorQuoteServer: string | null;
  sep38InfoHttp?: number;
  sep38Assets?: string[];
  error?: string;
}

/**
 * Fetches with retries.
 *
 * Not optional politeness: probing seven domains back to back produced a
 * transient failure for an anchor that answered fine on retry, and a
 * single-shot probe would have written "no SEP-38 support" into the committed
 * capture for an anchor that has it. A false negative here is worse than no
 * capture at all.
 */
async function fetchText(url: string): Promise<{ status: number; body: string }> {
  let lastError: unknown;

  for (let attempt = 0; attempt < RETRIES; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      return { status: res.status, body: await res.text() };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError;
}

/** Pulls ANCHOR_QUOTE_SERVER out of a stellar.toml without a full TOML parse. */
function readQuoteServer(toml: string): string | null {
  const match = /^\s*ANCHOR_QUOTE_SERVER\s*=\s*["']([^"']+)["']/im.exec(toml);
  return match?.[1] ?? null;
}

async function probe(homeDomain: string): Promise<AnchorResult> {
  const result: AnchorResult = { homeDomain, tomlHttp: null, anchorQuoteServer: null };

  try {
    const toml = await fetchText(`https://${homeDomain}/.well-known/stellar.toml`);
    result.tomlHttp = toml.status;
    if (toml.status !== 200) return result;

    const quoteServer = readQuoteServer(toml.body);
    result.anchorQuoteServer = quoteServer;
    if (!quoteServer) return result;

    const info = await fetchText(`${quoteServer.replace(/\/$/, '')}/info`);
    result.sep38InfoHttp = info.status;
    if (info.status === 200) {
      const parsed = JSON.parse(info.body) as { assets?: Array<{ asset: string }> };
      result.sep38Assets = (parsed.assets ?? []).map((a) => a.asset);
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}

async function main(): Promise<void> {
  const anchors: Record<string, AnchorResult> = {};

  for (const anchor of ANCHORS) {
    anchors[anchor.id] = await probe(anchor.homeDomain);
  }

  console.log('\nSEP-38 capability probe\n');
  for (const [id, r] of Object.entries(anchors)) {
    const capable = r.anchorQuoteServer ? 'YES' : 'no';
    const assets = r.sep38Assets?.length ? ` [${r.sep38Assets.join(', ')}]` : '';
    const err = r.error ? ` (${r.error})` : '';
    console.log(`  ${id.padEnd(12)} toml=${r.tomlHttp ?? '-'}  sep38=${capable}${assets}${err}`);
  }

  const capable = Object.entries(anchors).filter(([, r]) => r.anchorQuoteServer);
  console.log(`\n${capable.length} of ${ANCHORS.length} anchors advertise a SEP-38 quote server.`);

  const ngnCapable = capable.filter(([, r]) => r.sep38Assets?.some((a) => a.includes('NGN')));
  console.log(
    ngnCapable.length > 0
      ? `USDC->NGN firm quotes available from: ${ngnCapable.map(([id]) => id).join(', ')}`
      : 'USDC->NGN firm quotes: NOT AVAILABLE from any registered anchor.'
  );

  if (process.argv.includes('--write-fixture')) {
    writeFileSync(
      FIXTURE,
      JSON.stringify(
        {
          _comment:
            'Live SEP-38 capability capture (#720). Regenerate with scripts/probe-sep38.mts --write-fixture.',
          capturedAt: new Date().toISOString(),
          question: 'Can any registered anchor serve a SEP-38 firm quote for USDC->NGN?',
          answer:
            ngnCapable.length > 0
              ? `Yes, from ${ngnCapable.map(([id]) => id).join(', ')}.`
              : 'No. No anchor on the usdc-ngn corridor declares ANCHOR_QUOTE_SERVER.',
          anchors,
        },
        null,
        2
      ) + '\n',
      'utf8'
    );
    console.log(`\nFixture written to ${FIXTURE}`);
  }
}

main().catch((err: unknown) => {
  console.error(`Probe failed: ${err instanceof Error ? err.message : String(err)}`);
});
