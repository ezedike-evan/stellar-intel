# consumer-contract

A minimal Soroban contract demonstrating permissionless, on-chain
composability with the [Stellar Intel reputation oracle](../../contracts/reputation):
`read_reputation_score` reads an anchor's live composite score straight from
the oracle, with no dependency on Stellar Intel's API or infrastructure — any
Soroban contract can do the same.

```rust
pub fn read_reputation_score(env: Env, oracle: Address, anchor_id: String) -> u32 {
    ReputationReader::new(&env, oracle).score_bps(anchor_id, 10)
}
```

The oracle address is a caller-supplied parameter, so this contract works
against any deployment — including the real one already live on testnet:

```
CCZ54NTEOVL2DKWCGJA5XHTHOGRDS7JHFKYWEC6QH2IMZLYNM3FBFKDG
```

(recorded in [`.deployments/testnet.json`](../../.deployments/testnet.json);
mainnet deployment is a separate roadmap gate — see
[`docs/ORACLE_SPEC.md`](../../docs/ORACLE_SPEC.md)).

## Quickest way to see live data: `read-oracle.mjs`

No deploy needed — this reads the deployed oracle contract directly with
[`@stellar/stellar-sdk`](https://www.npmjs.com/package/@stellar/stellar-sdk),
using the same simulate-only pattern as the app's
[`lib/oracle/read.ts`](../../lib/oracle/read.ts):

```bash
node examples/consumer-contract/read-oracle.mjs [anchorId] [corridor]
# e.g.
node examples/consumer-contract/read-oracle.mjs cowrie usdc-ngn
```

Every call is a pure `simulateTransaction` (no signing, no submission, no
funded account required), and prints `list_anchors`, `get_score_for_corridor`,
and `get_corridor_aggregate` for the given anchor/corridor straight from
testnet.

## Full on-chain composability: deploy `consumer-contract` itself

To see the Rust contract call the oracle **from inside another contract**
(rather than a client script), build and deploy it, then invoke it with the
real oracle address:

```bash
stellar contract build --package consumer-contract

stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/consumer_contract.wasm \
  --source-account <your-funded-testnet-identity> \
  --network testnet

# then, with the printed contract id:
stellar contract invoke \
  --id <deployed-consumer-contract-id> \
  --source-account <your-funded-testnet-identity> \
  --network testnet \
  -- read_reputation_score \
  --oracle CCZ54NTEOVL2DKWCGJA5XHTHOGRDS7JHFKYWEC6QH2IMZLYNM3FBFKDG \
  --anchor_id cowrie
```

`--source-account` needs a funded testnet identity for the deploy step (`stellar
keys generate` + `stellar keys fund`); the invoke itself is read-only. Until
you deploy your own copy, `read-oracle.mjs` above talks to the same live oracle
contract without any of that setup.
