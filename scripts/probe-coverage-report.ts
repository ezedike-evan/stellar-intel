/**
 * 90-day probe-accumulation progress report (mainnet-readiness tracker).
 *
 * Reads uptime probe samples from the configured reputation store and prints
 * per-anchor continuous coverage, gaps, and fleet-wide days until threshold.
 *
 * Usage:
 *   tsx --tsconfig tsconfig.scripts.json scripts/probe-coverage-report.ts
 *   tsx --tsconfig tsconfig.scripts.json scripts/probe-coverage-report.ts --json
 *   tsx --tsconfig tsconfig.scripts.json scripts/probe-coverage-report.ts --demo
 *
 * `--demo` runs against a built-in seeded dataset (no DB required).
 */

import { ANCHORS } from '../constants/anchors';
import {
  anchorProbeDomains,
  buildProbeCoverageReport,
  formatProbeCoverageReport,
  type ProbeCoverageSample,
} from '../lib/reputation/aggregate';
import { createReputationStore, type ReputationStore } from '../lib/reputation/store';

function parseArgs(argv: string[]): { json: boolean; demo: boolean } {
  return {
    json: argv.includes('--json'),
    demo: argv.includes('--demo'),
  };
}

/** Deterministic sample set for local verification / CI smoke checks. */
export function buildDemoProbeSamples(now = new Date()): Map<string, ProbeCoverageSample[]> {
  const asOf = now.toISOString().slice(0, 10);
  const day = (offset: number): string => {
    const d = new Date(`${asOf}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - offset);
    return d.toISOString().slice(0, 10);
  };
  const at = (offset: number): string => `${day(offset)}T12:00:00.000Z`;

  const continuous = (_domain: string, fromOffset: number, throughOffset: number) => {
    const rows: ProbeCoverageSample[] = [];
    for (let o = fromOffset; o <= throughOffset; o++) {
      rows.push({ probedAt: at(o), kind: 'uptime' });
    }
    return rows;
  };

  return new Map<string, ProbeCoverageSample[]>([
    // 12-day streak, no gaps
    ['cowrie.exchange', continuous('cowrie.exchange', 0, 11)],
    // 5-day streak with an internal 2-day gap earlier in the window
    [
      'stellar.moneygram.com',
      [
        ...continuous('stellar.moneygram.com', 0, 2),
        ...continuous('stellar.moneygram.com', 8, 10),
      ],
    ],
  ]);
}

async function loadSamplesFromStore(store: ReputationStore): Promise<Map<string, ProbeCoverageSample[]>> {
  const rows = await store.queryProbeSamples(undefined, { kind: 'uptime' });
  const byDomain = new Map<string, ProbeCoverageSample[]>();
  for (const row of rows) {
    const list = byDomain.get(row.domain) ?? [];
    list.push({ probedAt: row.probedAt, kind: row.kind });
    byDomain.set(row.domain, list);
  }
  return byDomain;
}

export async function runProbeCoverageReport(options: {
  json?: boolean;
  demo?: boolean;
  now?: Date;
}): Promise<string> {
  const { json = false, demo = false, now = new Date() } = options;
  const anchors = anchorProbeDomains(ANCHORS);

  let samplesByDomain: Map<string, ProbeCoverageSample[]>;
  let store: ReputationStore | null = null;

  if (demo) {
    samplesByDomain = buildDemoProbeSamples(now);
  } else {
    store = createReputationStore();
    samplesByDomain = await loadSamplesFromStore(store);
  }

  const report = buildProbeCoverageReport(samplesByDomain, anchors, { now });

  if (store) {
    await store.close();
  }

  return json ? JSON.stringify(report, null, 2) : formatProbeCoverageReport(report);
}

async function main(): Promise<void> {
  const { json, demo } = parseArgs(process.argv.slice(2));
  const output = await runProbeCoverageReport({ json, demo });
  process.stdout.write(`${output}\n`);
}

const isMain =
  typeof process.argv[1] === 'string' &&
  (process.argv[1].endsWith('probe-coverage-report.ts') ||
    process.argv[1].endsWith('probe-coverage-report.js'));

if (isMain) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${msg}\n`);
    process.exit(1);
  });
}
