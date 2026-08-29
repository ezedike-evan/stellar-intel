# Stellar Intel — Master Goals List

**Consolidated from:** rejection analysis · 10x/1000x strategy memo · engineering plan (70 tasks) · production audit · July 2026 repo state · ecosystem cross-reference (Anchor Directory, ROZO, RedStone/Reflector/Chainlink, SCF 7.0)

**North star:** Become the execution and accountability layer for Stellar's anchor network — live corridor rates, verified anchor track records on Soroban, consumable by wallets, apps, and AI agents. The universal intent primitive is the long arc, not the headline.

**Infrastructure test (the "ripped out" test):** Stellar Intel is infrastructure when external systems read it — wallets embed its rates, contracts read its oracle, agents call its MCP — and removing it would break them.

**As of 2026-08-06.** Several H1–H3 items below landed on `main` since the July snapshot and are now ticked: scoring methodology published, production audit regenerated, Audit Bank application assembled, Python + Rust SDKs, webhooks + GraphQL, developer portal, multi-corridor + volume/savings + corridor-rate oracles. The open work is the security / production-readiness / S-tier program in [`maintainer.md`](maintainer.md) — including that the live GraphQL endpoint 500s, the reputation record renders empty in prod (unconfigured store), and the SDKs are built but unpublished.

---

## ✅ Horizon 0 — Already achieved (verified in repo, July 2026)

- [x] Fix critical bug #1: `exchangeRate: 0` — rates now parsed, validated, rows with rate ≤ 0 rejected
- [x] Fix critical bug #2: StatusTracker wiring after execution
- [x] Merge the two anchor registries into one source of truth (constants/anchors.ts, re-exported with anti-drift guard)
- [x] Remove all mock data and `isMock` indicators from production paths
- [x] Evidence-based anchor curation with verification dates (NGNC, MyKobo, nTokens, Zeam, Anclap, Cowrie, MoneyGram) and documented exclusions (fchain, ultracapital)
- [x] Full SEP client stack: SEP-1 / 6 / 10 / 12 / 24 / 38 with TOML cache, JWT cache, retry, status maps
- [x] 10x seed #1: intent API — `POST /api/intent/offramp` returning unsigned tx + quoteId
- [x] 10x seed #2: reputation events/store — SQLite + Postgres, migrations, composite scoring, disputes + admin surface, probes, reconciliation, PII redaction
- [x] 10x seed #3: MCP server — `intel.offramp.quote` / `intel.offramp.prepare` tools
- [x] Soroban reputation contract in Rust (publishers, history, scoring, upgrade path) with 13 test suites — **deployed to testnet 2026-07-09**
- [x] Rust consumer crate + publisher package
- [x] Nightly anchor-health validator with auto-degrade ledger
- [x] Erst-grade substrate: ~114 test files, husky pre-commit/pre-push, commitlint, CI, OpenAPI, strict linting docs
- [x] Doctrine documentation: THREAT_MODEL, JURISDICTIONAL memo, ORACLE_SPEC, SEP_COMPLIANCE, NON_CUSTODY, SECURITY, INTENT_API, ANCHOR_REPUTATION, ROADMAP, PROPOSAL

---

## 🎯 Horizon 1 — Rung 1: Data infrastructure + grant resubmission (now → ~month 3)

### Reputation cold-start inversion (new priority — highest leverage)

- [ ] Run continuous anchor probes across every registered anchor: uptime, TOML integrity, issuer-mismatch, quote latency, quote-drift (probe.ts exists — activate and schedule it; health ledger currently shows `lastStatus: unknown`)
- [ ] Accumulate ≥ 90 days of probe observations before any mainnet oracle publish
- [x] Publish the scoring methodology publicly (transparency = the trust product) — `docs/ANCHOR_REPUTATION.md`
- [-] Write probe-derived data to the testnet contract on a schedule (publisher tick wired to the testnet oracle; cron cadence in flight)
- [ ] Reframe headline: "anchor health monitor + reputation for Stellar" first; execution-derived reputation layers on later

### Grant resubmission (SCF 7.0, Open Track)

- [ ] Rewrite the pitch around the narrowed identity: execution + accountability layer for Stellar anchors (drop "universal intent layer" branding — ROZO owns that vocabulary)
- [ ] Add an explicit ROZO differentiation paragraph: they abstract chains (pay/bridge via CCTP); we abstract anchors (fiat exit price + trust). Ideally note an integration conversation has been opened
- [ ] Position as the live-data complement to SDF's Anchor Directory (which is static and lists reserve attestation as "coming soon")
- [ ] Exploit SCF 7.0's launch-weighted payout model (10–20–30–40%) — emphasize proximity to mainnet
- [x] Apply to the Soroban Security Audit Bank for the reputation contract audit (free, SCF-coordinated) — application materials assembled (#976)
- [x] Regenerate the production audit — `docs/PRODUCTION_AUDIT.md` (#974) replaces the stale April documents
- [ ] Submission demo: one corridor (USDC→NGN), live SEP-38/SEP-24 rates, working end-to-end execution, health badges, testnet oracle reads

### Remaining engineering-plan items still open

- [ ] Real solver routing in the intent API (current routing is first-match per corridor — placeholder)
- [ ] Rate table sorting UI
- [ ] Rate limiting on public API routes (partially present — verify coverage)
- [ ] Server-side response caching (`stale-while-revalidate` on rate endpoints)
- [ ] Legal disclaimers / Terms of Service (financial product handling real money)
- [ ] SEO: OG tags, sitemap, robots.txt
- [ ] Analytics / funnel tracking
- [ ] UI retention pass: brand identity (Stellar purple→teal space, wordmark), rate-freshness countdown, trust bar, anchor logos, rate-history sparklines
- [ ] Accessibility fixes: focus trap in ExecuteDrawer, aria-live for rate updates, contrast fixes

---

## 🎯 Horizon 2 — Distribution + Rung 2: Execution infrastructure (months 3–9)

### Distribution through wallets, not the consumer UI (new priority)

- [ ] Pull P9.3 (ecosystem integrations) from month 14 to now: pitch Lobstr / Beans / Decaf / Solar on embedding rates + health badges via the SDK — the ~50-line integration
- [ ] Land ≥ 1 wallet embed (each embed generates more executed-intent reputation data than the standalone site will)
- [ ] Pull P9.4 forward: contribute anchor health data back to SDF's Anchor Directory — cheap legitimacy, SDF relationship
- [ ] Pursue ROZO integration: their intents need last-mile fiat-exit quality data — converts the narrative threat into a validator
- [ ] Agent-surface differentiation: publish MCP/agent docs making explicit that ROZO = pay/bridge, Stellar Intel = price/rank/exit-to-fiat with trust scores

### 10x execution layer

- [ ] SEP-38 firm quotes surfaced in UI with expiry countdown; quote_id passed into SEP-24 withdraw
- [ ] Signed-intent → atomic-transaction flow proven on one corridor (USDC→NGN)
- [ ] Multi-anchor order splitting via Stellar multi-op atomicity (after single-anchor flow is proven)
- [ ] Intermediate strategic inversion: anchors depend on Stellar Intel for _reputation standing_ (carrot: top-ranked anchors get surfaced first) — order-flow dependence comes later
- [ ] Anchor coverage expansion, evidence-based as before (MoneyGram programmatic access is partnership-gated — flag and pursue the BD path; Cowrie SEP-6 rates are indicative-only — label honestly)
- [ ] Mainnet oracle launch: post-audit, seeded with the 90-day probe dataset (never launch an empty credit bureau)
- [ ] Anchor health monitor exposed via public API (`/api/v1/anchors/:id/health`)
- [ ] Public REST API v1 hardened: versioning, error envelope, rate-limit headers, idempotency keys
- [ ] TypeScript SDK to npm (generated from OpenAPI; retry/idempotency built in; 30-seconds-to-first-success)

### Deliberately deferred (anti-goals for this window)

- [ ] ~~On-ramp module~~ — defer until the off-ramp + reputation lane is won
- [ ] ~~Yield module~~ — defer; commodity territory, covered elsewhere
- [ ] ~~Swap module~~ — defer; Soroswap's aggregator occupies this
- Rationale: shipping four modules again is the exact failure mode that caused the first rejection. Width without depth loses; the unoccupied lane is anchor intelligence.

---

## 🎯 Horizon 3 — Rung 3: Financial infrastructure / the 1000x arc (months 9–24)

### Surviving 1000x primitives, re-sequenced

- [x] **Canonical on-chain corridor rates** (primitive V — now the _strongest_ claim): block-level USDC-NGN / KES / MXN / PHP rates from live execution + probe data. RedStone/Chainlink/Reflector do crypto & RWA prices only; nobody publishes emerging-market corridor FX. Promote from side effect to flagship — `contracts/reputation/src/corridor_rate.rs` (#983); testnet, mainnet pending
- [ ] **Recurring intents / subscription remittance** (primitive IV): sign once — "send $500 home every 1st at best rate." Genuinely undone by anyone; gated on wallet pre-auth standards
- [ ] **Settlement-guaranteed SLA** (primitive III): launches only when actuarial data exists (~10k observations; probes accelerate this). Start with $100 caps
- [ ] **Chained atomic execution** (primitive II): on-ramp → swap → yield in one signature — this is when the deferred modules return, as _hops inside the solver_, not tabs
- [ ] **Universal intent collapse** (primitive I): one input / one signature / any outcome — the UI, API, and SDK collapse. Architecture already seeded (intent API + canonical JSON); ship the identity only after execution volume exists
- [ ] **Agent-native surface at scale** (primitive VI): intel.execute for any agent with a wallet moving value in emerging markets
- [ ] **Credit layer on observed flow** (primitive VII): Year 2+, gated on regulatory memo + capital; lend against proven remittance history

### Ecosystem-infrastructure endgame

- [x] Python + Rust SDKs (Rust with on-chain Soroban-native oracle reads — the architecturally distinct one) — `packages/python-sdk` (#821), `crates/stellar-intel-client` (#982); neither published yet
- [x] Webhooks with HMAC signing; GraphQL layer (additive) — `app/api/webhooks/*` + `lib/webhooks/sign.ts` (#869), `app/api/graphql` + `lib/graphql/*` (#870, currently 500ing in prod)
- [x] Developer portal + interactive docs — `/docs` console (#980)
- [x] Multi-corridor oracle expansion (v2 with migration path) — #825
- [x] On-chain volume + savings oracle (independently verifiable "fees saved" metric) — `contracts/reputation/src/volume_savings.rs` (#826)
- [ ] Versioning/deprecation policy; community contribution infrastructure
- [ ] Fully decentralized architecture: multisig-governed contracts, community-maintained SDKs, on-chain as truth

---

## 🔁 Continuous doctrine goals (never "done")

- [ ] The 3 AM test: an engineer who has never seen the codebase can triage a stuck off-ramp in <30 min via runbook + correlation ID + structured logs
- [ ] Non-custodial invariant: no private key ever crosses into Stellar Intel code; single audited signing path
- [ ] Parse-don't-validate at every external boundary; illegal states unrepresentable
- [ ] Conformance suite pinned to captured anchor fixtures; live daily conformance breaks loudly on anchor shape changes
- [ ] Per-anchor circuit breakers, timeouts, kill-switch flags; graceful degradation ordered live → cached → labeled estimate, never fabricated
- [ ] Reputation events written from every transaction (cannot be retroactively accumulated)
- [ ] HSM/KMS for oracle admin key from day one; migration path to multisig
- [ ] Blameless postmortems; public status page once there are external consumers

---

## ⚠️ Risks to actively retire

- [ ] **Cold-start reputation** → retired by the probe-first strategy (Horizon 1)
- [ ] **ROZO narrative collision** → retired by explicit differentiation + integration pursuit
- [ ] **Thin anchor supply per corridor** → retired by evidence-based expansion + MoneyGram BD track
- [ ] **Consumer-distribution weakness (retention grade C)** → retired by wallet-embed strategy (B2B2C)
- [ ] **Regulatory (MSB/VASP) exposure** → JURISDICTIONAL.md exists; commission a real jurisdictional review before mainnet SLA/recurring products
- [ ] **Anchor cooperation pushback on being ranked** → carrot design: top-ranked anchors get order flow; start with cooperative anchors
- [ ] **Stale strategy documents** → regenerate audit + memo against the July repo before resubmission

---

## 📊 Success metrics per horizon

| Horizon          | The bar                                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| H1 (month 3)     | Grant resubmitted; 90 days of probe data accumulating; contract audit scheduled; one corridor executing end-to-end on live data                 |
| H2 (month 9)     | Mainnet oracle live with seeded data; ≥1 wallet embed reading the API; ≥1 external MCP/agent consumer; first executed-intent reputation entries |
| H3 (month 18–24) | Corridor rate oracle read by ≥1 third-party contract; recurring remittance alpha; SLA pilot with caps; the "ripped out" test passes             |
