# Benchmarks

How Stellar Intel measures itself. This document holds the corridor- and
anchor-level performance numbers that back the product claims.

> **Status: methodology defined; numbers pending.** The metric surface exists
> (`/api/metrics`, client latency capture in `lib/metrics`, per-anchor outcomes in
> `lib/reputation/*`), but a published benchmark dataset is a roadmap deliverable
> (see [`docs/ROADMAP.md`](ROADMAP.md), cross-cutting "Benchmarks" track). Do not
> cite numbers here until the table below is populated from real runs. Numbers
> stale by > 60 days block the next release gate.

## Metrics tracked

| Metric                      | Definition                                                   | Source                                          |
| --------------------------- | ------------------------------------------------------------ | ----------------------------------------------- |
| **Quote latency**           | Time to fetch a corridor's rate comparison (p50/p95).        | `quote_fetch_latency` (client), `/api/metrics`. |
| **Quote-to-signed**         | Time from rate shown to user signature.                      | client metrics.                                 |
| **Fill rate**               | Fraction of quotes that settle, per anchor.                  | `lib/reputation/*`.                             |
| **Slippage**                | Quoted vs delivered value, per anchor.                       | reputation outcomes.                            |
| **Settle latency**          | `pending_external` → fiat landed (p50/p95/p99).              | reputation outcomes.                            |
| **Split vs single savings** | Extra landed value from split routing vs best single anchor. | router + outcomes (roadmap).                    |

## Corridor results

| Corridor | Quote p50 | Quote p95 | Best anchor | Fill rate | Settle p50 |
| -------- | --------- | --------- | ----------- | --------- | ---------- |
| usdc-ngn | _pending_ | _pending_ | _pending_   | _pending_ | _pending_  |
| usdc-kes | _pending_ | _pending_ | _pending_   | _pending_ | _pending_  |
| usdc-ars | _pending_ | _pending_ | _pending_   | _pending_ | _pending_  |

## How to reproduce

```bash
curl -s "https://stellar-intel.vercel.app/api/metrics" | jq
# Per-anchor settle/fill history:
curl -s "https://stellar-intel.vercel.app/api/reputation/<anchor>/history?window=30d" | jq
```

Populate the table from a dated run and link the raw export. See
[`docs/ANCHOR_REPUTATION.md`](ANCHOR_REPUTATION.md) for the score formula.
