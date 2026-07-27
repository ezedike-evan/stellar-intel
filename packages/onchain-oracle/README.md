# Onchain Oracle (example)

This package contains a simple Solidity contract and a publisher script to publish cumulative per-corridor volume and "fees saved" to an EVM chain.

Usage:

1. Generate `packages/onchain-oracle/data/summary.json` by running the aggregator in the repo root:

```bash
node ./lib/oracle-aggregator.js
# or with ts-node
# ts-node lib/oracle-aggregator.ts
```

2. Install dependencies and publish:

```bash
cd packages/onchain-oracle
npm install
# set RPC_URL, PRIVATE_KEY, CONTRACT_ADDRESS in .env
npm run publish
```

The publisher will emit `last_tx.json` next to `summary.json` with the transaction hash and block when successful.

Contract: `contracts/OnchainOracle.sol` exposes `updateBatch` to atomically update many corridors.
