import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const deploymentPath = resolve(process.cwd(), '.deployments', 'testnet.json');

if (existsSync(deploymentPath)) {
  try {
    const content = readFileSync(deploymentPath, 'utf8');
    const data = JSON.parse(content);
    const existingId =
      data.contractId || data.contract_id || data.id || data.address || data.contract;
    if (existingId) {
      console.log(`Contract already deployed on testnet at ${existingId}. No-op.`);
      process.exit(0);
    }
  } catch {
    console.warn(
      'Existing testnet.json is invalid or corrupted. Proceeding with fresh deployment...'
    );
  }
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

const deployCmd = `stellar contract deploy --wasm ${wasmPath} --source ${source} --network ${network}`;
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
