# Stellar Intel — Roadmap

> Five milestone versions, tickable. Mirror of the wave structure in
> [`issue.md`](../issue.md) (250 engineering tickets) — this document is the
> product-level view a grant reviewer, contributor, or anchor partner reads
> to know **what ships next** and **in what order**.

**Legend.** `[x]` shipped on `main` today · `[-]` in flight · `[ ]` planned.
Ticket ranges point back to numbered issues in
[`issue.md`](../issue.md) where the line-level scope lives.

**Ship discipline.** Each wave has a **release gate** — a single named
command plus a named condition — that must be green before the next wave
opens. A wave does not open early. A wave does not ship partial.

---

## Table of contents

- [At a glance](#at-a-glance)
- [v1 Executable](#v1-executable) — a correct, demonstrable off-ramp
  - [Wave 1.0 Core Executable](#wave-10--core-executable) (`#001–#070`)
  - [Wave 1.1 Hardening + SEP-38](#wave-11--hardening--sep-38) (`#071–#110`)
  - [Wave 1.2 Router + Seeds](#wave-12--router--seeds) (`#111–#140`)
  - [Wave 1.3 Polish + Release Gate](#wave-13--polish--release-gate) (`#141–#150`)
- [v2 Observable](#v2-observable) — reputation as a product surface
  - [Wave 2.0 Reputation as Product Surface](#wave-20--reputation-as-product-surface) (`#151–#180`)
  - [Wave 2.1 Soroban Oracle Live](#wave-21--soroban-oracle-live) (`#181–#205`)
  - [Wave 2.2 Multi-Anchor Split Routing](#wave-22--multi-anchor-split-routing) (`#206–#230`)
  - [Wave 2.3 Public Reputation API + Bootstrap](#wave-23--public-reputation-api--bootstrap) (`#231–#250`)
- [v3 Guaranteed](#v3-guaranteed) — intent-level SLAs
- [v4 Universal](#v4-universal) — SDK + MCP GA + embeddable widget
- [v5 Institutional](#v5-institutional) — compliance-grade primitives
- [Cross-cutting tracks](#cross-cutting-tracks)

---

## At a glance

| Version              | Theme                                                 | Scope                               | Target gate                                                                | Status                            |
| -------------------- | ----------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------- | --------------------------------- |
| **v1 Executable**    | A correct, demonstrable off-ramp                      | `#001–#150` · 150 tickets · 4 waves | `npm run test:release` green; feature flags default-on                     | 🟢 Wave 1.0 substantially shipped |
| **v2 Observable**    | Reputation as product surface, Soroban on mainnet     | `#151–#250` · 100 tickets · 4 waves | Soroban contract deployed, ≥3 publishers, ≥1000 outcomes                   | ⚪ Not started                    |
| **v3 Guaranteed**    | Intent-level SLAs, slippage bounds, recurring intents | Planned · scope decomposed post-v2  | Slippage-bound compliance ≥ 99.5% over 10k intents                         | ⚪ Not started                    |
| **v4 Universal**     | SDK + MCP GA + embeddable widget                      | Planned · scope decomposed post-v3  | `@stellarintel/sdk` + `@stellarintel/mcp` on npm; 3 reference integrations | ⚪ Not started                    |
| **v5 Institutional** | Compliance-grade primitives, audit-ready              | Planned · scope decomposed post-v4  | Third-party audit report published; SBOM on every release                  | ⚪ Not started                    |

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

- [ ] `contracts/oracle/src/lib.rs` scaffold with `publish_outcome` stub
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

**v1 release gate.**

- [ ] All 150 issues closed (`#001–#150`)
- [ ] `npm run test:release` green
- [ ] Feature flags `INTENT_FLOW` and `REPUTATION_WRITE` default-on
- [ ] MCP server publishable (`npm publish --dry-run` green)
- [ ] 90-second demo video + 6 annotated screenshots in `docs/showcase/`
- [ ] `CHANGELOG.md` tagged with a dated release note
- [ ] Git tag `v1.0.0` pushed

> **When this gate is green, v1 ships and Wave 2.0 opens.**

---

## v2 Observable

**Thesis.** The reputation data that v1 writes silently becomes the
product's centre of gravity. The Soroban oracle goes live on mainnet.
Split routing unlocks. A public reputation API and a probe network
bootstrap coverage before organic volume arrives. This is where the moat
compounds.

### Wave 2.0 — Reputation as Product Surface

> Tickets: `#151–#180`. The data v1 wrote to `ReputationStore` becomes
> visible UX.

- [ ] `#151` Anchor scorecard card — fill rate, settle time, slippage
- [ ] `#152` Scorecard integrated into `RateTable` row expansion
- [ ] `#153` Scorecard detail modal on click
- [ ] `#154` Historical timeline chart per anchor
- [ ] `#155` Public leaderboard page at `/anchors`
- [ ] `#156` Per-corridor leaderboard view (`/anchors?corridor=usdc-ngn`)
- [ ] `#157` `GET /api/reputation/leaderboard?corridor` endpoint
- [ ] `#158` `GET /api/reputation/:anchor/history?window` endpoint
- [ ] `#159` **Composite score formula** (blocks `#151`, `#155`, `#157`, `#172`, `#180`)
- [ ] `#166` "Flag incorrect outcome" on terminal states → dispute
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

- [ ] `#181` Multi-signer admin (2-of-3) on the oracle contract
- [ ] Publisher whitelist management (`add_publisher` / `remove_publisher`)
- [ ] `publish_outcome` — full signature verification + idempotency
- [ ] `read_outcome` + `read_aggregate` public reads
- [ ] 7-day time-locked upgrade path
- [ ] `#189` Publisher service (production key rotation, health endpoint)
- [ ] `#190–#192` Publisher retries, dead-letter, Sentry wiring
- [ ] `#194` Contract deployed to Soroban testnet, e2e green
- [ ] `#195` Contract deployed to Soroban **mainnet**
- [ ] `#200` Publisher service e2e against testnet
- [ ] `#201` Public TypeScript read SDK (`packages/sdk/oracle.ts`)
- [ ] `#202` JS example consumer
- [ ] `#203` Python example consumer
- [ ] `#204` Publisher cron metrics dashboard
- [ ] `#205` Full reputation chain e2e — outcome to oracle read

**Wave 2.1 release gate.**

- [ ] Contract verifiably deployed on Soroban mainnet (explorer link in `README.md`)
- [ ] ≥3 publishers on the whitelist (ours + 2 community signers)
- [ ] ≥1000 outcomes on-chain
- [ ] TypeScript + JS + Python example consumers all green
- [ ] Independent audit pass (single firm) of the Soroban contract

---

### Wave 2.2 — Multi-Anchor Split Routing

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

**Wave 2.2 release gate.**

- [ ] All `#206–#230` closed
- [ ] Across last 30 days of synthetic probes, split plans deliver ≥1% more
      landed value than best-single on ≥20% of above-threshold intents
- [ ] Atomicity invariant holds in property-based tests (10k scenarios)

---

### Wave 2.3 — Public Reputation API + Bootstrap

> Tickets: `#231–#250`. Bootstrap the dataset before organic volume
> arrives. Expose it publicly. Document it loudly.

- [ ] `#231` `GET /v1/public/scores` (anchor, corridor) → score
- [ ] `#232` `GET /v1/public/outcomes` paginated feed
- [ ] `#233` Rate limits + API-key tier (free / paid)
- [ ] `#234` OpenAPI spec checked into `docs/openapi.yaml`
- [ ] `#235` `api-docs` page at `/docs/api` (Redoc / Scalar)
- [ ] `#239` **Probe service** (independent track) — nightly $1 synthetic
      off-ramps to seed corridor coverage
- [ ] `#240` Probe-signal reputation weighting (lower weight than organic)
- [ ] `#241` Publisher key rotation ceremony (documented, dry-run)
- [ ] `#245` Anchor onboarding flow — self-serve signup, TOML validation,
      `good-first-reputation-event` tutorial
- [ ] `#250` v2 release-gate sign-off suite (`npm run test:release:v2`)

**v2 release gate.**

- [ ] All 100 additive issues closed (`#151–#250`)
- [ ] `npm run test:release:v2` green
- [ ] Soroban reputation contract verifiably deployed on mainnet
- [ ] ≥3 publishers on whitelist
- [ ] ≥1000 reputation outcomes on-chain
- [ ] Public `/v1/*` endpoints responding with rate limits
- [ ] Probe service running nightly against all live corridors
- [ ] Git tag `v2.0.0` pushed

> **When this gate is green, v2 ships and Wave 3 opens.**

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

- [ ] **`@stellarintel/sdk` on npm** — typed TS client for the HTTP API +
      MCP; React hooks; three reference integrations
- [ ] **`@stellarintel/mcp` on npm** — GA MCP server, versioned, with a
      signed CHANGELOG
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

## Cross-cutting tracks

These do not belong to a single wave — they run in parallel and every
wave advances them.

**Docs** — the ten load-bearing doc files listed in
[`maintainer.md § 3`](../maintainer.md) are updated alongside the code
that changes their subject. A wave does not ship with out-of-date docs.

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
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md) for the system design, and
[`issue.md`](../issue.md) for the 250-ticket line-level scope._
