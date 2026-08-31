/**
 * MSW handlers for the reputation oracle's Soroban RPC endpoint.
 *
 * `lib/oracle/read.ts` reads the on-chain scorecard through a read-only
 * `simulateTransaction` JSON-RPC call to `SOROBAN_RPC_URL` (testnet by
 * default). Any route that surfaces `onChain` — `/api/reputation/leaderboard`
 * chief among them — therefore makes one live RPC round-trip per anchor, which
 * is exactly the outbound I/O a unit suite must not depend on.
 *
 * Fixture provenance (all recorded against https://soroban-testnet.stellar.org
 * on 2026-08-29, contract CCZ54NTEOVL2DKWCGJA5XHTHOGRDS7JHFKYWEC6QH2IMZLYNM3FBFKDG):
 *
 * - `simulate-score-unscored.json` — a verbatim response to
 *   `get_score_for_corridor("moneygram", "usdc-ngn")`. The contract is deployed
 *   but has no outcomes for that pair yet, so the return value is the all-zero
 *   tuple, which `getScoreForCorridor` reports as absent rather than as a real
 *   score of zero (#723). `stateChanges` was stripped: it embeds the contract
 *   wasm and is ~17 kB of noise the SDK never reads.
 * - `simulate-score-scored.json` — the same recorded envelope with only
 *   `results[0].xdr` re-encoded to a populated `(i128, i128, u64, u32)` tuple
 *   → `(8123, 9600, 142, 37)`. The wire shape is the recorded one; only the
 *   numbers differ, so a test can assert a non-empty `onChain` mapping.
 * - `simulate-error-missing-contract.json` — a verbatim simulation-error
 *   response (`HostError: Error(Storage, MissingValue)`), recorded by pointing
 *   the same call at an undeployed contract id. This is the shape the route's
 *   `catch` must degrade to `onChain: null` on.
 */
import { http, HttpResponse } from 'msw';
import scoreUnscored from '../fixtures/oracle/simulate-score-unscored.json';
import scoreScored from '../fixtures/oracle/simulate-score-scored.json';
import simulationError from '../fixtures/oracle/simulate-error-missing-contract.json';

/** Matches the `DEFAULT_RPC_URL` in lib/oracle/read.ts. */
export const ORACLE_RPC_URL = 'https://soroban-testnet.stellar.org/';

/** The JSON-RPC envelope `rpc.Server` posts for a read-only simulation. */
export interface SorobanRpcRequest {
  jsonrpc: string;
  id: number | string;
  method: string;
  params?: { transaction?: string };
}

const seen: SorobanRpcRequest[] = [];

/** Every RPC request the stub has answered this test, oldest first. */
export function oracleRequests(): readonly SorobanRpcRequest[] {
  return seen;
}

/** Clears the recorded request log — call alongside `server.resetHandlers()`. */
export function resetOracleRequests(): void {
  seen.length = 0;
}

function respondWith(fixture: unknown) {
  return http.post(ORACLE_RPC_URL, async ({ request }) => {
    const body = (await request.json()) as SorobanRpcRequest;
    seen.push(body);
    // Echo the caller's id back so the SDK pairs the response to its request.
    return HttpResponse.json({ ...(fixture as object), id: body.id });
  });
}

/**
 * Default: the oracle answers, but the anchor/corridor has no outcomes yet —
 * so `getScoreForCorridor` resolves to `null`.
 */
export const oracleHandlers = [respondWith(scoreUnscored)];

/** Override: the oracle answers with a populated score tuple. */
export const scoredOracleHandler = respondWith(scoreScored);

/** Override: the oracle answers with a simulation error. */
export const failingOracleHandler = respondWith(simulationError);
