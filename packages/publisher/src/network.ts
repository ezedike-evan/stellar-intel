// ─── Explicit network selection (Issue #912) ───────────────────────────────────
//
// The CLI used to default to mainnet: no STELLAR_NETWORK_PASSPHRASE meant
// 'Public Global Stellar Network', and no SOROBAN_RPC_URL meant
// mainnet.sorobanrpc.com. Meanwhile /api/publisher/tick defaulted to testnet.
// The same pipeline therefore pointed at different networks depending on how it
// was invoked, and a CLI run against a production database with a testnet key
// would have targeted mainnet by default.
//
// There is no safe default here, so there is no default. The network has to be
// named.

export type StellarNetwork = 'mainnet' | 'testnet';

export interface NetworkConfig {
  network: StellarNetwork;
  networkPassphrase: string;
  rpcUrl: string;
  horizonUrl: string;
}

const NETWORKS: Record<StellarNetwork, Omit<NetworkConfig, 'network'>> = {
  mainnet: {
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
    rpcUrl: 'https://mainnet.sorobanrpc.com',
    horizonUrl: 'https://horizon.stellar.org',
  },
  testnet: {
    networkPassphrase: 'Test SDF Network ; September 2015',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    horizonUrl: 'https://horizon-testnet.stellar.org',
  },
};

export function isStellarNetwork(value: string): value is StellarNetwork {
  return value === 'mainnet' || value === 'testnet';
}

/**
 * Resolves the network from `STELLAR_NETWORK`, which is **required**.
 *
 * Individual endpoints can still be overridden for a custom RPC or a local
 * quickstart, but the passphrase always follows the named network — overriding
 * the passphrase alone is how you end up signing a mainnet transaction while
 * believing you are on testnet.
 */
export function resolveNetwork(
  env: Record<string, string | undefined> = process.env
): NetworkConfig {
  const raw = env['STELLAR_NETWORK'];

  if (!raw) {
    throw new Error(
      'STELLAR_NETWORK is required and must be "mainnet" or "testnet". ' +
        'It has no default: the publisher signs real transactions, and guessing ' +
        'the network from a missing variable is how testnet keys end up pointed ' +
        'at mainnet.'
    );
  }

  if (!isStellarNetwork(raw)) {
    throw new Error(`STELLAR_NETWORK must be "mainnet" or "testnet", got "${raw}".`);
  }

  const preset = NETWORKS[raw];

  return {
    network: raw,
    networkPassphrase: preset.networkPassphrase,
    rpcUrl: env['SOROBAN_RPC_URL'] ?? preset.rpcUrl,
    horizonUrl: env['HORIZON_URL'] ?? preset.horizonUrl,
  };
}
