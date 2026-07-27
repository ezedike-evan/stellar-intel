import fs from 'fs';
import path from 'path';

/**
 * Simple aggregator that reads executed intents from `tests/executed-intents.json`
 * and writes a per-corridor cumulative summary to `packages/onchain-oracle/data/summary.json`.
 *
 * The executed-intents file should be an array of objects:
 * [{ "corridor": "USD->EUR:anchor.id", "amount": "100000", "baseline_fee": "1000", "actual_fee": "650" }, ...]
 *
 * Methodology: fees_saved = baseline_fee - actual_fee per intent. Baseline must be provided per-intent by the reconciler.
 */

type IntentExec = {
  corridor: string;
  amount: string; // in smallest units
  baseline_fee: string;
  actual_fee: string;
};

export function computeSummaryFromIntents(intents: IntentExec[]) {
  const summary: Record<string, { volume: bigint; savings: bigint }> = {};

  for (const it of intents) {
    const corridor = it.corridor;
    const amt = BigInt(it.amount);
    const baseline = BigInt(it.baseline_fee);
    const actual = BigInt(it.actual_fee);
    const saved = baseline > actual ? (baseline - actual) : BigInt(0);
    if (!summary[corridor]) summary[corridor] = { volume: BigInt(0), savings: BigInt(0) };
    summary[corridor].volume += amt;
    summary[corridor].savings += saved;
  }

  const result: any = {
    generatedAt: new Date().toISOString(),
    source: 'executed-intents',
    corridors: {},
  };

  for (const k of Object.keys(summary)) {
    result.corridors[k] = {
      volume: summary[k].volume.toString(),
      savings: summary[k].savings.toString(),
    };
  }

  return result;
}

export function writeSummaryToOnchainPackage(summary: any) {
  const outPath = path.resolve(__dirname, '..', 'packages', 'onchain-oracle', 'data', 'summary.json');
  // ensure dir exists
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');
}

// CLI helper
if (require.main === module) {
  const testPath = path.resolve(process.cwd(), 'tests', 'executed-intents.json');
  if (!fs.existsSync(testPath)) {
    console.error('No tests/executed-intents.json found. Create one to run the aggregator.');
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(testPath, 'utf8'));
  const summary = computeSummaryFromIntents(raw as IntentExec[]);
  writeSummaryToOnchainPackage(summary);
  console.log('Wrote summary to packages/onchain-oracle/data/summary.json');
}
