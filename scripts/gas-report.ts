/**
 * Gas report + regression gate for the reputation contract (issue #354).
 *
 * Runs the contract gas test, parses the `GAS_REPORT ...` lines it prints, and
 * compares each measurement against a committed baseline. CI fails when a
 * measurement regresses past the allowed tolerance (or blows past the absolute
 * ceiling), so a storage blowup cannot slip through unnoticed.
 *
 * Usage:
 *   tsx scripts/gas-report.ts            # measure and gate against the baseline
 *   tsx scripts/gas-report.ts --update   # (re)record the baseline, then gate
 *
 * Exit code is non-zero on regression, missing baseline, or test failure, so it
 * drops straight into a CI step.
 */

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const CONTRACT_DIR = resolve(REPO_ROOT, 'contracts', 'reputation');
const BASELINE_PATH = resolve(SCRIPT_DIR, 'gas-baseline.json');

/** Allowed growth over the baseline before a measurement counts as a regression. */
const TOLERANCE = 0.1;

/** Absolute ceilings, mirrored from contracts/reputation/tests/gas.rs. */
const MAX_CPU_INSTRUCTIONS = 20_000_000;
const MAX_MEMORY_BYTES = 5_000_000;

interface Measurement {
  cpu: number;
  mem: number;
}

type Report = Record<string, Measurement>;

function runGasTest(): string {
  try {
    return execFileSync(
      'cargo',
      ['test', '--test', 'gas', '--', '--nocapture', '--test-threads=1'],
      { cwd: CONTRACT_DIR, encoding: 'utf8' }
    );
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    // A failing assertion (a bound exceeded) still carries the GAS_REPORT lines
    // on stdout; surface stderr but let the caller parse what was measured.
    process.stderr.write(e.stderr ?? e.message ?? 'cargo test failed\n');
    if (!e.stdout) process.exit(1);
    return e.stdout;
  }
}

function parseReport(output: string): Report {
  const re = /GAS_REPORT entrypoint=(\S+) scenario=(\S+) cpu=(\d+) mem=(\d+)/g;
  const report: Report = {};
  for (const m of output.matchAll(re)) {
    const key = `${m[1]}:${m[2]}`;
    report[key] = { cpu: Number(m[3]), mem: Number(m[4]) };
  }
  return report;
}

function loadBaseline(): Report | null {
  if (!existsSync(BASELINE_PATH)) return null;
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Report;
}

function gate(report: Report, baseline: Report | null): string[] {
  const failures: string[] = [];

  for (const [key, m] of Object.entries(report)) {
    if (m.cpu > MAX_CPU_INSTRUCTIONS) {
      failures.push(`${key}: cpu ${m.cpu} exceeds ceiling ${MAX_CPU_INSTRUCTIONS}`);
    }
    if (m.mem > MAX_MEMORY_BYTES) {
      failures.push(`${key}: mem ${m.mem} exceeds ceiling ${MAX_MEMORY_BYTES}`);
    }

    const base = baseline?.[key];
    if (!base) continue;

    const cpuLimit = Math.ceil(base.cpu * (1 + TOLERANCE));
    const memLimit = Math.ceil(base.mem * (1 + TOLERANCE));
    if (m.cpu > cpuLimit) {
      failures.push(`${key}: cpu ${m.cpu} regressed past ${cpuLimit} (baseline ${base.cpu})`);
    }
    if (m.mem > memLimit) {
      failures.push(`${key}: mem ${m.mem} regressed past ${memLimit} (baseline ${base.mem})`);
    }
  }

  return failures;
}

function main(): void {
  const update = process.argv.includes('--update');

  const report = parseReport(runGasTest());
  if (Object.keys(report).length === 0) {
    console.error('gas-report: no GAS_REPORT lines found — did the gas test run?');
    process.exit(1);
  }

  console.log('Gas report:');
  for (const [key, m] of Object.entries(report)) {
    console.log(`  ${key}: cpu=${m.cpu} mem=${m.mem}`);
  }

  if (update) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`Baseline recorded at ${BASELINE_PATH}`);
  }

  const baseline = loadBaseline();
  if (!baseline && !update) {
    console.error('gas-report: no baseline found. Run with --update to record one.');
    process.exit(1);
  }

  const failures = gate(report, baseline);
  if (failures.length > 0) {
    console.error('\nGas regression detected:');
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }

  console.log('\nGas within bounds.');
}

main();
