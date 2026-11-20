/**
 * Build and optionally submit mainnet Soroban deployment transactions for the
 * Stellar Intel reputation oracle.
 *
 * Required env:
 *   MAINNET_DEPLOYER_KEY - secret key for the funded mainnet deployer account
 *
 * Optional env:
 *   MAINNET_RPC_URL        - Soroban RPC endpoint
 *                            (default: https://mainnet.sorobanrpc.com)
 *   ORACLE_WASM_PATH       - path to the compiled reputation contract WASM
 *   ORACLE_WASM_HASH       - hex hash returned by a prior upload transaction
 *   ORACLE_DEPLOY_SALT     - 32-byte hex salt for deterministic deploys
 *   ORACLE_ADMIN           - operational admin (G...), bound by __constructor
 *   ORACLE_UPGRADE_ADMIN   - upgrade admin (G...), bound by __constructor
 *
 * deploy-contract mode needs both admins, as flags or env, and they must be
 * different accounts: the contract's __constructor(admin, upgrade_admin) binds
 * them at deploy, and an instance deployed without them has neither authority.
 *
 * Examples:
 *   tsx --tsconfig tsconfig.scripts.json scripts/deploy-oracle-mainnet.ts --mode upload-wasm --dry-run
 *   tsx --tsconfig tsconfig.scripts.json scripts/deploy-oracle-mainnet.ts --mode upload-wasm --live
 *   tsx --tsconfig tsconfig.scripts.json scripts/deploy-oracle-mainnet.ts --mode deploy-contract --wasm-hash <64 hex> --admin <G...> --upgrade-admin <G...> --live
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import {
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  rpc,
  scValToNative,
  type Transaction,
} from '@stellar/stellar-sdk';

import {
  USAGE,
  buildDeployOperation,
  parseArgs,
  readHash,
  readSalt,
  type CliArgs,
  type Mode,
} from './lib/oracle-deploy';

const DEFAULT_RPC_URL = 'https://mainnet.sorobanrpc.com';
const TX_TIMEOUT_SECONDS = 300;
const POLL_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 2000;

function printUsage(): void {
  console.log(USAGE);
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
    operation = buildDeployOperation({
      deployer: deployer.publicKey(),
      wasmHash: readHash(args.wasmHash),
      salt,
      // parseArgs guarantees both in deploy-contract mode.
      admin: args.admin!,
      upgradeAdmin: args.upgradeAdmin!,
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
  admin: string | null;
  upgradeAdmin: string | null;
}): void {
  console.log(`Network:  mainnet`);
  console.log(`RPC:      ${details.rpcUrl}`);
  console.log(`Mode:     ${details.mode}`);
  console.log(`Deployer: ${details.deployer}`);
  console.log(`Fee:      ${details.tx.fee} stroops`);
  if (details.wasmSha256) console.log(`WASM SHA-256: ${details.wasmSha256}`);
  if (details.saltHex) console.log(`Deploy salt: ${details.saltHex}`);
  if (details.admin) console.log(`Admin:         ${details.admin}`);
  if (details.upgradeAdmin) console.log(`Upgrade admin: ${details.upgradeAdmin}`);
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
  if (args.help) {
    printUsage();
    return;
  }
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
    admin: args.mode === 'deploy-contract' ? args.admin : null,
    upgradeAdmin: args.mode === 'deploy-contract' ? args.upgradeAdmin : null,
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
