# Stellar Intel — Roadmap

> Six versions, tickable. The wave structure mirrors the numbered tickets in
> the [GitHub issue tracker](https://github.com/Ezedike-Evan/stellar-intel/issues)
> — this document is the product-level view a contributor, integrator, or
> anchor partner reads to know **what ships next** and **in what order**.

**Last reviewed:** 2026-08-28

**Legend.** `[x]` shipped on `main` today · `[-]` in flight · `[ ]` planned.
Ticket ranges point back to numbered issues in the
[GitHub issue tracker](https://github.com/Ezedike-Evan/stellar-intel/issues) where the line-level scope lives.

> **Reconciliation note.** Several v1.1–v2.0 foundations have already landed on
> `main` ahead of a full per-checkbox sweep: `lib/stellar/sep38.ts` (+ schemas),
> `lib/intent/*` (canonicalize/hash/sign/replay), `lib/router/*`,
> `lib/reputation/*` (SQLite/Postgres store, composite score, bands, disputes),
> `packages/mcp` (basic MCP server), `contracts/reputation/*` (Soroban contract,
> testnet), and the `/api/reputation/*`, `/api/intent/offramp`, and `/api/metrics`
> routes. Treat the **code as authoritative** where a box below still reads `[ ]`.
>
> **Reconciliation, 2026-08-06.** Post–Wave-6 sweep flipped the boxes for capabilities now on
> `main`: v6 Rust SDK (#868/#982), webhooks + HMAC (#869), GraphQL (#870), developer portal
> (#871); v2.1 publisher whitelist, `read_outcome`/`read_aggregate`, testnet deploy (#194),
> TS read SDK (#201), Python consumer (#203/#821); v2.0 leaderboard/history/composite/dispute
> (#157–#159, #166). Marked in-flight (`[-]`): `@stellarintel/sdk` + `/mcp` (built, unpublished —
> npm 404), multisig admin (two-step rotation shipped, 2-of-3 pending), decentralization (#875).
> GraphQL is on `main` but the live endpoint currently 500s. The open security /
> production-readiness / S-tier program lives in [`maintainer.md`](../maintainer.md).
>
> **Reconciliation, 2026-08-28.** Waves reconciled against the milestone list
> (#1076). Three v1 milestones that had shipped without ever appearing here are
> now written up as Waves [1.4](#wave-14--sep-6), [1.5](#wave-15--anchor-fleet)
> and [1.6](#wave-16--landing-polish); the open `H1 Rung 1` milestone is written
> up as [Rung 1](#rung-1--data-infra) under its own name. "Wave 2.2" and "Wave
> 2.3" named scope no milestone ever tracked and are no longer waves. The
> [milestone map](#milestone-map) is the check: every wave named in this
> document appears on it.

**Ship discipline.** Each wave has a **release gate** — a single named
command plus a named condition — that must be green before the next wave
opens. A wave does not open early. A wave does not ship partial.

---

## Table of contents

- [At a glance](#at-a-glance)
- [Milestone map](#milestone-map) — every wave named here, and the milestone that tracks it
- [v1 Executable](#v1-executable) — a correct, demonstrable off-ramp
  - [Wave 1.0 Core Executable](#wave-10--core-executable) (`#001–#070`)
  - [Wave 1.1 Hardening + SEP-38](#wave-11--hardening--sep-38) (`#071–#110`)
  - [Wave 1.2 Router + Seeds](#wave-12--router--seeds) (`#111–#140`)
  - [Wave 1.3 Polish + Release Gate](#wave-13--polish--release-gate) (`#141–#150`)
  - [Wave 1.4 SEP-6](#wave-14--sep-6) (`B001–B025`)
  - [Wave 1.5 Anchor Fleet](#wave-15--anchor-fleet) (`B026–B070`)
  - [Wave 1.6 Landing Polish](#wave-16--landing-polish) (`B071–B100`)
- [v2 Observable](#v2-observable) — reputation as a product surface
  - [Wave 2.0 Reputation as Product Surface](#wave-20--reputation-as-product-surface) (`#151–#180`)
  - [Wave 2.1 Soroban Oracle Live](#wave-21--soroban-oracle-live) (`#181–#205`)
  - [Rung 1 Data Infra](#rung-1--data-infra) (`D001–D077`) — the milestone currently open
  - [v2 scope with no milestone](#v2-scope-with-no-milestone) (`#206–#250`)
- [v3 Guaranteed](#v3-guaranteed) — intent-level SLAs
- [v4 Universal](#v4-universal) — SDK + MCP GA + embeddable widget
- [v5 Institutional](#v5-institutional) — compliance-grade primitives
- [v6 Ecosystem Infrastructure](#v6-ecosystem-infrastructure) — webhooks, GraphQL, multi-language SDKs, decentralization
- [Deliberately deferred](#deliberately-deferred) — the three modules that are not on this roadmap, and why
- [Cross-cutting tracks](#cross-cutting-tracks)

---

## At a glance

| Version                         | Theme                                                    | Scope                               | Target gate                                                                        | Status                                                                                    |
| ------------------------------- | -------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **v1 Executable**               | A correct, demonstrable off-ramp                         | `#001–#150` + `B001–B100` · 7 waves | `npm run test:release` green; feature flags default-on                             | 🟢 All seven v1 milestones closed                                                         |
| **v2 Observable**               | Reputation as product surface, Soroban on mainnet        | `#151–#205` + `D001–D077` · 3 waves | Soroban contract deployed, ≥3 publishers, ≥1000 outcomes                           | 🟡 Foundations landed (store + API, oracle on testnet, MCP); mainnet + public API pending |
| **v3 Guaranteed**               | Intent-level SLAs, slippage bounds, recurring intents    | Planned · scope decomposed post-v2  | Slippage-bound compliance ≥ 99.5% over 10k intents                                 | ⚪ Not started                                                                            |
| **v4 Universal**                | SDK + MCP GA + embeddable widget                         | Planned · scope decomposed post-v3  | `@stellarintel/sdk` + `@stellarintel/mcp` on npm; 3 reference integrations         | ⚪ Not started                                                                            |
| **v5 Institutional**            | Compliance-grade primitives, audit-ready                 | Planned · scope decomposed post-v4  | Third-party audit report published; SBOM on every release                          | ⚪ Not started                                                                            |
| **v6 Ecosystem Infrastructure** | Webhooks, GraphQL, multi-language SDKs, decentralization | Planned · scope decomposed post-v5  | Corridor rate oracle read by ≥1 third-party contract; the "ripped out" test passes | ⚪ Not started                                                                            |

---

## Milestone map

**The rule this table exists to hold: no wave is named in this document without
a milestone tracking it, and no milestone is left undescribed here.** The two
drifted apart — three v1 milestones shipped without ever appearing on this
roadmap, and two waves were named here that no milestone ever tracked — so the
mapping is now written down rather than assumed.

Counts are from the [milestone
list](https://github.com/ezedike-evan/stellar-intel/milestones) on 2026-08-28.

| Wave in this document                               | Milestone                        | Tickets     | Issues            |
| --------------------------------------------------- | -------------------------------- | ----------- | ----------------- |
| [Wave 1.0](#wave-10--core-executable)               | `v1.0`                           | `#001–#070` | 70 closed         |
| [Wave 1.1](#wave-11--hardening--sep-38)             | `v1.1`                           | `#071–#110` | 40 closed         |
| [Wave 1.2](#wave-12--router--seeds)                 | `v1.2`                           | `#111–#140` | 30 closed         |
| [Wave 1.3](#wave-13--polish--release-gate)          | `v1.3`                           | `#141–#150` | 10 closed         |
| [Wave 1.4](#wave-14--sep-6)                         | `v1.4 SEP-6`                     | `B001–B025` | 25 closed         |
| [Wave 1.5](#wave-15--anchor-fleet)                  | `v1.5 Anchor Fleet`              | `B026–B070` | 45 closed         |
| [Wave 1.6](#wave-16--landing-polish)                | `v1.6 Landing Polish`            | `B071–B100` | 30 closed         |
| [Wave 2.0](#wave-20--reputation-as-product-surface) | `v2.0`                           | `#151–#180` | 30 closed         |
| [Wave 2.1](#wave-21--soroban-oracle-live)           | `v2.1`                           | `#181–#205` | 20 closed         |
| [Rung 1](#rung-1--data-infra)                       | `H1 Rung 1 — Data Infra + Grant` | `D001–D077` | 76 closed, 1 open |

**Three ticket series, not one.** The `#NNN` series is this document's original
decomposition; `B` and `D` are later series filed against their own milestones.
A number here only resolves against the milestone on the same row — `#206` as a
roadmap ticket is not GitHub issue 206.

**Nothing below is named "Wave 2.2" or "Wave 2.3" any more.** Both headings
existed here for scope that was never given a milestone and is not scheduled.
They now sit under [v2 scope with no
milestone](#v2-scope-with-no-milestone), which is what they always were.

**A closed milestone is not a ticked checkbox.** Every milestone above except
Rung 1 has zero open issues, while many checkboxes in the wave sections still
read `[ ]`. The milestone is the record of what was closed; a checkbox here is
this document's own claim, and the reconciliation notes at the top of the file
say which one to trust where they disagree. Flipping the boxes is a separate,
per-line sweep and is deliberately not done in bulk.

---

## v1 Executable

**Thesis.** Before anything else — before reputation, before the oracle,
before the agent surface — a single user must be able to open the app, pick
a corridor, compare live quotes, sign one transaction in Freighter, and
watch their fiat land. v1 is that end-to-end path, hardened, tested, and
instrumented.

### Wave 1.0 — Core Executable

> Tickets: `#001–#070`. End-to-end off-ramp can happen.

**A. Credibility bug fixes** (`#001–#010`)

- [x] `#001` Cowrie `exchangeRate` returns non-zero on USDC→NGN rows
- [x] `#002` `StatusTracker` mounts on successful execute with live `transactionId`
- [x] `#003` Collapse duplicate anchor registries into one canonical source
- [x] `#005` Never fabricate rates when anchor endpoints fail — render unavailable
- [x] `#006` Remove hardcoded Horizon URL literals; go through env config
- [x] `#008` Single zod-based env validation module
- [x] `#010` Page does not crash when Freighter is undefined on first render
- [ ] `#004` Remove `isMock` field; fail closed on unknown source
- [ ] `#007` Amount field rejects negatives and non-numeric strings
- [ ] `#009` Refresh button resets stale state before re-fetching

**B. Anchor data & SEP-1 resolution** (`#011–#019`)

- [x] SEP-1 resolver with cache (`lib/stellar/sep1.ts`)
- [x] `getTransferServer` + `getWebAuthEndpoint` helpers
- [x] MoneyGram + Cowrie + Anclap registered (`lib/stellar/anchors.ts`)
- [ ] `#014` `discoverAnchorsForCorridor(corridorId)` with parallel resolution
- [ ] `#015` Broader corridor coverage (XOF, ZAR) — PROPOSAL target

**C. SEP-10 authentication** (`#020–#030`)

- [x] Challenge fetch with mainnet network-passphrase assertion
- [x] Freighter sign path via `@stellar/freighter-api`
- [x] JWT exchange + in-memory cache scoped per anchor domain
- [ ] Challenge expiry + re-auth loop
- [ ] JWT refresh before `iat + ttl` boundary

**D. SEP-24 withdraw flow** (`#031–#055`)

- [x] `/fee` endpoint wrapper with 10s `AbortController` timeout
- [x] `/transactions/withdraw/interactive` wrapper
- [x] `/transaction?id=…` polling fetcher
- [x] `ExecuteDrawer` 6-step flow (`authenticating → done`)
- [x] Freighter user-reject surfaces cleanly
- [ ] `#046` Refund / terminal-error visual differentiation
- [ ] `#049` `no_market` / `too_small` / `too_large` UX

**E. Freighter wallet integration** (`#056–#064`)

- [x] `useFreighter` hook with connection + network state
- [x] Install-missing banner
- [ ] Network mismatch (testnet / standalone) bailout card
- [ ] Account switch → wipe per-anchor JWTs

**F. Status polling & tracking** (`#065–#070`)

- [x] `useWithdrawStatus` SWR poll keyed by `[transferServer, tx_id, jwt]`
- [x] Terminal-state stop (`completed | refunded | error`)
- [x] `StatusTracker` renders the visible state machine
- [ ] Exponential backoff on consecutive `/transaction` 5xx
- [ ] Stellar Expert link on `completed`

**G. UI wiring for the end-to-end flow** (`#031–#058`, selected)

- [x] Corridor / country / currency selectors
- [x] Rate table — sortable, best-rate badge, stale banner
- [x] Drawer → tracker hoist on success (credibility fix #2)
- [ ] Empty-state for unsupported corridor
- [ ] Responsive layout audit at 320 / 768 / 1024 / 1440

**H. Core tests** (`#061–#070`)

- [x] Anchor registry snapshot tests
- [x] SEP-1 parse tests
- [ ] Playwright happy path — USDC→NGN via mock Cowrie
- [ ] SEP-10 challenge validator unit tests
- [ ] SEP-24 fetcher timeout regression test

**Wave 1.0 release gate.**

- [ ] All `#001–#070` closed
- [ ] `npm run test` green on Node 20 and 22
- [ ] One recorded 90-second end-to-end demo video committed to `docs/showcase/`

---

### Wave 1.1 — Hardening + SEP-38

> Tickets: `#071–#110`. Firm quotes, error recovery, rate freshness.
> This is the wave that upgrades the product from "useful comparison" to
> "firm execution layer."

**I. SEP-38 discovery + quote fetching** (`#071–#085`)

- [ ] `lib/stellar/sep38.ts` — `INFO`, `PRICES`, `PRICE`, `QUOTE`
- [ ] `POST /sep38/quote` firm-quote client
- [ ] `quote_id` threaded into `/transactions/withdraw/interactive`
- [ ] Expiry countdown surfaced in `RateTable`
- [ ] Per-anchor SEP-38 capability discovery (graceful downgrade to `/fee`)

**J. Multi-anchor quote solicitation** (`#086–#095`)

- [ ] `#081` Parallel quote solicitor across all anchors for a corridor
- [ ] Staggered request pacing (max-in-flight ceiling)
- [ ] Per-anchor quote cache with TTL
- [ ] "Auto-refresh all" and "refresh one" affordances

**K. Error handling & retries** (`#096–#102`)

- [ ] Typed `AnchorError` taxonomy (`timeout | auth | network | 4xx | 5xx`)
- [ ] Per-anchor circuit breaker (opens on 3 consecutive failures)
- [ ] Retry-with-backoff on `429` honouring `Retry-After`
- [ ] Sentry reporter scaffold (off by default, toggled via env)

**L. Rate freshness & stale handling** (`#103–#107`)

- [ ] Per-row age badge (`5s / 15s / 60s / stale`)
- [ ] Corridor-wide refresh button with loading indicator
- [ ] "Quote expired — re-quote before signing" blocker in drawer
- [ ] Clock-skew detection and surfacing

**M. Hardening tests** (`#108–#110`)

- [ ] Vitest SEP-38 quote expiry regression
- [ ] Playwright — anchor-down scenario renders unavailable, never a zero rate
- [ ] Playwright — stale quote blocks sign

**Wave 1.1 release gate.**

- [ ] All `#071–#110` closed
- [ ] Every live rate rendered is either a firm SEP-38 quote or marked `unavailable` — never fabricated
- [ ] `npm run test:integration` green against a mock anchor fleet

---

### Wave 1.2 — Router + Seeds

> Tickets: `#111–#140`. Ships the intent schema, the single-anchor router,
> the reputation write path seed, the MCP server stub, and the Soroban
> contract skeleton. These are seeds — they do not yet ship end-to-end, but
> the shape is committed to `main`.

**N. Intent schema + API** (`#111–#120`)

- [ ] `#111` `types/intent.ts` — `Intent`, `SignedIntent`, `Plan`, `Outcome`
- [ ] `lib/intent/canonical.ts` — deterministic JSON canonicalization
- [ ] `lib/intent/hash.ts` — sha-256 over canonical JSON
- [ ] `lib/intent/sign.ts` — ed25519 signing via Freighter
- [ ] `app/api/intent/offramp/route.ts` — submit signed intent
- [ ] `docs/CANONICAL_JSON.md` + `docs/INTENT_API.md`

**O. Single-anchor intent router** (`#121–#127`)

- [ ] `lib/router/score.ts` — net-landed-value scoring
- [ ] `lib/router/select.ts` — single-anchor pick (deterministic)
- [ ] `lib/router/plan.ts` — produces `Plan` from a draft intent
- [ ] Feature flag `INTENT_FLOW` (default off) for the page to call the router
- [ ] Drawer re-points at the router output instead of `RateTable` row click

**P. Reputation write path seed** (`#128–#134`)

- [ ] `#128` `ReputationStore` interface (pluggable — SQLite dev, Postgres prod)
- [ ] `app/api/outcomes/route.ts` — accept outcome tuples, verify signatures
- [ ] `lib/publisher/queue.ts` — durable outcome queue (SQLite-backed dev)
- [ ] `lib/publisher/sign.ts` — publisher ed25519 signing (dev key only)
- [ ] Outcome schema + migration scripts
- [ ] Feature flag `REPUTATION_WRITE` (default off)

**Q. MCP server stub seed** (`#135–#138`)

- [ ] `packages/mcp/` scaffold (npm package, `claude mcp add`–installable)
- [ ] `list_corridors` + `list_anchors_for_corridor` tools (read-only)
- [ ] `quote_corridor` tool backed by `/api/rates`
- [ ] `docs/MCP.md` install + tutorial

**R. Soroban reputation contract skeleton** (`#139–#140`)

- [x] `contracts/reputation/src/lib.rs` `ReputationContract` with `submit_outcome` (testnet)
- [ ] `#140` `get_score` read entrypoint returning dummy data
- [ ] Soroban test harness green on testnet

**Wave 1.2 release gate.**

- [ ] All `#111–#140` closed
- [ ] `INTENT_FLOW` can be toggled on behind the flag end-to-end in dev
- [ ] MCP server installs and returns a quote from a real anchor

---

### Wave 1.3 — Polish + Release Gate

> Tickets: `#141–#150`. Observability, feature flags, v1 sign-off suite,
> final assets.

- [ ] `#141` Structured logger (`lib/logger.ts`) with correlation IDs via `AsyncLocalStorage`
- [ ] `#142` Client-side quote + submit latency metrics
- [ ] `#143` Success / error rate counters exposed via `/api/metrics`
- [ ] `#144` Per-anchor latency histogram
- [ ] `#145` `lib/version.ts` with build metadata in footer
- [ ] `#146` Feature flag module for all v1.2 seeds
- [ ] `#147` Env validation at Next.js boot (fails fast on missing vars)
- [ ] `#148` `npm run test:release` — full v1 sign-off suite
- [ ] `#149` "Open in MCP" header badge when a local MCP is detected
- [ ] `#150` Favicon + app icon final assets

**v1.3 release gate.**

- [ ] All 150 issues closed (`#001–#150`)
- [ ] `npm run test:release` green
- [ ] Feature flags `INTENT_FLOW` and `REPUTATION_WRITE` default-on
- [ ] MCP server publishable (`npm publish --dry-run` green)
- [ ] 90-second demo video + 6 annotated screenshots in `docs/showcase/`
- [ ] `CHANGELOG.md` tagged with a dated release note
- [ ] Git tag `v1.0.0` pushed

> This was written as _the_ v1 gate, on the assumption that v1 ended at Wave
> 1.3. Three further v1 milestones were opened and closed after it, so it is
> the **Wave 1.3** gate and the three waves below are also part of v1.

---

### Wave 1.4 — SEP-6

> Tickets: `B001–B025`. Milestone `v1.4 SEP-6`, closed.
> _"SEP-6 enablement: rate source + programmatic withdraw."_

SEP-24 is the interactive withdrawal and it is what the drawer drives. It is
not what every anchor offers. Wave 1.4 added SEP-6 as a second, programmatic
path so an anchor that never implemented SEP-24 can still appear in a corridor
with a real indicative rate rather than not appear at all.

- [x] `lib/stellar/sep6.ts` — capability detection, `/info` and `/withdraw`
      schemas, indicative rate derived from `/info` fees (`B001–B005`, `B011`, `B012`)
- [x] SEP-6 wired as the Tier-3 fallback in `fetchCorridorRates`, with the
      source surfaced in the rate rows (`B006`, `B007`, `B038`)
- [x] SEP-12 customer client, dynamic KYC field-form schema, `needs_info`
      handling (`B013–B015`, `B021`)
- [x] Unified SEP-6/SEP-24 status normalization and polling (`B016`, `B017`)
- [x] Capability-aware branch in `ExecuteDrawer` and a CORS-safe
      `app/api/sep6/withdraw` proxy (`B019`, `B020`)
- [x] `Anchor.seps[]` capability field on the registry type (`B023`)
- [x] SEP-6 support matrix in [`SEP_COMPLIANCE.md`](SEP_COMPLIANCE.md) (`B025`)

**Wave 1.4 release gate.**

- [x] All `B001–B025` closed
- [x] E2E: SEP-6 withdraw happy path against a mock anchor (`B022`)

---

### Wave 1.5 — Anchor Fleet

> Tickets: `B026–B070`. Milestone `v1.5 Anchor Fleet`, closed.
> _"Survey-driven anchor onboarding and fleet infrastructure."_

Three registered anchors is a demo. This wave turned the registry into a
surveyed fleet: every candidate triaged against its live `stellar.toml`,
issuer-only domains classified and excluded rather than quietly rendered, and
the whole thing rechecked on a schedule so the list decays visibly.

- [x] Per-anchor triage and integration — `anclap.com`, `cowrie.exchange`,
      `mykobo.co`, `ngnc.online`, `ntokens.com`, `ultracapital.xyz`,
      `zeam.money`, `fchain.io` (`B026–B033`)
- [x] Non-anchors documented rather than dropped silently — `naobtc.com`,
      `stellarport.io`, `dead.apay.io` (`B034–B036`)
- [x] Transfer-capable vs issuer-only classification; issuer-only excluded from
      the selectors (`B037`)
- [x] `anchor-survey.mjs` wired into nightly with a committed JSON snapshot
      (`B038`)
- [x] Home-domain vs service-domain resolution, TOML cache with TTL,
      per-anchor timeout and retry tuning (`B039`, `B041`, `B043`)
- [x] SEP-31 and SEP-38 capability detection per anchor (`B047`, `B048`)
- [x] EUR, ZAR and XOF corridor scaffolding (`B049`, `B050`)
- [x] Stale-anchor auto-disable on repeated TOML failure; graceful per-anchor
      degradation (`B058`, `B062`)
- [x] Tracking issues kept for what the survey could not resolve — 30
      issuer-only anchors, 51 unreachable or unconfirmed (`B065`, `B066`)

**Wave 1.5 release gate.**

- [x] All `B026–B070` closed
- [x] CI check: registry anchors ⊆ the survey's transfer-capable set (`B067`)
- [x] Property test: every registered anchor's TOML parses and carries the
      required SEPs (`B057`)

---

### Wave 1.6 — Landing Polish

> Tickets: `B071–B100`. Milestone `v1.6 Landing Polish`, closed.
> _"Landing page redesign and polish."_

- [x] Landing decomposed into `components/landing/*` — `Hero`, `StatBar`,
      `FeatureGrid` (`B071–B073`)
- [x] Real multi-stat bar (anchors, corridors, countries) rather than
      hand-written numbers (`B074`, `B075`)
- [x] Live sample-rate preview, corridors strip, anchor logo wall,
      leaderboard teaser, comparison teaser (`B078–B082`, `B096`)
- [x] Dark-mode, responsive, theme-token and microcopy passes (`B086`, `B087`,
      `B095`, `B098`)
- [x] Accessibility pass — aria, contrast, focus order (`B088`)
- [x] Lighthouse pass: image optimization, font loading (`B089`, `B090`)
- [x] OG/social meta and favicon set (`B092`)

**Wave 1.6 release gate.**

- [x] All `B071–B100` closed
- [x] Playwright smoke: landing renders and the CTAs navigate (`B100`)
- [x] Visual snapshot tests for the landing components (`B099`)

> **With Wave 1.6 closed, all seven v1 milestones are closed and v2 is open.**

---

## v2 Observable

**Thesis.** The reputation data that v1 writes silently becomes the
product's centre of gravity. The probes run continuously, the methodology is
public, and the Soroban oracle goes live on mainnet once the coverage behind it
is real. This is where the moat compounds — and it compounds on the clock, not
on how fast the code is written.

Three milestones sit under v2: `v2.0` and `v2.1` are closed, and
[`H1 Rung 1`](#rung-1--data-infra) is the one still open. Split routing and the
public reputation API are [scope with no
milestone](#v2-scope-with-no-milestone) — real decomposition, unscheduled.

### Wave 2.0 — Reputation as Product Surface

> Tickets: `#151–#180`. The data v1 wrote to `ReputationStore` becomes
> visible UX.

- [ ] `#151` Anchor scorecard card — fill rate, settle time, slippage
- [ ] `#152` Scorecard integrated into `RateTable` row expansion
- [ ] `#153` Scorecard detail modal on click
- [ ] `#154` Historical timeline chart per anchor
- [ ] `#155` Public leaderboard page at `/anchors`
- [ ] `#156` Per-corridor leaderboard view (`/anchors?corridor=usdc-ngn`)
- [x] `#157` `GET /api/reputation/leaderboard?corridor` endpoint
- [x] `#158` `GET /api/reputation/:anchor/history?window` endpoint
- [x] `#159` **Composite score formula** (blocks `#151`, `#155`, `#157`, `#172`, `#180`) — `lib/reputation/composite.ts`
- [x] `#166` "Flag incorrect outcome" on terminal states → dispute — `app/api/reputation/dispute` + `DisputeModal`
- [ ] `#171` Top-3 anchors summary bar above `RateTable`
- [ ] `#172` Per-corridor aggregate partition
- [ ] `#174` Materialized view refresh cadence (blocks freshness scenarios)
- [ ] `#178` Reputation badge in `StatusTracker` on `completed`
- [ ] `#180` "Underrated" vs "overrated" anchor flag on leaderboard

**Wave 2.0 release gate.**

- [ ] All `#151–#180` closed
- [ ] Composite score formula documented in `docs/ANCHOR_REPUTATION.md` with citations
- [ ] At least 500 live outcomes in the dev `ReputationStore`

---

### Wave 2.1 — Soroban Oracle Live

> Tickets: `#181–#205`. The contract goes to mainnet. The publisher goes
> live. Third-party consumers can read.

- [-] `#181` Multi-signer admin (2-of-3) on the oracle contract — two-step
  admin + upgrade-admin rotation shipped (`admin.rs`, `upgrade.rs`,
  `tests/multisig.rs`); 2-of-3 threshold pending
- [x] Publisher whitelist management (`add_publisher` / `remove_publisher`) — `publishers.rs`
- [ ] `publish_outcome` — full signature verification + idempotency
- [x] `read_outcome` + `read_aggregate` public reads — `lib/oracle/read.ts`
- [ ] 7-day time-locked upgrade path
- [ ] `#189` Publisher service (production key rotation, health endpoint)
- [ ] `#190–#192` Publisher retries, dead-letter, Sentry wiring
- [x] `#194` Contract deployed to Soroban testnet, e2e green — 2026-07-09, `.deployments/`
- [ ] `#195` Contract deployed to Soroban **mainnet**
- [ ] `#200` Publisher service e2e against testnet
- [x] `#201` Public TypeScript read SDK (`packages/sdk`)
- [ ] `#202` JS example consumer
- [x] `#203` Python example consumer — `packages/python-sdk` (#821)
- [ ] `#204` Publisher cron metrics dashboard
- [ ] `#205` Full reputation chain e2e — outcome to oracle read

**Wave 2.1 release gate.**

- [ ] Contract verifiably deployed on Soroban mainnet (explorer link in `README.md`)
- [ ] ≥3 publishers on the whitelist (ours + 2 community signers)
- [ ] ≥1000 outcomes on-chain
- [ ] TypeScript + JS + Python example consumers all green
- [ ] Independent audit pass (single firm) of the Soroban contract

---

### Rung 1 — Data Infra

> Tickets: `D001–D077`. Milestone `H1 Rung 1 — Data Infra + Grant`, **open** —
> 76 closed, 1 open. This is the only milestone with open work in it, and it is
> where the last several months of commits actually landed.

**Why it is not called "Wave 2.2".** It was filed under the Horizon/Rung
structure this document used before it moved to waves, and it never got
renumbered. Rather than rename a milestone with 77 issues in it, the name is
recorded here as-is. It runs across v2 rather than after Wave 2.1: probe
infrastructure, the publish pipeline, and the positioning and legal work that
had to happen alongside them.

- [x] The five probe checks and the scheduler that runs them — uptime, TOML
      integrity, issuer mismatch, quote latency, quote drift (`D001–D007`)
- [x] Probe results wired into the health ledger with 90-day retention, plus
      the accumulation progress tracker (`D008`, `D009`)
- [x] Scoring methodology written up and published as a public page
      (`D010`, `D011`) — [`ANCHOR_REPUTATION.md`](ANCHOR_REPUTATION.md)
- [x] Publisher verified end-to-end against the testnet contract; scheduled
      publish cron with retry, backoff and failure alerting (`D012–D016`)
- [x] **The 90-day probe gate enforced in code** on mainnet oracle publish
      (`D071`) — `packages/publisher/src/gate.ts`
- [x] Narrowed-identity rewrite across the README, the landing page, the OG
      metadata and this repository's proposal (`D017–D022`, `D072`)
- [x] Multi-factor solver routing, wired into the intent API with real
      scoring inputs (`D041–D044`, `D075`)
- [x] Rate-limit coverage audit and the routes it flagged (`D046–D048`)
- [x] Terms of service, financial disclaimer, consent flow (`D052–D056`)
- [x] Accessibility: focus trap, `aria-live` rate updates, site-wide contrast
      (`D067–D069`)
- [ ] `D070` Publish probe-derived signals on-chain — extend the publisher
      beyond `outcome_log`
      ([#785](https://github.com/ezedike-evan/stellar-intel/issues/785))

**Rung 1 release gate.**

- [ ] `D070` closed — the last open issue in the milestone
- [x] The 90-day gate is a refusal in the publish path, not a convention
- [x] Probe coverage is queryable at `GET /api/reputation/probe-coverage`

---

### v2 scope with no milestone

Two blocks below were headed "Wave 2.2" and "Wave 2.3" and carried release
gates, which read as scheduled work. Neither has ever had a milestone, and
neither is scheduled. They are kept because the decomposition is worth having
when they are picked up — but they are scope, not waves, and the gates that
were attached to them are stated as the conditions they would have to meet
rather than as gates that are pending.

#### Multi-Anchor Split Routing

> Tickets: `#206–#230`. A single intent can fan across anchors if the sum
> of chunk scores beats any single-anchor plan.

- [ ] `#206` Greedy split solver (blocks `#207`, `#213`, `#218`, `#222–#225`)
- [ ] `#207` LP-style optimization solver
- [ ] `#208` Split quote bundle type
- [ ] `#209` Multi-op transaction builder for splits
- [ ] `#210` Per-op memo binding each leg to intent hash
- [ ] `#211` All-or-nothing atomic semantics
- [ ] `#212` Minimum fill-size guard
- [ ] `#213` Reputation-weighted selection
- [ ] `#214` Split-route visualization in UI
- [ ] `#215` Single-vs-split comparison toggle
- [ ] `#216` "Why split" explainer tooltip
- [ ] `#217` `SPLIT_ROUTING` feature flag
- [ ] `#218` `useSplitRates` hook
- [ ] `#219` Partial-success handling per leg
- [ ] `#220` Per-leg status timeline in `StatusTracker`
- [ ] `#221` Per-leg reputation logging
- [ ] `#222` Per-anchor share cap
- [ ] `#223` Anchor health gate (excludes anchors with open circuit breaker)
- [ ] `#224` Re-balance on leg rejection
- [ ] `#225` Multi-anchor parallel SEP-38 firm-quote fetching
- [ ] `#226` Solver synthetic scenarios (unit)
- [ ] `#227` Worst-case bounds on solver output
- [ ] `#228` Split flow e2e with two anchors
- [ ] `#229` Split partial failure + recovery e2e

**What split routing would have to prove before it ships.**

- All `#206–#230` closed
- Across the last 30 days of synthetic probes, split plans deliver ≥1% more
  landed value than best-single on ≥20% of above-threshold intents
- Atomicity invariant holds in property-based tests (10k scenarios)

---

#### Public Reputation API + Bootstrap

> Tickets: `#231–#250`. Bootstrap the dataset before organic volume
> arrives. Expose it publicly. Document it loudly.

- [ ] `#231` `GET /v1/public/scores` (anchor, corridor) → score
- [ ] `#232` `GET /v1/public/outcomes` paginated feed
- [ ] `#233` Rate limits + API-key tier (free / paid)
- [x] `#234` OpenAPI spec generated to `public/openapi.json` (15 endpoints, 15 schemas)
- [x] `#235` `api-docs` page at `/docs/api` (interactive playground with live try-it panels)
- [ ] `#239` **Probe service** (independent track) — nightly $1 synthetic
      off-ramps to seed corridor coverage
- [ ] `#240` Probe-signal reputation weighting (lower weight than organic)
- [ ] `#241` Publisher key rotation ceremony (documented, dry-run)
- [ ] `#245` Anchor onboarding flow — self-serve signup, TOML validation,
      `good-first-reputation-event` tutorial
- [ ] `#250` v2 release-gate sign-off suite (`npm run test:release:v2`)

**v2 release gate.**

- [ ] Every v2 milestone closed — `v2.0` and `v2.1` are; `H1 Rung 1` is not
- [ ] `npm run test:release:v2` green
- [ ] Soroban reputation contract verifiably deployed on mainnet
- [ ] ≥3 publishers on whitelist
- [ ] ≥1000 reputation outcomes on-chain
- [ ] Public `/v1/*` endpoints responding with rate limits
- [ ] Probe service running nightly against all live corridors
- [ ] Git tag `v2.0.0` pushed

> **When this gate is green, v2 ships and v3 opens.** The unscheduled scope
> above is not on this gate: neither block has a milestone, so neither blocks
> the release.

---

## v3 Guaranteed

**Thesis.** Up to this point, an intent is a _preference_. In v3 it
becomes a _guarantee_: deadline enforcement, slippage-bound compliance,
recurring intents that auto-execute under a standing signed authorization.

Scope is decomposed post-v2; the shape is already committed.

- [ ] **Deadline enforcement** — server-side rejection of expired intents;
      drawer blocks sign once `deadline − clockSkew < 30s`
- [ ] **Slippage bounds** — `minReceive` enforced at settlement; refund on
      breach with on-chain evidence
- [ ] **Recurring intents** — standing-order semantics (signed
      authorization with per-period cap and hard stop date)
- [ ] **Execution SLA** — per-anchor SLA card: p50/p95/p99 settle latency
      with 30-day trailing window
- [ ] **Refund guarantees** — automatic refund flow with user-signed
      acknowledgement
- [ ] **Dispute resolution** — documented escalation ladder + public
      adjudication log
- [ ] **Per-corridor intent templates** — save-and-reuse for common
      remittance patterns

**v3 release gate.**

- [ ] Slippage-bound compliance ≥ 99.5% over 10k intents
- [ ] 0 unsignaled refunds in the trailing 30 days
- [ ] Recurring-intent e2e green across all live corridors
- [ ] Public dispute log with ≥5 resolved cases

---

## v4 Universal

**Thesis.** Stellar Intel becomes the default execution layer for any
surface that moves value through a stablecoin corridor — wallets, agents,
terminal UIs, embeddable widgets. The primitives are already there; v4 is
the distribution wave.

- [-] **`@stellarintel/sdk` on npm** — typed TS client for the HTTP API +
  MCP; React hooks; three reference integrations. `packages/sdk` built
  (#981); **not yet published (npm 404) — see `maintainer.md` Phase 0**
- [-] **`@stellarintel/mcp` on npm** — GA MCP server, versioned, with a
  signed CHANGELOG. `packages/mcp` built; not yet published
- [ ] **Embeddable widget** — `<StellarIntelWidget />` React component +
      vanilla JS drop-in for non-React sites
- [ ] **Agent-safety hardening** — per-caller rate limits, scoped JWTs,
      audit log export
- [ ] **Partner-surface kit** — branded widget variants, co-marketing
      toolkit, anchor onboarding SDK
- [ ] **Cookbook v2** — ten production recipes across web, agent, wallet,
      and Soroban-consumer surfaces
- [ ] **Ecosystem integrations** — at least three third-party
      (wallet / agent framework / aggregator) integrations merged upstream

**v4 release gate.**

- [ ] SDK + MCP both on npm with semver-stable major releases
- [ ] ≥3 external projects depending on `@stellarintel/sdk` or `@stellarintel/mcp`
      (discoverable on npm download graph)
- [ ] Widget embedded on ≥1 partner production site

---

## v5 Institutional

**Thesis.** The reputation oracle, the router, and the agent surface are
by this point table-stakes. v5 hardens every one to a compliance posture
an institutional partner (a regulated fintech, a large wallet, a payment
processor) can build on.

- [ ] **Third-party security audit** of the Soroban contract +
      `lib/stellar/*` + the publisher service; report published
- [ ] **SBOM on every release** via CycloneDX
- [ ] **Signed releases** — GPG-signed tags + signed npm packages via
      Sigstore
- [ ] **Non-custody attestation** — annual attestation letter from
      counsel, published in `docs/attestations/`
- [ ] **Jurisdictional compliance matrix** — per-country memo covering MSB
      / VASP / e-money classification; reviewed annually
- [ ] **Key-rotation program** — quarterly publisher key rotation with
      public ceremony records
- [ ] **Institutional reporting** — per-tenant usage, reputation data
      export, SLA dashboard
- [ ] **Formal dispute-arbitration track** — human reviewer roster with
      published credentials, bonded stake
- [ ] **Threat-model refresh** — annual exercise with external red team

**v5 release gate.**

- [ ] Audit report published with zero unresolved critical or high findings
- [ ] SBOM on every release in the trailing 12 months
- [ ] First institutional partner in production on v5 primitives

---

## v6 Ecosystem Infrastructure

**Thesis.** By this point the execution layer, the reputation oracle, and
the agent surface are proven. v6 is the ecosystem-infrastructure endgame:
push the SDK surface into languages the TypeScript ecosystem doesn't reach,
open the API up to event-driven and query-flexible consumers, give
third-party developers a real front door, and start moving control away
from a single team's keys. Tracked as epic
[#808](https://github.com/ezedike-evan/stellar-intel/issues/808); scope
decomposed into the child issues below.

- [x] **Rust SDK with on-chain Soroban-native oracle reads** — generated
      from the OpenAPI spec like the TS (`#806`) and Python (`#821`) SDKs,
      plus a read path that queries the corridor rate oracle contract
      directly over Soroban RPC, independent of the REST API being up
      ([#868](https://github.com/ezedike-evan/stellar-intel/issues/868)).
      `crates/stellar-intel-client` (#982); not yet on crates.io
- [x] **Webhooks with HMAC signing** — subscribe to intent/settlement
      lifecycle events instead of polling; signed deliveries, retry with
      backoff, dead-letter after repeated failures
      ([#869](https://github.com/ezedike-evan/stellar-intel/issues/869)).
      `app/api/webhooks/*` + `lib/webhooks/sign.ts`
- [x] **GraphQL layer (additive)** — query corridor rates, anchor
      reputation, and intent status in one round trip, alongside the REST
      API rather than replacing it
      ([#870](https://github.com/ezedike-evan/stellar-intel/issues/870)).
      `app/api/graphql/route.ts` + `lib/graphql/*`. **Prod caveat: the live
      endpoint currently 500s (durable store unconfigured) — see
      `maintainer.md` Phase 0.**
- [x] **Developer portal + interactive docs** — browsable API reference
      generated from `public/openapi.json`, an interactive console against
      a sandboxed environment, and SDK quickstarts in one place
      ([#871](https://github.com/ezedike-evan/stellar-intel/issues/871)).
      `/docs` console (#980, #235)
- [x] **Multi-corridor oracle expansion (v2, with migration path)** — the
      rate oracle covers more than its launch corridor without breaking
      third-party contracts already reading v1
      ([#825](https://github.com/ezedike-evan/stellar-intel/issues/825))
- [x] **On-chain volume + savings oracle** — an independently verifiable
      "fees saved" metric, published on-chain from the same outcome log
      reputation scoring already uses, not asserted only by this app's
      backend ([#826](https://github.com/ezedike-evan/stellar-intel/issues/826))
- [x] **Versioning/deprecation policy + community contribution
      infrastructure** — a written contract for what `API-Version` actually
      guarantees, and a CONTRIBUTING.md that covers the multi-language
      reality once the Rust/Python SDKs exist
      ([#827](https://github.com/ezedike-evan/stellar-intel/issues/827))
- [-] **Fully decentralized architecture** — multisig-governed contracts,
  community-maintained SDKs, on-chain as the source of truth rather
  than this app's backend as a trust bottleneck
  ([#875](https://github.com/ezedike-evan/stellar-intel/issues/875)).
  In flight: two-step upgrade-admin rotation (`feat/963`, `tests/multisig.rs`);
  2-of-3 admin still pending

**Parked — unscoped primitives.** Four of the seven "surviving 1000x"
primitives scoped under the original Horizon-3 structure have no child issue
above. Each is gated on something that does not exist yet, which is why no
wave claimed them. Recorded here so the sequencing is not lost; placement is
still open.

- [ ] **Recurring intents / subscription remittance** — sign once, later
      executions run without a fresh signature. Gated on wallet pre-auth
      standards: Freighter exposes no pre-authorization primitive today, so
      this cannot start until that lands upstream
- [ ] **Settlement-guaranteed SLA** — gated on ~10k actuarial observations
      before a guarantee can be priced; start with $100 caps. Reads the same
      outcome log the reputation write path already produces
- [ ] **Chained atomic execution** — on-ramp → swap → yield in one signature.
      Deferred modules return as solver hops, not standalone tabs: a routing
      concern inside the existing intent router, not new surface area
- [ ] **Universal intent collapse** — one input, one signature, any outcome.
      Ship the identity only after execution volume exists; it is a
      positioning claim that needs volume behind it, so it sequences last
      deliberately

The remaining three are already covered above: canonical on-chain corridor
rates by the multi-corridor oracle expansion plus the Soroban-native read
path; the verifiable half of the credit layer by the on-chain volume/savings
oracle (the credit product itself is Year 2+, gated on regulatory memo and
capital); and the agent-native surface by the SDK and developer-portal work.

**v6 release gate.** Mirrors the H3 success bar this wave was originally
scoped under, before this document moved from a Horizon-based structure to
the wave structure above.

- [ ] Corridor rate oracle read by ≥ 1 third-party contract
- [ ] Recurring remittance alpha live
- [ ] SLA pilot running with cost caps
- [ ] The "ripped out" test passes: if this app's backend disappeared
      entirely, the on-chain data it publishes remains independently
      readable and meaningful

---

## Deliberately deferred

Three modules are **not** on this roadmap, at any wave. They are omitted on
purpose, and the omission is the product decision — not a gap waiting to be
filled.

- **On-ramp module** — fiat → stablecoin entry
- **Yield module** — parking stablecoin balances in a rate-bearing venue
- **Swap module** — a standalone asset-exchange surface

**Why.** Shipping four modules at once is width without depth, and width
without depth loses regardless of who is reading. The unoccupied
lane is anchor intelligence — the health, reputation, and execution record of
the last mile — and it is unoccupied precisely because it is unglamorous and
slow to accumulate. Every module added before that lane is genuinely held
splits the effort that holds it.

This is not a permanent ban. Two of the three already have a re-entry path
that does not reopen them as tabs: v3's chained atomic execution treats the
deferred modules as **solver hops inside the existing intent router**, a
routing concern rather than new surface area. Anything that cannot arrive
that way waits until execution volume exists to justify it.

_Previously tracked as the anti-goals section of epic
[#795](https://github.com/ezedike-evan/stellar-intel/issues/795), which this
document supersedes._

---

## Cross-cutting tracks

These do not belong to a single wave — they run in parallel and every
wave advances them.

**Docs** — the ten load-bearing doc files listed in
[`maintainer.md § 3`](../maintainer.md) are updated alongside the code
that changes their subject. A wave does not ship with out-of-date docs.
Analytics documentation lives in [`docs/ANALYTICS.md`](ANALYTICS.md).

**Observability** — every wave extends the metric surface. v1.3 seeds
the logger + counters; v2.1 adds publisher metrics; v3 adds SLA
dashboards; v5 adds per-tenant reporting.

**Security & compliance** — tracked in
[`docs/SECURITY.md`](SECURITY.md), [`docs/THREAT_MODEL.md`](THREAT_MODEL.md),
[`docs/NON_CUSTODY.md`](NON_CUSTODY.md), [`docs/JURISDICTIONAL.md`](JURISDICTIONAL.md).
These four documents must remain internally consistent — a PR that breaks
any one is a PR that breaks all four.

**Community & contribution ladder** —
[`docs/CONTRIBUTOR_LADDER.md`](CONTRIBUTOR_LADDER.md) defines Triager →
Reviewer → Maintainer. Every wave's PR burndown names contributors;
every release note credits them.

**Benchmarks** — [`docs/BENCHMARKS.md`](BENCHMARKS.md) is updated every
wave with corridor latency, quote-to-signed time, split-vs-single
savings, and per-anchor success rate. Numbers stale by > 60 days block
the next release gate.

---

_Scope is promissory; dates are not. We ship on gates, not dates. If a
wave slips, the release gate slips with it — never the quality bar._

_See also: [`docs/PROPOSAL.md`](PROPOSAL.md) for the strategic thesis,
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md) for the system design, and the
[GitHub issue tracker](https://github.com/Ezedike-Evan/stellar-intel/issues) for the line-level scope._
