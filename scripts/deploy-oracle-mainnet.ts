/**
 * Build and optionally submit mainnet Soroban deployment transactions for the
 * Stellar Intel reputation oracle.
 *
 * Required env:
 *   MAINNET_DEPLOYER_KEY - secret key for the funded mainnet deployer account
 *
 * Optional env:
 *   MAINNET_RPC_URL      - Soroban RPC endpoint
 *                          (default: https://mainnet.sorobanrpc.com)
 *   ORACLE_WASM_PATH     - path to the compiled reputation contract WASM
 *   ORACLE_WASM_HASH     - hex hash returned by a prior upload transaction
 *   ORACLE_DEPLOY_SALT   - 32-byte hex salt for deterministic deploys
 *
 * Examples:
 *   tsx --tsconfig tsconfig.scripts.json scripts/deploy-oracle-mainnet.ts --mode upload-wasm --dry-run
 *   tsx --tsconfig tsconfig.scripts.json scripts/deploy-oracle-mainnet.ts --mode upload-wasm --live
 *   tsx --tsconfig tsconfig.scripts.json scripts/deploy-oracle-mainnet.ts --mode deploy-contract --wasm-hash <64 hex> --live
 */

import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import {
  Address,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  rpc,
  scValToNative,
  type Transaction,
} from '@stellar/stellar-sdk';

const DEFAULT_RPC_URL = 'https://mainnet.sorobanrpc.com';
const DEFAULT_WASM_PATH = path.join(
  'contracts',
  'reputation',
  'target',
  'wasm32-unknown-unknown',
  'release',
  'reputation.wasm'
);
const TX_TIMEOUT_SECONDS = 300;
const POLL_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 2000;

type Mode = 'upload-wasm' | 'deploy-contract';

type CliArgs = {
  dryRun: boolean;
  live: boolean;
  mode: Mode | null;
  wasmHash: string | null;
  wasmPath: string;
  salt: string | null;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    dryRun: false,
    live: false,
    mode: null,
    wasmHash: process.env['ORACLE_WASM_HASH'] ?? null,
    wasmPath: process.env['ORACLE_WASM_PATH'] ?? DEFAULT_WASM_PATH,
    salt: process.env['ORACLE_DEPLOY_SALT'] ?? null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (arg === '--live') {
      args.live = true;
      continue;
    }
    if (arg === '--mode') {
      args.mode = parseMode(readRequiredValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === '--wasm-hash') {
      args.wasmHash = readRequiredValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--wasm-path') {
      args.wasmPath = readRequiredValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--salt') {
      args.salt = readRequiredValue(argv, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (args.live && args.dryRun) {
    throw new Error('Choose either --dry-run or --live, not both.');
  }

  if (!args.live) {
    args.dryRun = true;
  }

  if (!args.mode) {
    throw new Error('Missing --mode. Use "upload-wasm" or "deploy-contract".');
  }

  return args;
}

function parseMode(value: string): Mode {
  if (value === 'upload-wasm' || value === 'deploy-contract') return value;
  throw new Error(`Invalid --mode "${value}". Use "upload-wasm" or "deploy-contract".`);
}

function readRequiredValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function printUsage(): void {
  console.log(`Usage:
  tsx --tsconfig tsconfig.scripts.json scripts/deploy-oracle-mainnet.ts --mode upload-wasm [--dry-run|--live]
  tsx --tsconfig tsconfig.scripts.json scripts/deploy-oracle-mainnet.ts --mode deploy-contract --wasm-hash <64 hex> [--dry-run|--live]

Options:
  --mode upload-wasm       Build a Soroban WASM upload transaction.
  --mode deploy-contract   Build a contract creation transaction from an uploaded WASM hash.
  --dry-run                Print the prepared transaction XDR and exit. This is the default.
  --live                   Require interactive "yes", then sign and submit.
  --wasm-path <path>       Contract WASM path for upload mode.
  --wasm-hash <64 hex>     Uploaded WASM hash for deploy mode.
  --salt <64 hex>          Deterministic 32-byte deploy salt. Random when omitted.
`);
}

function requireMainnetDeployer(): Keypair {
  const secret = process.env['MAINNET_DEPLOYER_KEY'];
  if (!secret) {
    throw new Error('MAINNET_DEPLOYER_KEY is required.');
  }
  return Keypair.fromSecret(secret);
}

async function loadWasm(wasmPath: string): Promise<Buffer> {
  const resolvedPath = path.resolve(wasmPath);
  if (!existsSync(resolvedPath)) {
    throw new Error(
      `Contract WASM not found at ${resolvedPath}. Build the contract first or pass --wasm-path.`
    );
  }
  return readFile(resolvedPath);
}

function readHash(value: string | null): Buffer {
  if (!value) {
    throw new Error('deploy-contract mode requires --wasm-hash or ORACLE_WASM_HASH.');
  }
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error('WASM hash must be a 64-character hex string.');
  }
  return Buffer.from(value, 'hex');
}

function readSalt(value: string | null): Buffer {
  if (value === null) {
    return randomBytes(32);
  }
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error('Deploy salt must be a 64-character hex string.');
  }
  return Buffer.from(value, 'hex');
}

async function buildPreparedTransaction(
  server: rpc.Server,
  deployer: Keypair,
  args: CliArgs
): Promise<{
  tx: Transaction;
  wasmSha256: string | null;
  saltHex: string | null;
}> {
  const account = await server.getAccount(deployer.publicKey());

  let operation;
  let wasmSha256: string | null = null;
  let saltHex: string | null = null;

  if (args.mode === 'upload-wasm') {
    const wasm = await loadWasm(args.wasmPath);
    wasmSha256 = createHash('sha256').update(wasm).digest('hex');
    operation = Operation.uploadContractWasm({ wasm });
  } else {
    const salt = readSalt(args.salt);
    saltHex = salt.toString('hex');
    operation = Operation.createCustomContract({
      address: Address.fromString(deployer.publicKey()),
      wasmHash: readHash(args.wasmHash),
      salt,
    });
  }

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.PUBLIC,
  })
    .addOperation(operation)
    .setTimeout(TX_TIMEOUT_SECONDS)
    .build();

  const preparedTx = await server.prepareTransaction(tx);
  preparedTx.sign(deployer);

  return { tx: preparedTx, wasmSha256, saltHex };
}

function printPreparedTransaction(details: {
  tx: Transaction;
  mode: Mode;
  deployer: string;
  rpcUrl: string;
  dryRun: boolean;
  wasmSha256: string | null;
  saltHex: string | null;
}): void {
  console.log(`Network:  mainnet`);
  console.log(`RPC:      ${details.rpcUrl}`);
  console.log(`Mode:     ${details.mode}`);
  console.log(`Deployer: ${details.deployer}`);
  console.log(`Fee:      ${details.tx.fee} stroops`);
  if (details.wasmSha256) console.log(`WASM SHA-256: ${details.wasmSha256}`);
  if (details.saltHex) console.log(`Deploy salt: ${details.saltHex}`);
  console.log(`Dry-run:  ${details.dryRun ? 'yes' : 'no'}`);
  console.log('\nPrepared transaction XDR:');
  console.log(details.tx.toEnvelope().toXDR('base64').toString());
}

async function confirmLiveSubmit(): Promise<void> {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question('\nType "yes" to broadcast this mainnet transaction: ');
    if (answer !== 'yes') {
      throw new Error('Mainnet broadcast cancelled.');
    }
  } finally {
    rl.close();
  }
}

async function submitAndWait(server: rpc.Server, tx: Transaction): Promise<void> {
  const submitted = await server.sendTransaction(tx);
  console.log(`\nSubmission status: ${submitted.status}`);
  console.log(`Transaction hash:  ${submitted.hash}`);

  if (submitted.status === 'ERROR') {
    throw new Error('Mainnet RPC rejected the transaction.');
  }

  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    await sleep(POLL_INTERVAL_MS);
    const result = await server.getTransaction(submitted.hash);
    if (result.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
      continue;
    }
    if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Transaction failed in ledger ${result.ledger}.`);
    }

    console.log(`Confirmed in ledger: ${result.ledger}`);
    if (result.returnValue) {
      console.log(`Return value: ${String(scValToNative(result.returnValue))}`);
    }
    return;
  }

  throw new Error(`Timed out waiting for ${submitted.hash} to confirm.`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const deployer = requireMainnetDeployer();
  const rpcUrl = process.env['MAINNET_RPC_URL'] ?? DEFAULT_RPC_URL;
  const server = new rpc.Server(rpcUrl);
  const { tx, wasmSha256, saltHex } = await buildPreparedTransaction(server, deployer, args);

  printPreparedTransaction({
    tx,
    mode: args.mode!,
    deployer: deployer.publicKey(),
    rpcUrl,
    dryRun: args.dryRun,
    wasmSha256,
    saltHex,
  });

  if (args.dryRun) {
    console.log('\nDry-run only: transaction was not submitted.');
    return;
  }

  await confirmLiveSubmit();
  await submitAndWait(server, tx);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
