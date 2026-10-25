/**
 * Pure helpers for scripts/deploy-oracle-mainnet.ts.
 *
 * Split out so they can be unit-tested without running the script's `main()`,
 * which needs a funded deployer key and talks to an RPC node.
 */

import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { Address, Operation, StrKey } from '@stellar/stellar-sdk';

export const DEFAULT_WASM_PATH = path.join(
  'contracts',
  'reputation',
  'target',
  'wasm32-unknown-unknown',
  'release',
  'reputation.wasm'
);

export type Mode = 'upload-wasm' | 'deploy-contract';

export type CliArgs = {
  dryRun: boolean;
  live: boolean;
  mode: Mode | null;
  wasmHash: string | null;
  wasmPath: string;
  salt: string | null;
  /** Operational admin, bound by the contract constructor. Required to deploy. */
  admin: string | null;
  /** Upgrade admin, bound by the contract constructor. Required to deploy. */
  upgradeAdmin: string | null;
  /** True when `--help` was given; the caller prints usage and exits. */
  help: boolean;
};

export const USAGE = `Usage:
  tsx --tsconfig tsconfig.scripts.json scripts/deploy-oracle-mainnet.ts --mode upload-wasm [--dry-run|--live]
  tsx --tsconfig tsconfig.scripts.json scripts/deploy-oracle-mainnet.ts --mode deploy-contract --wasm-hash <64 hex> --admin <G...> --upgrade-admin <G...> [--dry-run|--live]

Options:
  --mode upload-wasm       Build a Soroban WASM upload transaction.
  --mode deploy-contract   Build a contract creation transaction from an uploaded WASM hash.
  --dry-run                Print the prepared transaction XDR and exit. This is the default.
  --live                   Require interactive "yes", then sign and submit.
  --wasm-path <path>       Contract WASM path for upload mode.
  --wasm-hash <64 hex>     Uploaded WASM hash for deploy mode.
  --admin <G...>           Operational admin, bound by __constructor. Deploy mode only.
                           Falls back to ORACLE_ADMIN.
  --upgrade-admin <G...>   Upgrade admin, bound by __constructor. Deploy mode only.
                           Falls back to ORACLE_UPGRADE_ADMIN. Must differ from --admin.
  --salt <64 hex>          Deterministic 32-byte deploy salt. Random when omitted.
`;

type Env = Record<string, string | undefined>;

export function parseArgs(argv: string[], env: Env = process.env): CliArgs {
  const args: CliArgs = {
    dryRun: false,
    live: false,
    mode: null,
    wasmHash: env['ORACLE_WASM_HASH'] ?? null,
    wasmPath: env['ORACLE_WASM_PATH'] ?? DEFAULT_WASM_PATH,
    salt: env['ORACLE_DEPLOY_SALT'] ?? null,
    admin: env['ORACLE_ADMIN'] ?? null,
    upgradeAdmin: env['ORACLE_UPGRADE_ADMIN'] ?? null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      return args;
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
    if (arg === '--admin') {
      args.admin = readRequiredValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--upgrade-admin') {
      args.upgradeAdmin = readRequiredValue(argv, index, arg);
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

  if (args.mode === 'deploy-contract') {
    // The contract's __constructor(admin, upgrade_admin) binds both authorities
    // at deploy. An instance deployed without them has neither bound.
    args.admin = requireAccount(args.admin, '--admin', 'ORACLE_ADMIN');
    args.upgradeAdmin = requireAccount(
      args.upgradeAdmin,
      '--upgrade-admin',
      'ORACLE_UPGRADE_ADMIN'
    );
    if (args.admin === args.upgradeAdmin) {
      throw new Error(
        '--admin and --upgrade-admin must be different accounts: the runbook keeps the two authorities separate.'
      );
    }
  }

  return args;
}

function requireAccount(value: string | null, flag: string, envName: string): string {
  if (!value) {
    throw new Error(`deploy-contract mode requires ${flag} (or ${envName}).`);
  }
  if (!StrKey.isValidEd25519PublicKey(value)) {
    throw new Error(`${flag} must be a valid Stellar public key (G...), got "${value}".`);
  }
  return value;
}

export function parseMode(value: string): Mode {
  if (value === 'upload-wasm' || value === 'deploy-contract') return value;
  throw new Error(`Invalid --mode "${value}". Use "upload-wasm" or "deploy-contract".`);
}

export function readRequiredValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

export function readHash(value: string | null): Buffer {
  if (!value) {
    throw new Error('deploy-contract mode requires --wasm-hash or ORACLE_WASM_HASH.');
  }
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error('WASM hash must be a 64-character hex string.');
  }
  return Buffer.from(value, 'hex');
}

export function readSalt(value: string | null): Buffer {
  if (value === null) {
    return randomBytes(32);
  }
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error('Deploy salt must be a 64-character hex string.');
  }
  return Buffer.from(value, 'hex');
}

/**
 * The create-contract operation for a fresh oracle instance, passing the two
 * constructor arguments the contract's `__constructor(admin, upgrade_admin)`
 * requires, in that order.
 */
export function buildDeployOperation(params: {
  deployer: string;
  wasmHash: Buffer;
  salt: Buffer;
  admin: string;
  upgradeAdmin: string;
}) {
  return Operation.createCustomContract({
    address: Address.fromString(params.deployer),
    wasmHash: params.wasmHash,
    salt: params.salt,
    constructorArgs: [
      new Address(params.admin).toScVal(),
      new Address(params.upgradeAdmin).toScVal(),
    ],
  });
}
