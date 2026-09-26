/**
 * Build + deploy the reputation oracle contract to testnet.
 *
 * The contract's `__constructor(admin, upgrade_admin)` binds both authorities
 * atomically at deploy time (contracts/reputation/src/lib.rs) — there is no
 * longer a separate `init_upgrade` call to make afterward. Deploying without
 * passing constructor args either fails outright or leaves both authorities
 * unbound, which is exactly the state issue #1149 found: `contract_version()`
 * stuck at 0 and `upgrade_admin` unset. See docs/ORACLE_SPEC.md § "Fresh
 * deploy" for the full runbook this script is one step of.
 *
 * Required env vars:
 *   ORACLE_ADMIN_ADDRESS          — operational admin (G…)
 *   ORACLE_UPGRADE_ADMIN_ADDRESS  — upgrade admin (G…) — must differ from the
 *                                   operational admin; see docs/ORACLE_SPEC.md
 *                                   § "Custody" for why conflating them is the
 *                                   mistake to avoid.
 *
 * Optional env vars:
 *   WASM_PATH               — path to the compiled contract WASM
 *   SOROBAN_NETWORK          — defaults to "testnet"
 *   SOROBAN_SOURCE_ACCOUNT / SOROBAN_ACCOUNT / ADMIN_SECRET_KEY
 *                            — funded deployer account (source of the deploy tx)
 *   FORCE_REDEPLOY=true      — required to proceed when .deployments/testnet.json
 *                              already names a contract; see below.
 */
import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const deploymentPath = resolve(process.cwd(), '.deployments', 'testnet.json');
const forceRedeploy = process.env.FORCE_REDEPLOY === 'true';

if (existsSync(deploymentPath)) {
  try {
    const content = readFileSync(deploymentPath, 'utf8');
    const data = JSON.parse(content);
    const existingId =
      data.contractId || data.contract_id || data.id || data.address || data.contract;
    if (existingId && !forceRedeploy) {
      // A prior version of this script no-op'd here unconditionally, which
      // meant the very tool meant to fix a stale testnet deployment (#1149)
      // could never actually redeploy over one. A fresh deploy always
      // produces a new contract ID with an empty anchor registry and empty
      // history — everything scripts/init-oracle-registry.ts and any prior
      // on-chain data provided has to be re-seeded/re-accepted as lost — so
      // this stays a deliberate, explicit choice rather than the default.
      console.log(
        `Contract already deployed on testnet at ${existingId}. ` +
          'Set FORCE_REDEPLOY=true to replace it with a fresh deploy (this abandons ' +
          'the existing contract and its on-chain state — anchors will need ' +
          're-registering via scripts/init-oracle-registry.ts). No-op.'
      );
      process.exit(0);
    }
    if (existingId && forceRedeploy) {
      console.log(`FORCE_REDEPLOY=true — replacing existing deployment at ${existingId}.`);
    }
  } catch {
    console.warn(
      'Existing testnet.json is invalid or corrupted. Proceeding with fresh deployment...'
    );
  }
}

const admin = process.env.ORACLE_ADMIN_ADDRESS;
const upgradeAdmin = process.env.ORACLE_UPGRADE_ADMIN_ADDRESS;

if (!admin) {
  console.error("ORACLE_ADMIN_ADDRESS is required (the operational admin's public address).");
  process.exit(1);
}
if (!upgradeAdmin) {
  console.error("ORACLE_UPGRADE_ADMIN_ADDRESS is required (the upgrade admin's public address).");
  process.exit(1);
}
if (admin === upgradeAdmin) {
  // The contract itself permits this (its constructor's doc comment says so
  // explicitly), but #1149 calls out the deployed testnet contract sharing one
  // account for both roles as a real risk: one compromised key can then both
  // forge data and replace the contract code. Distinct accounts by default;
  // an operator who genuinely wants them equal can still do so with the raw
  // `stellar contract deploy` invocation this script's output describes.
  console.error(
    'ORACLE_ADMIN_ADDRESS and ORACLE_UPGRADE_ADMIN_ADDRESS must be different accounts. ' +
      'See docs/ORACLE_SPEC.md § "Custody" for why.'
  );
  process.exit(1);
}

const deploymentsDir = resolve(process.cwd(), '.deployments');
if (!existsSync(deploymentsDir)) {
  mkdirSync(deploymentsDir, { recursive: true });
}

try {
  console.log('Building contract...');
  execSync('stellar contract build', {
    stdio: 'inherit',
    cwd: resolve(process.cwd(), 'contracts', 'reputation'),
  });
} catch {
  console.warn(
    'Warning: stellar contract build failed or not supported by environment. Proceeding to deploy...'
  );
}

const wasmPath =
  process.env.WASM_PATH || 'contracts/reputation/target/wasm32v1-none/release/reputation.wasm';
const network = process.env.SOROBAN_NETWORK || 'testnet';
const source =
  process.env.SOROBAN_SOURCE_ACCOUNT ||
  process.env.SOROBAN_ACCOUNT ||
  process.env.ADMIN_SECRET_KEY ||
  'default';

// Constructor args go after `--`: https://developers.stellar.org — a
// `stellar contract deploy` invocation forwards everything past `--` to the
// contract's `__constructor` as named parameters.
const deployCmd =
  `stellar contract deploy --wasm ${wasmPath} --source ${source} --network ${network} ` +
  `-- --admin ${admin} --upgrade_admin ${upgradeAdmin}`;
console.log(`Executing: ${deployCmd}`);

let output = '';
try {
  output = execSync(deployCmd, { encoding: 'utf8' }).trim();
} catch (error) {
  const err = error as any;
  console.error(`Failed to deploy contract: ${err.message || err}`);
  if (err.stdout) console.error(`stdout: ${err.stdout.toString()}`);
  if (err.stderr) console.error(`stderr: ${err.stderr.toString()}`);
  process.exit(1);
}

const lines = output
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean);
const contractId = lines[lines.length - 1];

if (!contractId) {
  console.error('Failed to parse contract ID from soroban-cli output.');
  process.exit(1);
}

console.log(`Contract successfully deployed to ${network}. Contract ID: ${contractId}`);
console.log(`Admin: ${admin}`);
console.log(`Upgrade admin: ${upgradeAdmin}`);

const deploymentData = {
  contractId: contractId,
  contract_id: contractId,
  id: contractId,
  address: contractId,
  contract: contractId,
  network: network,
  deployedAt: new Date().toISOString(),
};

writeFileSync(deploymentPath, JSON.stringify(deploymentData, null, 2) + '\n', 'utf8');
console.log(`Wrote deployment data to ${deploymentPath}`);
console.log(
  'Next: npx tsx scripts/init-oracle-registry.ts to seed the anchor registry, then ' +
    'npx tsx scripts/verify-oracle-read.mts to confirm no ::warning:: lines remain.'
);
