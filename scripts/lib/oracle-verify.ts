/**
 * Argument parsing for scripts/verify-oracle-read.mts, split out so it can be
 * unit-tested without running the script (which makes RPC calls).
 */

export type VerifyNetwork = 'mainnet' | 'testnet';

export interface VerifyArgs {
  /** Exit non-zero on a failed read instead of warning. */
  strict: boolean;
  /** The network to verify; decides which recorded deployment and RPC are used. */
  network: VerifyNetwork;
  /** Corridor to sample. */
  corridor: string;
}

const DEFAULT_CORRIDOR = 'usdc-ngn';

function parseNetwork(value: string | undefined, source: string): VerifyNetwork {
  if (value === 'mainnet' || value === 'testnet') return value;
  throw new Error(`Invalid ${source} "${value ?? ''}". Use "mainnet" or "testnet".`);
}

/**
 * `--network mainnet|testnet` wins; otherwise `NEXT_PUBLIC_STELLAR_NETWORK`;
 * otherwise testnet. An unset or empty variable is testnet, but a variable that
 * is set to something else (or a bad flag) is an error: verifying the wrong
 * network by accident is exactly what this script exists to prevent.
 */
export function parseVerifyArgs(
  argv: readonly string[],
  env: Record<string, string | undefined> = process.env
): VerifyArgs {
  const valueAfter = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    if (index === -1) return undefined;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${flag} requires a value.`);
    }
    return value;
  };

  const flagNetwork = valueAfter('--network');
  const envNetwork = env['NEXT_PUBLIC_STELLAR_NETWORK'];

  let network: VerifyNetwork;
  if (flagNetwork !== undefined) {
    network = parseNetwork(flagNetwork, '--network');
  } else if (envNetwork) {
    network = parseNetwork(envNetwork, 'NEXT_PUBLIC_STELLAR_NETWORK');
  } else {
    network = 'testnet';
  }

  return {
    strict: argv.includes('--strict'),
    network,
    corridor: valueAfter('--corridor') ?? DEFAULT_CORRIDOR,
  };
}
