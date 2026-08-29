/**
 * Mainnet launch preflight (#803).
 *
 * Checks every precondition that can be checked mechanically, and prints the
 * ones that cannot as explicit manual sign-offs rather than leaving them
 * implied. Exits non-zero if any mechanical gate fails.
 *
 *   npx tsx scripts/mainnet-preflight.mts
 *
 * This does not deploy anything. See docs/MAINNET_LAUNCH.md for the runbook.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { Keypair } from '@stellar/stellar-sdk';
import { getOracleGovernance, listAnchors } from '../lib/oracle/read.js';

type Status = 'pass' | 'fail' | 'manual';

interface Check {
  name: string;
  status: Status;
  detail: string;
}

const results: Check[] = [];

function record(name: string, status: Status, detail: string): void {
  results.push({ name, status, detail });
  // Printed as it happens, not batched at the end: the contract build alone
  // takes minutes, and a silent run is indistinguishable from a hung one.
  const mark = status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : 'MANUAL';
  console.log(`  [${mark.padEnd(6)}] ${name} — ${detail}`);
}

function tryExec(command: string, args: string[]): { ok: boolean; output: string } {
  try {
    const output = execFileSync(command, args, { encoding: 'utf8', stdio: 'pipe' });
    return { ok: true, output };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, output: e.stdout ?? e.stderr ?? e.message ?? 'unknown failure' };
  }
}

// ─── 1. The contract builds and its tests pass ────────────────────────────────

function checkContract(): void {
  if (process.argv.includes('--skip-contract')) {
    record(
      'Contract tests pass',
      'manual',
      'skipped via --skip-contract; CI runs this on every PR (#908)'
    );
    return;
  }

  console.log('  ... building and testing the contract (slow)');
  const test = tryExec('cargo', [
    'test',
    '--manifest-path',
    'contracts/reputation/Cargo.toml',
    '--locked',
  ]);
  record(
    'Contract tests pass',
    test.ok ? 'pass' : 'fail',
    test.ok ? 'cargo test --locked green' : 'cargo test failed — see output above'
  );

  const wasm = tryExec('cargo', [
    'build',
    '--manifest-path',
    'contracts/reputation/Cargo.toml',
    '--target',
    'wasm32-unknown-unknown',
    '--release',
    '--locked',
  ]);
  record(
    'Deployable wasm builds',
    wasm.ok ? 'pass' : 'fail',
    wasm.ok ? 'release wasm built' : 'wasm build failed'
  );
}

// ─── 2. Environment is configured for mainnet, explicitly ─────────────────────

function checkEnvironment(): void {
  const network = process.env['STELLAR_NETWORK'];
  record(
    'STELLAR_NETWORK is explicit',
    network === 'mainnet' ? 'pass' : 'fail',
    network
      ? `STELLAR_NETWORK=${network}`
      : 'unset — the publisher refuses to guess a network (#912)'
  );

  for (const key of ['MAINNET_DEPLOYER_KEY', 'PUBLISHER_SECRET', 'DATABASE_URL'] as const) {
    record(
      `${key} is set`,
      process.env[key] ? 'pass' : 'fail',
      process.env[key] ? 'present' : 'missing'
    );
  }
}

// ─── 3. There is data to seed with ────────────────────────────────────────────

async function checkProbeData(): Promise<void> {
  // "Never launch an empty credit bureau" is the whole point of the 90-day
  // gate, so this is a hard gate rather than a warning.
  if (!process.env['DATABASE_URL']) {
    record('Probe data accumulated', 'fail', 'no DATABASE_URL, cannot check');
    return;
  }

  try {
    const { getSqlExecutor } = await import('../lib/reputation/pool.js');
    const { PROBE_MAINNET_READINESS_DAYS } = await import('../lib/reputation/aggregate.js');
    const { rows } = await getSqlExecutor().query(
      `SELECT count(*) AS samples,
              min(probed_at) AS earliest
         FROM probe_samples`
    );
    const row = rows[0] as { samples: string | number; earliest: string | null } | undefined;
    const samples = Number(row?.samples ?? 0);

    if (samples === 0 || !row?.earliest) {
      record(
        'Probe data accumulated',
        'fail',
        'probe_samples is empty — the accumulation clock has not started (see #906)'
      );
      return;
    }

    const days = Math.floor((Date.now() - new Date(row.earliest).getTime()) / 86_400_000);
    const enough = days >= PROBE_MAINNET_READINESS_DAYS;
    record(
      'Probe data accumulated',
      enough ? 'pass' : 'fail',
      `${samples} samples over ${days}d (need ${PROBE_MAINNET_READINESS_DAYS}d)`
    );
  } catch (err) {
    record(
      'Probe data accumulated',
      'fail',
      `query failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

// ─── 4. Whatever is already deployed is understood ────────────────────────────

async function checkExistingDeployment(): Promise<void> {
  try {
    const gov = await getOracleGovernance();

    record(
      'Deployed bytecode matches source',
      gov.missingEntrypoints.length === 0 ? 'pass' : 'fail',
      gov.missingEntrypoints.length === 0
        ? 'all expected entrypoints present'
        : `missing ${gov.missingEntrypoints.join(', ')} — deployed code predates the source`
    );

    record(
      'Admin and upgrade admin are distinct',
      gov.authoritiesSeparated ? 'pass' : 'fail',
      gov.authoritiesSeparated
        ? `admin=${gov.admin}, upgradeAdmin=${gov.upgradeAdmin}`
        : 'one account holds both roles, or the upgrade hook is uninitialised'
    );

    const publisherSecret = process.env['PUBLISHER_SECRET'];
    if (publisherSecret) {
      try {
        const publisherPubKey = Keypair.fromSecret(publisherSecret).publicKey();
        if (gov.admin === null) {
          record(
            'Publisher is not the contract admin',
            'fail',
            'admin() returned null — cannot verify separation; an uninitialised admin is not a separation of duties'
          );
        } else {
          const sameAsAdmin = publisherPubKey === gov.admin;
          record(
            'Publisher is not the contract admin',
            sameAsAdmin ? 'fail' : 'pass',
            sameAsAdmin
              ? `PUBLISHER_SECRET is the contract admin (${publisherPubKey}) — ` +
                'generate a dedicated publisher account, authorize it with add_publisher, ' +
                'and set PUBLISHER_SECRET to that account; the admin key must not exist in any deployment environment'
              : `publisher=${publisherPubKey}`
          );
        }
      } catch (err) {
        record(
          'Publisher is not the contract admin',
          'fail',
          `could not derive public key from PUBLISHER_SECRET: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    const anchors = await listAnchors();
    record(
      'Anchor registry is seeded',
      anchors.length > 0 ? 'pass' : 'fail',
      anchors.length > 0
        ? `${anchors.length} anchors registered`
        : 'empty — run scripts/init-oracle-registry.ts'
    );
  } catch (err) {
    record(
      'Existing deployment readable',
      'fail',
      `oracle read failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

// ─── 5. Things a script cannot decide ─────────────────────────────────────────

function recordManualGates(): void {
  record(
    'Soroban Security Audit Bank audit complete',
    'manual',
    'Track in #716/#717. A script cannot know this.'
  );
  record(
    'Admin keys held in HSM/KMS',
    'manual',
    'docs/SECURITY.md requires it. Verify custody out of band, then confirm the ' +
      'on-chain addresses with scripts/verify-oracle-read.mts.'
  );
  record(
    'Rollback plan rehearsed',
    'manual',
    'See docs/MAINNET_LAUNCH.md — an upgrade cannot be undone by re-running the deploy.'
  );

  const runbook = 'docs/MAINNET_LAUNCH.md';
  record(
    'Runbook exists',
    existsSync(runbook) ? 'pass' : 'fail',
    existsSync(runbook) ? `${readFileSync(runbook, 'utf8').split('\n').length} lines` : 'missing'
  );
}

async function main(): Promise<void> {
  console.log('\nMainnet launch preflight\n');
  checkEnvironment();
  checkContract();
  await checkProbeData();
  await checkExistingDeployment();
  recordManualGates();

  const failures = results.filter((r) => r.status === 'fail');
  const manual = results.filter((r) => r.status === 'manual');

  console.log(
    `\n${results.length - failures.length - manual.length} passed, ` +
      `${failures.length} failed, ${manual.length} need a human.\n`
  );

  if (failures.length > 0) {
    console.error('Not ready for mainnet. Resolve the FAIL rows above.');
    process.exitCode = 1;
    return;
  }
  console.log('Mechanical gates clear. The MANUAL rows are still yours to sign off.');
}

main().catch((err: unknown) => {
  console.error(`Preflight crashed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
