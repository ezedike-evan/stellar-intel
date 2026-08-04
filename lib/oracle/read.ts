/**
 * Read-only Soroban client for the reputation oracle contract
 * (contracts/reputation/src/lib.rs). Every export here is a pure
 * `simulateTransaction` call — no signing, no submission, no dependency on a
 * funded account — generalizing the pattern proven in
 * packages/publisher/tests/e2e.spec.ts's `countOnChain()` helper.
 *
 * Testnet only for now; mainnet oracle deployment is a separate roadmap gate
 * (see docs/ORACLE_SPEC.md). Defaults match the recorded testnet deployment
 * in .deployments/testnet.json and app/api/publisher/tick/route.ts.
 */
import {
  Account,
  BASE_FEE,
  Contract,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
  type xdr,
} from '@stellar/stellar-sdk';

// Sourced from .deployments/testnet.json rather than hardcoded (#723).
import { resolveOracleContractId } from './deployment';
const DEFAULT_RPC_URL = 'https://soroban-testnet.stellar.org';
const DEFAULT_NETWORK_PASSPHRASE = Networks.TESTNET;

// A well-formed but unfunded, never-signed account. simulateTransaction only
// needs a syntactically valid source account to build the envelope for a
// read-only invocation — it's never checked against ledger state, signed, or
// submitted, so this never needs to be a real, funded account.
const SIMULATION_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

export interface OracleReadConfig {
  contractId?: string;
  rpcUrl?: string;
  networkPassphrase?: string;
}

function resolveConfig(config: OracleReadConfig): Required<OracleReadConfig> {
  return {
    contractId: resolveOracleContractId(config.contractId),
    rpcUrl: config.rpcUrl ?? process.env.SOROBAN_RPC_URL ?? DEFAULT_RPC_URL,
    networkPassphrase:
      config.networkPassphrase ??
      process.env.STELLAR_NETWORK_PASSPHRASE ??
      DEFAULT_NETWORK_PASSPHRASE,
  };
}

async function simulateRead(
  method: string,
  args: xdr.ScVal[],
  config: OracleReadConfig
): Promise<unknown> {
  const { contractId, rpcUrl, networkPassphrase } = resolveConfig(config);
  const server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });
  const contract = new Contract(contractId);
  const account = new Account(SIMULATION_SOURCE, '0');

  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Oracle read "${method}" simulation failed: ${sim.error}`);
  }
  const retval = sim.result?.retval;
  return retval === undefined ? undefined : scValToNative(retval);
}

export interface CorridorAggregate {
  total: number;
  successes: number;
  settleSecondsSum: number;
}

/** `get_corridor_aggregate(anchor_id, corridor) -> (total, successes, settle_seconds_sum)`. */
export async function getCorridorAggregate(
  anchorId: string,
  corridor: string,
  config: OracleReadConfig = {}
): Promise<CorridorAggregate | null> {
  const result = await simulateRead(
    'get_corridor_aggregate',
    [nativeToScVal(anchorId, { type: 'string' }), nativeToScVal(corridor, { type: 'string' })],
    config
  );
  if (!Array.isArray(result) || result.length !== 3) return null;
  const [total, successes, settleSecondsSum] = result as [bigint, bigint, bigint];
  return {
    total: Number(total),
    successes: Number(successes),
    settleSecondsSum: Number(settleSecondsSum),
  };
}

export interface CorridorScore {
  compositeBps: number;
  fillRateBps: number;
  settleSecondsP50: number;
  n: number;
}

/** `get_score_for_corridor(anchor_id, corridor) -> (composite_bps, fill_rate_bps, settle_seconds_p50, n)`. */
export async function getScoreForCorridor(
  anchorId: string,
  corridor: string,
  config: OracleReadConfig = {}
): Promise<CorridorScore | null> {
  const result = await simulateRead(
    'get_score_for_corridor',
    [nativeToScVal(anchorId, { type: 'string' }), nativeToScVal(corridor, { type: 'string' })],
    config
  );
  if (!Array.isArray(result) || result.length !== 4) return null;
  const [compositeBps, fillRateBps, settleSecondsP50, n] = result as [
    bigint,
    bigint,
    bigint,
    number,
  ];

  // The contract returns a zeroed tuple for an (anchor, corridor) pair it has
  // never seen, which is indistinguishable from a genuine score of zero. Report
  // it as absent instead (#723).
  //
  // This is not hypothetical: the deployed testnet contract currently has an
  // empty anchor registry, so every read returns zeros. Surfacing those as real
  // scores would put a confident "0" next to every anchor in the demo.
  const sampleCount = Number(n);
  if (sampleCount === 0) return null;

  return {
    compositeBps: Number(compositeBps),
    fillRateBps: Number(fillRateBps),
    settleSecondsP50: Number(settleSecondsP50),
    n: sampleCount,
  };
}

/** `list_anchors() -> Vec<String>`. */
export async function listAnchors(config: OracleReadConfig = {}): Promise<string[]> {
  const result = await simulateRead('list_anchors', [], config);
  return Array.isArray(result) ? (result as string[]) : [];
}

// ── V2 entrypoints (multi-corridor expansion, issue #825) ────────────────

export interface CorridorScoreV2 {
  compositeBps: number;
  fillRateBps: number;
  slippageBps: number;
  settleSecondsP50: number;
  n: number;
}

/**
 * `get_score_for_corridor_v2(anchor_id, corridor) -> (composite_bps, fill_rate_bps, slippage_bps, settle_seconds_p50, n)`.
 * Falls back to v1 entrypoint if v2 is not available on the deployed contract.
 */
export async function getScoreForCorridorV2(
  anchorId: string,
  corridor: string,
  config: OracleReadConfig = {}
): Promise<CorridorScoreV2 | null> {
  try {
    const result = await simulateRead(
      'get_score_for_corridor_v2',
      [nativeToScVal(anchorId, { type: 'string' }), nativeToScVal(corridor, { type: 'string' })],
      config
    );
    if (!Array.isArray(result) || result.length !== 5) return null;
    const [compositeBps, fillRateBps, slippageBps, settleSecondsP50, n] = result as [
      bigint,
      bigint,
      bigint,
      bigint,
      number,
    ];
    return {
      compositeBps: Number(compositeBps),
      fillRateBps: Number(fillRateBps),
      slippageBps: Number(slippageBps),
      settleSecondsP50: Number(settleSecondsP50),
      n: Number(n),
    };
  } catch {
    const v1 = await getScoreForCorridor(anchorId, corridor, config);
    if (!v1) return null;
    return {
      compositeBps: v1.compositeBps,
      fillRateBps: v1.fillRateBps,
      slippageBps: 0,
      settleSecondsP50: v1.settleSecondsP50,
      n: v1.n,
    };
  }
}

/**
 * `get_corridor_aggregate_v2(anchor_id, corridor) -> (total, successes, settle_seconds_sum)`.
 * Falls back to v1 entrypoint if v2 is not available on the deployed contract.
 */
export async function getCorridorAggregateV2(
  anchorId: string,
  corridor: string,
  config: OracleReadConfig = {}
): Promise<CorridorAggregate | null> {
  try {
    const result = await simulateRead(
      'get_corridor_aggregate_v2',
      [nativeToScVal(anchorId, { type: 'string' }), nativeToScVal(corridor, { type: 'string' })],
      config
    );
    if (!Array.isArray(result) || result.length !== 3) return null;
    const [total, successes, settleSecondsSum] = result as [bigint, bigint, bigint];
    return {
      total: Number(total),
      successes: Number(successes),
      settleSecondsSum: Number(settleSecondsSum),
    };
  } catch {
    return getCorridorAggregate(anchorId, corridor, config);
  }
}

// ── Volume + savings oracle (issue #826) ────────────────────────────────

export interface VolumeSavings {
  volumeUsdc: number;
  savingsUsdc: number;
  settlementCount: number;
  updatedAt: number;
}

/**
 * `get_volume_savings(corridor) -> { volume_usdc, savings_usdc, settlement_count, updated_at } | null`.
 * Reads the cumulative on-chain volume and estimated savings for a corridor.
 * Returns `null` when no data has been published for that corridor yet.
 */
export async function getVolumeSavings(
  corridor: string,
  config: OracleReadConfig = {}
): Promise<VolumeSavings | null> {
  const result = await simulateRead(
    'get_volume_savings',
    [nativeToScVal(corridor, { type: 'string' })],
    config
  );
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  if (r.volume_usdc === undefined && r.volumeUsdc === undefined) return null;
  const volumeUsdc = Number(
    (r as { volume_usdc?: bigint; volumeUsdc?: bigint }).volume_usdc ??
      (r as { volume_usdc?: bigint; volumeUsdc?: bigint }).volumeUsdc ??
      0n
  );
  const savingsUsdc = Number(
    (r as { savings_usdc?: bigint; savingsUsdc?: bigint }).savings_usdc ??
      (r as { savings_usdc?: bigint; savingsUsdc?: bigint }).savingsUsdc ??
      0n
  );
  const settlementCount = Number(
    (r as { settlement_count?: number; settlementCount?: number }).settlement_count ??
      (r as { settlement_count?: number; settlementCount?: number }).settlementCount ??
      0
  );
  const updatedAt = Number(
    (r as { updated_at?: bigint; updatedAt?: bigint }).updated_at ??
      (r as { updated_at?: bigint; updatedAt?: bigint }).updatedAt ??
      0n
  );
  return { volumeUsdc, savingsUsdc, settlementCount, updatedAt };
}

/**
 * Governance configuration of the deployed contract (#913).
 *
 * Multisig needs no contract change — the admin is an `Address`, so it may be a
 * Stellar account with several signers and a threshold, and `require_auth()`
 * delegates the threshold check to the host. What matters operationally is
 * *which* accounts these are, and whether the upgrade authority is genuinely
 * separate from the operational admin. This reads that back rather than
 * assuming it.
 */
export interface OracleGovernance {
  admin: string | null;
  pendingAdmin: string | null;
  upgradeAdmin: string | null;
  contractVersion: number;
  /** False when one account holds both operational and upgrade authority. */
  authoritiesSeparated: boolean;
  /**
   * Entrypoints this contract does not implement.
   *
   * A deployed contract can be older than the source in this repo, and the
   * difference is exactly what a pre-flight needs to surface: the testnet
   * deployment predates `pending_admin`, so it also predates the authorization
   * fixes in #907 and still carries the unauthenticated write path.
   */
  missingEntrypoints: string[];
}

/**
 * True when a simulation error means the contract has no such function, as
 * opposed to the read failing for some other reason.
 *
 * Exported so the classification is testable without mocking the Stellar SDK's
 * transaction-building internals.
 */
export function isMissingEntrypointError(message: string): boolean {
  return message.includes('MissingValue') || message.includes('non-existent contract function');
}

/**
 * Builds the governance summary from already-read values.
 *
 * Separated from the RPC calls so the interesting part — deciding whether the
 * two authorities are genuinely distinct — is testable directly.
 */
export function deriveGovernance(
  values: {
    admin: unknown;
    pendingAdmin: unknown;
    upgradeAdmin: unknown;
    contractVersion: unknown;
  },
  missingEntrypoints: string[]
): OracleGovernance {
  const admin = typeof values.admin === 'string' ? values.admin : null;
  const upgradeAdmin = typeof values.upgradeAdmin === 'string' ? values.upgradeAdmin : null;

  return {
    admin,
    pendingAdmin: typeof values.pendingAdmin === 'string' ? values.pendingAdmin : null,
    upgradeAdmin,
    contractVersion: Number(values.contractVersion ?? 0),
    // Both unset counts as not separated: an uninitialised upgrade hook is not
    // a separation of duties, it is an absence of one.
    authoritiesSeparated: admin !== null && upgradeAdmin !== null && admin !== upgradeAdmin,
    missingEntrypoints,
  };
}

/** Reads one entrypoint, distinguishing "not implemented" from "read failed". */
async function readOptional(
  method: string,
  config: OracleReadConfig,
  missing: string[]
): Promise<unknown> {
  try {
    return await simulateRead(method, [], config);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The host reports a call to an absent function as MissingValue.
    if (isMissingEntrypointError(message)) {
      missing.push(method);
      return undefined;
    }
    throw err;
  }
}

export async function getOracleGovernance(
  config: OracleReadConfig = {}
): Promise<OracleGovernance> {
  const missingEntrypoints: string[] = [];

  const [admin, pendingAdmin, upgradeAdmin, contractVersion] = await Promise.all([
    readOptional('admin', config, missingEntrypoints),
    readOptional('pending_admin', config, missingEntrypoints),
    readOptional('upgrade_admin', config, missingEntrypoints),
    readOptional('contract_version', config, missingEntrypoints),
  ]);

  return deriveGovernance(
    { admin, pendingAdmin, upgradeAdmin, contractVersion },
    missingEntrypoints
  );
}
