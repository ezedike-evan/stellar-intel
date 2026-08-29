# @stellarintel/publisher

[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

Off-chain publisher for the [Stellar Intel](https://github.com/ezedike-evan/stellar-intel)
reputation oracle. It reads settled anchor outcomes from Postgres and submits
them as `submit_outcome` calls on the
[reputation Soroban contract](https://github.com/ezedike-evan/stellar-intel/tree/main/contracts/reputation),
so any consumer can read an anchor's track record on-chain without Stellar
Intel's permission.

## What it does

`runBatch` (`src/batch.ts`) does the full tick:

1. `fetchPendingOutcomes` — reads reconciled-but-unpublished rows from the
   `outcome_log` table (the same table the main app's reputation store
   writes to — see `lib/reputation/postgres.ts`), filtered to
   `reconciled_at IS NOT NULL AND published_at IS NULL`.
2. `submitToOracle` — builds a `submit_outcome` invocation per row via
   [`@stellar/stellar-sdk`](https://www.npmjs.com/package/@stellar/stellar-sdk)'s
   contract client, signs with the publisher key, and submits it.
3. `markPublished` — writes the resulting tx hash back to Postgres so the row
   isn't resubmitted on the next tick.

`src/index.ts` is the CLI entry point (`npm start` / `npm run dev`): it wraps
`runBatch` with an in-process lock (`src/lock.ts`) so overlapping cron
invocations skip instead of double-submitting. That lock is an in-memory
`Map` — it only protects a single running process, not multiple concurrent
instances. If you run more than one publisher process against the same
database, coordinate at the deployment level (e.g. a single cron replica).

## Install

```bash
npm install @stellarintel/publisher
```

## Configuration

Required environment variables (see `src/index.ts`):

| Variable             | Purpose                                                                               |
| -------------------- | ------------------------------------------------------------------------------------- |
| `DATABASE_URL`       | Postgres connection string                                                            |
| `ORACLE_CONTRACT_ID` | Deployed reputation contract address (`C…`)                                           |
| `PUBLISHER_SECRET`   | Publisher account secret key (`S…`) — must be authorized on-chain via `add_publisher` |

Optional:

| Variable                     | Default                                          |
| ---------------------------- | ------------------------------------------------ |
| `BATCH_SIZE`                 | `100`                                            |
| `STELLAR_NETWORK_PASSPHRASE` | `Public Global Stellar Network ; September 2015` |
| `HORIZON_URL`                | `https://horizon.stellar.org`                    |
| `SOROBAN_RPC_URL`            | `https://mainnet.sorobanrpc.com`                 |

## Usage

```bash
npm run build   # tsc -> dist/
npm start       # runs one batch tick against DATABASE_URL
npm run dev     # same, via tsx, no build step
```

Typically run on a schedule (cron / Vercel Cron / similar) against the
`/api/publisher/tick`-style trigger used elsewhere in the monorepo, or
directly as a standalone process.

## Testing

```bash
npm test
```

Unit tests (`tests/batch.spec.ts`) mock `@stellar/stellar-sdk` and don't touch
the network. `tests/e2e.spec.ts` is an opt-in integration test that round-trips
a real outcome through Postgres → publisher → testnet chain state — it
self-skips unless a full testnet environment is provided (see the file header
for the required env vars).

## Documentation

Full API reference, quickstart guides, and integration docs are available in the
[Stellar Intel Developer Portal](https://stellar-intel.vercel.app/docs).

## Related

- [`docs/ORACLE_SPEC.md`](https://github.com/ezedike-evan/stellar-intel/blob/main/docs/ORACLE_SPEC.md) — contract interface and consumer notes.
- [`@stellarintel/mcp`](https://www.npmjs.com/package/@stellarintel/mcp) — MCP server exposing the same off-ramp routing to agents.
