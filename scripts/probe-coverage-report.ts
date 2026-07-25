#!/usr/bin/env tsx

import { createReputationStore } from '@/lib/reputation/store';
import { computeProbeCoverageReport } from '@/lib/reputation/aggregate';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    json: { type: 'boolean', short: 'j' },
  },
});

async function main() {
  const store = createReputationStore();
  const allSamples = await store.queryProbeSamples();
  const report = computeProbeCoverageReport(allSamples);

  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('=== Probe Coverage Report ===');
    console.log(`Generated at: ${report.generatedAt}`);
    console.log('');

    console.log('Aggregate Stats:');
    console.log(`- Days until 90-day threshold: ${report.daysUntilThreshold}`);
    console.log(`- Min continuous days across anchors: ${report.minContinuousDays}`);
    console.log(`- Max continuous days across anchors: ${report.maxContinuousDays}`);
    console.log(`- Avg continuous days across anchors: ${report.avgContinuousDays.toFixed(2)}`);
    console.log('');

    console.log('Anchor Coverage:');
    for (const anchor of report.anchors) {
      console.log(`- ${anchor.domain}:`);
      console.log(`  - Continuous days: ${anchor.continuousDays}`);
      console.log(`  - First probe: ${anchor.firstProbeDate || 'Never'}`);
      console.log(`  - Latest probe: ${anchor.latestProbeDate || 'Never'}`);
      if (anchor.gaps.length > 0) {
        console.log(`  - Coverage gaps (${anchor.gaps.length}):`);
        for (const gap of anchor.gaps) {
          console.log(`    - ${gap.startDate} to ${gap.endDate} (${gap.days} days)`);
        }
      }
    }
  }

  await store.close();
}

main().catch((err) => {
  console.error('Error generating report:', err);
  process.exit(1);
});
