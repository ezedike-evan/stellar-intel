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

const DEFAULT_ORACLE_CONTRACT_ID = 'CCZ54NTEOVL2DKWCGJA5XHTHOGRDS7JHFKYWEC6QH2IMZLYNM3FBFKDG';
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
    contractId: config.contractId ?? process.env.ORACLE_CONTRACT_ID ?? DEFAULT_ORACLE_CONTRACT_ID,
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
  return {
    compositeBps: Number(compositeBps),
    fillRateBps: Number(fillRateBps),
    settleSecondsP50: Number(settleSecondsP50),
    n: Number(n),
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
