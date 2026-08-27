# Agent Positioning: Stellar Intel vs. ROZO

**Last reviewed:** 2026-08-26

Both surfaces are consumed by AI agents over MCP, and both touch
cross-border money movement — but they abstract different problems. An
agent (or the person wiring one up) choosing between them should be able
to tell in one read which tool answers which question.

## The short version

- **ROZO** abstracts **chains**. It answers "how do I pay or settle this
  asset from A to B" — intents that move value across chains. Their own
  IntentPay documentation describes ROZO-owned prefunded inventory rather than
  a named bridge; see [`POSITIONING.md`](POSITIONING.md) for sources, and do
  not differentiate on the rail, which is an implementation detail.
- **Stellar Intel** abstracts **anchors**. It answers "what will I actually
  receive if I exit this asset to fiat, and which anchor should I trust to
  do it" — quote comparison, execution, and trust scoring across Stellar
  SEP-24/38 anchors.

If the question is "move this value across chains," that's ROZO. If the
question is "what's my best fiat exit price, and is this anchor reliable,"
that's Stellar Intel.

## Why the distinction matters for agent builders

An agent that only sees two MCP servers with vaguely similar-sounding
off-ramp/payment tools has no way to route correctly without reading
external docs. Mis-routing here isn't cosmetic — picking the wrong tool
means either quoting a bridge as if it were a fiat off-ramp, or trying to
move cross-chain value through a tool that only understands Stellar
anchors. The tool descriptions themselves (see
[docs/MCP.md](MCP.md) and the `scripts/mcp/tools/*.ts` registrations) carry
this framing so an agent can disambiguate at the point of tool selection,
without needing this document as context.

## Side by side

|                      | ROZO                                  | Stellar Intel                                                         |
| -------------------- | ------------------------------------- | --------------------------------------------------------------------- |
| Abstracts            | Chains                                | Anchors                                                               |
| Core question        | "Pay/bridge this across chains"       | "Best fiat exit price + anchor trust"                                 |
| Primitive            | Cross-chain payment/settlement intent | Off-ramp quote + intent, scored against anchor reputation             |
| Output an agent gets | A cross-chain settlement              | `netReceived`, `anchor`, trust/reputation signal, unsigned tx to sign |

## Where this shows up in this repo

- [docs/MCP.md](MCP.md) — MCP server tool list, carries the same framing.
- [`scripts/mcp/tools/quote.ts`](../scripts/mcp/tools/quote.ts) and
  [`scripts/mcp/tools/prepare.ts`](../scripts/mcp/tools/prepare.ts) — the
  `intel.offramp.quote` / `intel.offramp.prepare` tool descriptions state the
  anchor/fiat-exit scope inline, for agents that only see the tool
  descriptions and never read this file.
- [docs/ROADMAP.md](ROADMAP.md) — v4 agent-surface milestones.

Related: [#794](https://github.com/ezedike-evan/stellar-intel/issues/794)
(epic).
