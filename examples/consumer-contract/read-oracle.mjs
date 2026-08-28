#!/usr/bin/env node
/**
 * Standalone example: read live data straight from the deployed Stellar
 * Intel reputation oracle (testnet) — no contract deploy required.
 *
 * Every call here is a pure `simulateTransaction` — no signing, no
 * submission, no funded account needed. Run from the repo root:
 *
 *   node examples/consumer-contract/read-oracle.mjs [anchorId] [corridor]
 *
 * Requires `@stellar/stellar-sdk` to be installed (already a root
 * dependency of this repo; `npm install @stellar/stellar-sdk` if running
 * this file outside the monorepo).
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
} from '@stellar/stellar-sdk';

const ORACLE_CONTRACT_ID = 'CCZ54NTEOVL2DKWCGJA5XHTHOGRDS7JHFKYWEC6QH2IMZLYNM3FBFKDG';
const RPC_URL = 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = Networks.TESTNET;

// A well-formed but unfunded, never-signed account — simulateTransaction only
// needs a syntactically valid source account to build the envelope; it's
// never checked against ledger state, signed, or submitted.
const SIMULATION_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

async function simulateRead(method, args) {
  const server = new rpc.Server(RPC_URL);
  const contract = new Contract(ORACLE_CONTRACT_ID);
  const account = new Account(SIMULATION_SOURCE, '0');

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`"${method}" simulation failed: ${sim.error}`);
  }
  return sim.result?.retval === undefined ? undefined : scValToNative(sim.result.retval);
}

async function main() {
  const anchorId = process.argv[2] ?? 'cowrie';
  const corridor = process.argv[3] ?? 'usdc-ngn';

  console.log(`Oracle contract: ${ORACLE_CONTRACT_ID} (testnet)\n`);

  const anchors = await simulateRead('list_anchors', []);
  console.log('list_anchors():', anchors);

  const score = await simulateRead('get_score_for_corridor', [
    nativeToScVal(anchorId, { type: 'string' }),
    nativeToScVal(corridor, { type: 'string' }),
  ]);
  console.log(`get_score_for_corridor("${anchorId}", "${corridor}"):`, score);

  const aggregate = await simulateRead('get_corridor_aggregate', [
    nativeToScVal(anchorId, { type: 'string' }),
    nativeToScVal(corridor, { type: 'string' }),
  ]);
  console.log(`get_corridor_aggregate("${anchorId}", "${corridor}"):`, aggregate);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
