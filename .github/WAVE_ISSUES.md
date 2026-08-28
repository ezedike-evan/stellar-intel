# Wave Issues — Stellar Intel (Phase 1 + Phase 2 foundations)

> Source file for [`create-wave-issues.js`](./create-wave-issues.js).
>
> Scope: Engineering deliverables open to community contributors across seven
> workstreams — SEP-6 support, anchor fleet, split routing, Soroban oracle
> depth, SDK and public API, UI/landing, and community health.
>
> **Numbering.** `issue.md` owns `#001–#250`; `issues-batch-2.md` owns
> `B001–B100`. Wave issues start fresh at `W1.1`. Do not overlap with either
> existing batch. Major groups: 1 = SEP-6, 2 = anchor fleet + reputation,
> 3 = split routing + intent, 4 = Soroban oracle depth, 5 = SDK + public API
>
> - MCP, 6 = UI (landing + scorecard), 7 = community health + docs.
>
> **Body format.** Every issue: `Complexity`, `Milestone`, `Context`,
> `Problem`, `What needs to be done`, `Key files`, `Done when`.
>
> **Architecture notes.**
>
> - The reputation oracle (`contracts/reputation/`) is a Soroban contract; the
>   publisher writes outcomes on-chain; the web app reads scores off-chain via
>   `/api/reputation/*` + direct RPC reads.
> - Non-custodial by design: every withdrawal leg is user-signed via Freighter;
>   Stellar Intel never holds funds or private keys.
> - SEP-6 is wired as Tier-3 fallback (indicative only); SEP-38 = Tier-1,
>   SEP-24 indicative = Tier-2.

---

## Workstream 1 — SEP-6 Enablement (W1.1 onwards)

Cowrie and several other transfer-capable anchors support only SEP-6, not
SEP-24. They are silently dropped from the rate table today. This workstream
closes that gap.

---

### W1.1 — `lib/stellar/sep6.ts` module scaffold

**Complexity:** Trivial — 100 Points · `type:feature`

**Milestone:** v1.4 SEP-6

**Context**
`lib/stellar/sep24.ts` covers the interactive withdraw path. SEP-6 provides a programmatic (non-interactive) withdrawal alternative used by anchors that don't support popup flows.

**Problem**
No SEP-6 module exists; anchors advertising only `TRANSFER_SERVER` are silently skipped.

**What needs to be done**

1. Create `lib/stellar/sep6.ts` with `hasSep6(toml): boolean` reading `TRANSFER_SERVER`.
2. Export `getSep6TransferServer(toml): string` throwing a typed `AnchorCapabilityError` when absent.
3. No network calls — pure TOML inspection + types.

**Key files**

- New: `lib/stellar/sep6.ts`
- `lib/stellar/errors.ts`

**Done when**

- `hasSep6` returns true for TOML with `TRANSFER_SERVER`, false otherwise. Typecheck + lint green.

---

### W1.2 — SEP-6 `/info` Zod schema

**Complexity:** Trivial — 100 Points · `type:feature`

**Milestone:** v1.4 SEP-6

**Context**
SEP-6 `/info` advertises supported assets, fees, and required fields. `lib/stellar/sep38-schemas.ts` is the pattern to follow.

**Problem**
No schema; responses are `unknown` at the boundary.

**What needs to be done**

1. Create `lib/stellar/sep6-schemas.ts` with `Sep6InfoSchema` covering `deposit`/`withdraw` asset maps.
2. Each asset entry: `enabled`, `fee_fixed`, `fee_percent`, `min_amount`, `max_amount`, `fields`.
3. Export inferred TypeScript types.

**Key files**

- New: `lib/stellar/sep6-schemas.ts`
- New: `tests/sep6-schemas.spec.ts`

**Done when**

- Schema parses a real Cowrie `/info` fixture. Invalid payload throws Zod error, not runtime crash.

---

### W1.3 — `getSep6Info` fetcher with timeout

**Complexity:** Medium — 150 Points · `type:feature`

**Milestone:** v1.4 SEP-6

**Context**
`server-rates.ts` uses `withTimeout` (8 s) for all anchor calls. SEP-6 info fetch must match.

**Problem**
No fetcher for SEP-6 `/info`.

**What needs to be done**

1. Implement `getSep6Info(transferServer, assetCode)` with `withTimeout` semantics.
2. Return `{ enabled, feeFixed, feePercent, min, max, fields }` for the requested asset.
3. Throw typed `AnchorCapabilityError` when asset absent or `enabled === false`.

**Key files**

- `lib/stellar/sep6.ts`
- New: `tests/sep6.spec.ts`

**Done when**

- Returns correct fee fields from a fixture. Throws on disabled asset. Timeout path covered.

---

### W1.4 — `sep6IndicativeRate` from `/info` fees

**Complexity:** Medium — 150 Points · `type:feature`

**Milestone:** v1.4 SEP-6

**Context**
Tier-3 rate derivation exists for SEP-24 anchors. SEP-6 needs the same to appear on the rate table.

**Problem**
No indicative rate derivation for SEP-6 anchors.

**What needs to be done**

1. Add `sep6IndicativeRate(anchor, toml, fiatCode, corridorId, amount)`.
2. Apply `getUsdFxRate` exactly as the SEP-24 indicative path does.
3. Return `AnchorRate` with `source: 'sep6-info'`.
4. Throw when derived `totalReceived` is non-finite or ≤ 0.

**Key files**

- `lib/stellar/sep6.ts`
- `tests/sep6.spec.ts`

**Done when**

- $100 USDC→NGN with known fee produces correct `totalReceived`. Zero/negative result throws.

---

### W1.5 — Add `'sep6-info'` to `AnchorRate.source` union

**Complexity:** Trivial — 100 Points · `type:refactor`

**Milestone:** v1.4 SEP-6

**Context**
`AnchorRate.source` currently allows `sep38` and `sep24-fee`. A new discriminant is needed so UI renders the correct tier badge.

**Problem**
Adding SEP-6 rates without extending the union hits a TypeScript error at every exhaustive switch.

**What needs to be done**

1. Extend `source` union in `types/index.ts`.
2. Update exhaustive switches in `QuotePill` and `RateTable`.
3. Add `"SEP-6 est."` tier label in the UI.

**Key files**

- `types/index.ts`
- `components/offramp/RateTable.tsx`
- `lib/format.ts`

**Done when**

- Typecheck forces all `source` switches to handle `sep6-info`. No `default`-swallowed cases.

---

### W1.6 — Wire SEP-6 as Tier-3 fallback in `fetchCorridorRates`

**Complexity:** High — 200 Points · `type:feature`

**Milestone:** v1.4 SEP-6

**Context**
This is the change that makes Cowrie appear on USDC→NGN. The existing three-tier cascade in `server-rates.ts` needs a fourth Tier-3b slot for SEP-6.

**Problem**
SEP-6-only anchors are silently dropped from `errors[]` because no tier succeeds.

**What needs to be done**

1. After Tier-2 fails, attempt `sep6IndicativeRate` if `hasSep6(toml)`.
2. Only push to `errors[]` when all tiers fail; preserve per-tier failure reasons.
3. Keep `Promise.all` per-anchor isolation intact.

**Key files**

- `lib/stellar/server-rates.ts`
- `tests/server-rates.spec.ts`

**Done when**

- Cowrie returns a rate on `usdc-ngn` instead of landing in `errors[]`. All-fail path still reports joined reasons.

---

### W1.7 — SEP-6 programmatic withdraw: `initSep6Withdraw`

**Complexity:** High — 200 Points · `type:feature`

**Milestone:** v1.4 SEP-6

**Context**
SEP-6 withdrawal is programmatic (no popup); the anchor returns fields the user fills directly. Unlike SEP-24, there is no interactive URL.

**Problem**
`ExecuteDrawer` only supports the SEP-24 interactive path; SEP-6 anchors can't be executed.

**What needs to be done**

1. Implement `initSep6Withdraw(transferServer, jwt, params)` returning `{ how, id, extra_info }`.
2. Map `extra_info.message` to a UI instruction step in `ExecuteDrawer`.
3. Start the same SEP-24 status-poll loop using the returned `id`.

**Key files**

- New: `lib/stellar/sep6.ts` (extend with withdraw call)
- `components/offramp/ExecuteDrawer.tsx`
- `tests/sep6.spec.ts`

**Done when**

- Selecting a SEP-6 anchor and clicking Execute reaches a `pending_external` status without errors.

---

### W1.8 — SEP-6 required-fields form in `ExecuteDrawer`

**Complexity:** Medium — 150 Points · `type:feature`

**Milestone:** v1.4 SEP-6

**Context**
SEP-6 anchors can require custom fields (bank account, routing number, etc.) that vary per anchor. The drawer needs a dynamic form step.

**Problem**
No form step exists for SEP-6 required fields.

**What needs to be done**

1. Parse `fields` from `/info` response for the selected asset.
2. Render a step in `ExecuteDrawer` with a labelled input per required field.
3. Pass collected fields to `initSep6Withdraw`.

**Key files**

- `components/offramp/ExecuteDrawer.tsx`
- New: `components/offramp/Sep6FieldsForm.tsx`
- `tests/Sep6FieldsForm.spec.tsx`

**Done when**

- A SEP-6 anchor requiring `dest` (bank account) renders an input and includes it in the withdraw request.

---

### W1.9 — SEP-6 KYC redirect handling

**Complexity:** Medium — 150 Points · `type:feature`

**Milestone:** v1.4 SEP-6

**Context**
SEP-6 anchors may redirect users for KYC via `type: 'interactive_customer_info_needed'`. This is similar to SEP-24's KYC popup.

**Problem**
No handling for `customer_info_status` or `interactive_customer_info_needed` responses.

**What needs to be done**

1. Detect `type === 'interactive_customer_info_needed'` in `initSep6Withdraw` response.
2. Open the `more_info_url` in a popup (same pattern as SEP-24 KYC step).
3. Poll until KYC resolves; then re-issue the withdraw call.

**Key files**

- `lib/stellar/sep6.ts`
- `components/offramp/ExecuteDrawer.tsx`

**Done when**

- Cowrie KYC redirect opens, user completes, execution continues to `pending_external`.

---

### W1.10 — SEP-6 tier badge in `RateTable`

**Complexity:** Trivial — 100 Points · `type:feature`

**Milestone:** v1.4 SEP-6

**Context**
The rate table shows a tier badge (SEP-38 firm / SEP-24 est.) for each row. SEP-6 rows need a distinct badge.

**Problem**
No `sep6-info` badge rendered.

**What needs to be done**

1. Add `"SEP-6 est."` badge variant to `QuotePill` with appropriate colour.
2. Add a tooltip: "Indicative rate from SEP-6 fee schedule. Not a firm quote."

**Key files**

- `components/offramp/RateTable.tsx`
- `components/ui/QuotePill.tsx`

**Done when**

- SEP-6 rows display the badge. Hover shows the tooltip.

---

### W1.11 — Unit tests: SEP-6 rate cascade with Cowrie fixture

**Complexity:** Medium — 150 Points · `type:test`

**Milestone:** v1.4 SEP-6

**Context**
The `server-rates` tests cover the existing two-tier path. Three-tier + SEP-6 needs dedicated coverage.

**Problem**
No test for the full cascade when SEP-38 and SEP-24 both fail but SEP-6 succeeds.

**What needs to be done**

1. Add a Cowrie fixture (`tests/fixtures/cowrie-sep6-info.json`) with a real USDC→NGN `/info` response.
2. Test: SEP-38 fails → SEP-24 fails → SEP-6 returns rate.
3. Test: all three fail → `errors[]` contains all three reasons.

**Key files**

- New: `tests/fixtures/cowrie-sep6-info.json`
- `tests/server-rates.spec.ts`

**Done when**

- Both cascade paths have passing tests with the Cowrie fixture.

---

### W1.12 — `docs/SEP_COMPLIANCE.md`: add SEP-6 row

**Complexity:** Trivial — 100 Points · `type:docs`

**Milestone:** v1.4 SEP-6

**Context**
`docs/SEP_COMPLIANCE.md` has a matrix of SEP support. SEP-6 is not yet listed.

**Problem**
The compliance doc understates coverage after W1 lands.

**What needs to be done**

1. Add SEP-6 row: which endpoints implemented (`/info`, `/withdraw`), which optional features supported, which anchors tested against.

**Key files**

- `docs/SEP_COMPLIANCE.md`

**Done when**

- SEP-6 row is present with accurate support matrix.

---

### W1.13 — E2E test: SEP-6 off-ramp with Playwright

**Complexity:** High — 200 Points · `type:test`

**Milestone:** v1.4 SEP-6

**Context**
Phase 0 Playwright suite covers the SEP-24 happy path. SEP-6 execution needs its own E2E smoke test.

**Problem**
No Playwright test for SEP-6 anchor selection through to `pending_external`.

**What needs to be done**

1. Add `tests/e2e/sep6-offramp.spec.ts` using MSW to mock Cowrie SEP-6 endpoints.
2. Test: select corridor → Cowrie appears with SEP-6 badge → select → fill required fields → execute → reach `pending_external`.

**Key files**

- New: `tests/e2e/sep6-offramp.spec.ts`

**Done when**

- Playwright test passes in CI without a live Cowrie connection.

---

## Workstream 2 — Anchor Fleet & Reputation (W2.1 onwards)

Reputation oracle write path, anchor fleet enumeration, composite scoring
improvements, and leaderboard query performance.

---

### W2.1 — Anchor registry: add SEP-6 capability flag

**Complexity:** Trivial — 100 Points · `type:refactor`

**Milestone:** v1.5 Anchor Fleet

**Context**
`lib/stellar/anchors.ts` stores per-anchor capability flags. After W1, SEP-6 is a real capability that needs to be expressed per anchor.

**Problem**
No `supportsSep6` field in the anchor registry type.

**What needs to be done**

1. Add `supportsSep6: boolean` to `AnchorDefinition`.
2. Populate from the anchor survey (`scripts/anchor-survey.mjs` output).
3. Use as a pre-flight check before attempting the SEP-6 rate path.

**Key files**

- `lib/stellar/anchors.ts`
- `types/index.ts`

**Done when**

- Every anchor has a `supportsSep6` flag. SEP-6 path only attempted when true.

---

### W2.2 — Per-anchor circuit breaker (3-consecutive-failure open)

**Complexity:** High — 200 Points · `type:feature`

**Milestone:** v1.1 Hardening

**Context**
A flapping anchor (network timeout, domain expired) triggers repeated expensive fetches per request. No isolation mechanism exists.

**Problem**
A failed anchor degrades every rate-table render.

**What needs to be done**

1. Implement `CircuitBreaker` with states `closed`, `open`, `half-open`.
2. Open after 3 consecutive failures; attempt one probe after `resetAfterMs` (default 60 s).
3. Per-anchor instance scoped to the server process lifetime.
4. Expose `status` in `/api/metrics` response.

**Key files**

- New: `lib/stellar/circuit-breaker.ts`
- `lib/stellar/server-rates.ts`
- `app/api/metrics/route.ts`
- New: `tests/circuit-breaker.spec.ts`

**Done when**

- After 3 failures, the anchor is skipped for 60 s. Half-open probe succeeds → circuit closes. Metrics reflect per-anchor circuit state.

---

### W2.3 — Quote-freshness badges and stale-quote blocking

**Complexity:** Medium — 150 Points · `type:feature`

**Milestone:** v1.1 Hardening

**Context**
SEP-38 firm quotes carry expiry timestamps. The rate table shows quotes that may have expired between page load and user click.

**Problem**
User clicks Execute on a stale quote; the SEP-24 flow returns a fee-changed error with no recovery.

**What needs to be done**

1. Add `expiresAt: number | null` to `AnchorRate`.
2. Render a countdown badge when < 60 s remain.
3. Block Execute and prompt re-quote when the quote has expired.

**Key files**

- `types/index.ts`
- `components/offramp/RateTable.tsx`
- `components/offramp/ExecuteDrawer.tsx`
- New: `tests/quote-freshness.spec.tsx`

**Done when**

- Expired quote shows a re-quote prompt instead of advancing to Execute.

---

### W2.4 — Reputation write: feature-flag to on by default

**Complexity:** Medium — 150 Points · `type:feature`

**Milestone:** v1.2 Router + Seeds

**Context**
`lib/flags.ts` gates the reputation write path behind `ENABLE_REPUTATION_WRITE`. It should default to true after v1.2 ships.

**Problem**
Flag defaults to false; reputation data is not collected from production off-ramps.

**What needs to be done**

1. Change `ENABLE_REPUTATION_WRITE` default to `true` in `lib/flags.ts`.
2. Add a safety check: if write fails, log warn but never throw (delivery must not block).
3. Verify the write path is covered by `tests/reputation-store.spec.ts`.

**Key files**

- `lib/flags.ts`
- `lib/reputation/store.ts`
- `tests/reputation-store.spec.ts`

**Done when**

- Every successful off-ramp writes an outcome record. Write failure doesn't interrupt the off-ramp flow.

---

### W2.5 — Reputation composite score: dispute-ratio penalty

**Complexity:** Medium — 150 Points · `type:feature`

**Milestone:** v1.2 Router + Seeds

**Context**
`lib/reputation/composite.ts` computes scores from fill rate, settle time, slippage. Dispute ratio (disputes / total transactions) is defined in the formula but not yet implemented.

**Problem**
Anchors with high dispute rates score the same as clean anchors.

**What needs to be done**

1. Add `disputeRatio` field to the composite formula: `penalty = disputeRatio > 0.02 ? (disputeRatio - 0.02) * 5 : 0`.
2. Source from `lib/reputation/dispute.ts` query over the reputation store.
3. Cap penalty at 2.0 (a floor of 0 score).

**Key files**

- `lib/reputation/composite.ts`
- `lib/reputation/dispute.ts`
- `tests/reputation-composite.spec.ts`

**Done when**

- An anchor with dispute ratio 5% scores ≥ 0.15 points lower than one with 0%.

---

### W2.6 — Reputation store: add `corridor_id` index

**Complexity:** Trivial — 100 Points · `type:perf`

**Milestone:** v1.2 Router + Seeds

**Context**
`lib/reputation/migrations/` creates the outcomes table without a composite index on `(anchor_id, corridor_id, created_at)`. Leaderboard queries full-scan at volume.

**Problem**
Query time grows linearly with outcome count.

**What needs to be done**

1. Add migration `002_corridor_index.sql` creating `CREATE INDEX idx_anchor_corridor ON outcomes (anchor_id, corridor_id, created_at DESC)`.
2. Add equivalent for SQLite (same syntax).
3. Test that the leaderboard query plan uses the index.

**Key files**

- New: `lib/reputation/migrations/002_corridor_index.sql`
- `tests/reputation-store.spec.ts`

**Done when**

- `EXPLAIN QUERY PLAN` shows index usage on the leaderboard query.

---

### W2.7 — `GET /api/reputation/leaderboard` corridor filter

**Complexity:** Medium — 150 Points · `type:feature`

**Milestone:** v1.2 Router + Seeds

**Context**
`/api/reputation/leaderboard` returns all anchors globally. A corridor-specific view is needed for the anchor scorecard page.

**Problem**
No corridor filter on the leaderboard endpoint.

**What needs to be done**

1. Accept `?corridor=usdc-ngn` query param.
2. Filter outcomes to that corridor before computing composite scores.
3. Validate corridor against the known-corridors list; return 400 on unknown.

**Key files**

- `app/api/reputation/leaderboard/route.ts`
- `lib/reputation/composite.ts`
- `tests/reputation-leaderboard.spec.ts`

**Done when**

- `GET /api/reputation/leaderboard?corridor=usdc-ngn` returns only anchors with USDC→NGN outcomes, sorted by composite score.

---

### W2.8 — Anchor scorecard: historical timeline sparkline

**Complexity:** Medium — 150 Points · `type:feature`

**Milestone:** v2.0 Observable

**Context**
`/api/reputation/[anchor]/history` returns time-series data. The anchor scorecard page has no chart.

**Problem**
Reviewers see a flat number; no trend context.

**What needs to be done**

1. Fetch `history` endpoint from `components/anchors/AnchorCard.tsx`.
2. Render a 30-day settle-time sparkline using a lightweight SVG chart (no Chart.js — keep bundle size).
3. Show trend arrow (↑ improving, ↓ degrading) based on last-7 vs previous-7 days.

**Key files**

- `components/anchors/AnchorCard.tsx`
- New: `components/ui/Sparkline.tsx`
- `tests/Sparkline.spec.tsx`

**Done when**

- Anchor scorecard shows a 30-day sparkline and trend arrow.

---

### W2.9 — Anchor onboarding self-service form

**Complexity:** Medium — 150 Points · `type:feature`

**Milestone:** v2.0 Observable

**Context**
`docs/ANCHOR_ONBOARDING.md` describes the onboarding process. There is no self-service form; anchors must email.

**Problem**
Friction slows anchor adoption.

**What needs to be done**

1. Add `app/anchor-onboarding/page.tsx` with a form: anchor name, home domain, corridors supported, contact email.
2. Form POSTs to `app/api/admin/anchor-requests/route.ts` (returns 202, emails maintainer).
3. Validate home domain resolves a valid TOML with `TRANSFER_SERVER` or `ANCHOR_TOML_URL`.

**Key files**

- New: `app/anchor-onboarding/page.tsx`
- New: `app/api/admin/anchor-requests/route.ts`
- `tests/anchor-onboarding.spec.tsx`

**Done when**

- Form validates home domain and sends a 202. Maintainer receives an email with the submission.

---

### W2.10 — Reputation store: pagination on `/history`

**Complexity:** Medium — 150 Points · `type:feature`

**Milestone:** v2.0 Observable

**Context**
`/api/reputation/[anchor]/history` returns all records. At volume this becomes a large payload.

**Problem**
No pagination; large anchors return unbounded JSON.

**What needs to be done**

1. Accept `?cursor=<created_at>&limit=<n>` (default limit 100, max 1000).
2. Return `{ data, nextCursor }` shape.

**Key files**

- `app/api/reputation/[anchor]/history/route.ts`
- `lib/reputation/store.ts`

**Done when**

- Response includes `nextCursor`. Requests with `cursor` return the next page. Limit enforced at 1000.

---

### W2.11 — Reputation outcome: write `slippageBps` field

**Complexity:** Trivial — 100 Points · `type:feature`

**Milestone:** v1.2 Router + Seeds

**Context**
The composite formula uses slippage as an input but the write path currently stores only settle time and success/failure.

**Problem**
`slippageBps` is always zero in the composite score.

**What needs to be done**

1. Compute `slippageBps = Math.round(((intendedRate - actualRate) / intendedRate) * 10000)` in the outcome writer.
2. Store alongside `settlementMs` and `success`.
3. Wire into `composite.ts` formula.

**Key files**

- `lib/reputation/store.ts`
- `lib/reputation/composite.ts`
- `tests/reputation-composite.spec.ts`

**Done when**

- Anchors with positive slippage score lower. Unit test demonstrates the delta.

---

## Workstream 3 — Split Routing & Intent (W3.1 onwards)

Multi-anchor execution, LP solver, and intent signing hardening.

---

### W3.1 — Multi-anchor parallel RFQ in `plan.ts`

**Complexity:** High — 200 Points · `type:feature`

**Milestone:** v2.2 Split Routing

**Context**
`lib/router/plan.ts` generates a single-anchor plan. Split routing sends part of the amount to multiple anchors to maximise landed value.

**Problem**
No multi-anchor plan generator.

**What needs to be done**

1. Add `generateSplitPlan(intent, rates)` returning `{ legs: [{ anchor, amount }], totalLanded }`.
2. Greedy algorithm: sort anchors by landed value per unit; allocate greedily respecting per-anchor `min`/`max`.
3. Fall back to single-anchor plan when no valid split improves outcome.

**Key files**

- `lib/router/plan.ts`
- New: `lib/router/split.ts`
- `tests/router-split.spec.ts`

**Done when**

- A split plan across two anchors with different fee structures produces higher `totalLanded` than single-anchor. Tests cover min/max clamps.

---

### W3.2 — LP (linear programming) solver for optimal split

**Complexity:** High — 200 Points · `type:feature`

**Milestone:** v2.2 Split Routing

**Context**
Greedy allocation (W3.1) is locally optimal but not globally optimal when min/max constraints interact.

**Problem**
Greedy can miss a higher-landed-value split that requires reallocating from the first-pick anchor.

**What needs to be done**

1. Implement a tiny LP solver (simplex or revised simplex) operating on up to 10 anchors.
2. Objective: maximise `sum(leg_i.landed)` subject to `sum(leg_i.amount) = totalAmount` and `min_i ≤ leg_i.amount ≤ max_i`.
3. Use solver only when greedy and LP disagree by > 0.1% landed value (LP is more expensive).
4. No external dep — self-contained in `lib/router/lp.ts`.

**Key files**

- New: `lib/router/lp.ts`
- `lib/router/split.ts`
- `tests/router-lp.spec.ts`

**Done when**

- LP produces ≥ greedy landed value on all test fixtures. Solver computes in < 5 ms for 10 anchors.

---

### W3.3 — Intent canonical JSON: property-based tests

**Complexity:** Medium — 150 Points · `type:test`

**Milestone:** v1.2 Router + Seeds

**Context**
`lib/intent/canonical.ts` must produce identical output for semantically equal objects regardless of key order.

**Problem**
No property-based tests; ordering edge cases are only covered by fixture examples.

**What needs to be done**

1. Use `fast-check` to generate random intent objects with shuffled keys.
2. Assert: for any two orderings of the same intent, `canonical(a) === canonical(b)`.
3. Assert: `canonical(canonical(x)) === canonical(x)` (idempotent).

**Key files**

- `tests/intent-canonical.spec.ts`

**Done when**

- Property tests run 1000 iterations in CI with no failures.

---

### W3.4 — Intent replay-protection: nonce store with TTL

**Complexity:** High — 200 Points · `type:feature`

**Milestone:** v1.2 Router + Seeds

**Context**
Signed intents include a `nonce` for replay protection. The server must reject a nonce seen before within the `expiresAt` window.

**Problem**
No server-side nonce store; replay attacks succeed.

**What needs to be done**

1. Add `NonceStore` interface: `claim(nonce, expiresAt): Promise<boolean>` (true = first use; false = replay).
2. Implement `MemoryNonceStore` with TTL-based eviction.
3. Call from `app/api/intent/offramp/route.ts`; return 409 on replay.
4. Document the interface so operators can plug in Redis for multi-instance deployments.

**Key files**

- New: `lib/intent/nonce-store.ts`
- `app/api/intent/offramp/route.ts`
- `tests/intent-nonce.spec.ts`

**Done when**

- Submitting the same signed intent twice returns 409 on the second call. First call succeeds.

---

### W3.5 — Intent router: reputation-weighted anchor selection

**Complexity:** High — 200 Points · `type:feature`

**Milestone:** v2.2 Split Routing

**Context**
`lib/router/score.ts` computes `net-landed-value`. Reputation score is defined but not yet blended into the selection score.

**Problem**
A low-reputation anchor with a marginally better rate wins over a high-reputation anchor.

**What needs to be done**

1. Add `reputationWeight` config (default 0.1 = 10% of total score is reputation-based).
2. Fetch composite score from reputation store during `select.ts`.
3. Final score = `netLandedValue * (1 - reputationWeight) + normalised_reputation * reputationWeight`.

**Key files**

- `lib/router/score.ts`
- `lib/router/select.ts`
- `tests/router-score.spec.ts`

**Done when**

- An anchor with composite score 8 beats one with composite 3 when net landed values are within 5% of each other.

---

### W3.6 — `POST /v1/public/intent` endpoint

**Complexity:** High — 200 Points · `type:feature`

**Milestone:** v2.3 Public API

**Context**
`app/api/intent/offramp/route.ts` accepts intents but is an internal route. A versioned public route with rate limiting enables third-party integrations.

**Problem**
No public API for intent submission.

**What needs to be done**

1. Add `app/api/v1/public/intent/route.ts` with API-key auth (header `x-api-key`).
2. Rate-limit: 60 req/min per key.
3. Return a `planId` and the selected anchor's `executeUrl` for the client to proceed.
4. Document in `lib/api/openapi.ts`.

**Key files**

- New: `app/api/v1/public/intent/route.ts`
- `lib/api/openapi.ts`
- `tests/public-intent.spec.ts`

**Done when**

- A third-party client can POST a signed intent and receive a `planId` + `executeUrl`. Rate limit enforced.

---

### W3.7 — Intent status tracking endpoint

**Complexity:** Medium — 150 Points · `type:feature`

**Milestone:** v2.3 Public API

**Context**
After W3.6, a third-party submitter can't track the intent's progress without polling the anchor directly.

**Problem**
No intent-status endpoint.

**What needs to be done**

1. Add `GET /v1/public/intent/[planId]` returning `{ status, txHash?, error?, updatedAt }`.
2. Persist intent state in the reputation store alongside outcomes.

**Key files**

- New: `app/api/v1/public/intent/[planId]/route.ts`
- `lib/reputation/store.ts`

**Done when**

- After submitting an intent, polling the status endpoint reflects the current SEP-24 transaction state.

---

## Workstream 4 — Soroban Oracle Depth (W4.1 onwards)

Deeper Soroban contract work targeting D3 score improvement. Focuses on
publisher reliability, on-chain leaderboard reads, and consumer SDK.

---

### W4.1 — Contract: `get_anchor_score` read function

**Complexity:** Medium — 150 Points · `type:feature`

**Milestone:** v2.1 Soroban Oracle Live

**Context**
`contracts/reputation/src/lib.rs` has `submit_outcome` but no public read function for composite score. Third-party contracts must call off-chain to get scores.

**Problem**
The on-chain data is write-only from a consumer perspective.

**What needs to be done**

1. Add `get_anchor_score(anchor_id: Symbol) -> i64` to the Soroban contract.
2. Compute composite score on-chain from stored outcomes (fill rate, settle p50, dispute ratio).
3. Return a fixed-point integer (score × 1000, so 8.5 = 8500).

**Key files**

- `contracts/reputation/src/lib.rs`
- `contracts/reputation/src/history.rs`
- `contracts/reputation/tests/`

**Done when**

- `stellar contract invoke -- get_anchor_score --anchor_id MONEYGRAM` returns a non-zero score after outcomes are submitted.

---

### W4.2 — Contract: time-windowed outcome aggregation

**Complexity:** High — 200 Points · `type:feature`

**Milestone:** v2.1 Soroban Oracle Live

**Context**
The contract stores outcomes in `history.rs` but the aggregation window is unbounded. A 30-day rolling window reduces staleness.

**Problem**
Old outcomes (90+ days) drag down scores for anchors that have recently improved.

**What needs to be done**

1. Add `window_days: u32` parameter to `get_anchor_score`.
2. Filter `history` entries to `ledger_close_time >= now - (window_days * 86400)`.
3. Default `window_days = 30`; max 90.

**Key files**

- `contracts/reputation/src/history.rs`
- `contracts/reputation/src/lib.rs`

**Done when**

- Score computed over 30-day window differs from all-time score when old bad outcomes exist.

---

### W4.3 — Contract: multi-publisher submit with signature verification

**Complexity:** High — 200 Points · `type:feature`

**Milestone:** v2.1 Soroban Oracle Live

**Context**
Currently a single publisher key can write outcomes. Multi-sig requires all publishers to sign via a whitelist.

**Problem**
Single-publisher oracle is centralised; grant committee scores this lower on D3.

**What needs to be done**

1. Add `publisher_whitelist: Vec<Address>` to contract storage.
2. `submit_outcome` verifies `env.invoker()` is in the whitelist before writing.
3. Admin function `add_publisher` / `remove_publisher` gated by multi-sig (2-of-3).

**Key files**

- `contracts/reputation/src/admin.rs`
- `contracts/reputation/src/lib.rs`
- `contracts/reputation/tests/`

**Done when**

- `submit_outcome` from a non-whitelisted key returns a contract error. Admin can add/remove publishers.

---

### W4.4 — Contract: on-chain leaderboard (top-N anchors)

**Complexity:** High — 200 Points · `type:feature`

**Milestone:** v2.1 Soroban Oracle Live

**Context**
Off-chain leaderboard is computed in `lib/reputation/composite.ts`. Having it verifiable on-chain is a D3 differentiator.

**Problem**
Third-party contracts can query individual anchor scores but not a ranked list.

**What needs to be done**

1. Add `get_leaderboard(corridor_id: Symbol, limit: u32) -> Vec<(Symbol, i64)>` to the contract.
2. Sort anchors by composite score within the requested corridor.
3. Cache result in contract persistent storage; invalidate on new `submit_outcome` call.

**Key files**

- `contracts/reputation/src/lib.rs`
- `contracts/reputation/src/anchors.rs`

**Done when**

- `get_leaderboard --corridor_id USDC-NGN --limit 3` returns the top 3 anchors sorted by score.

---

### W4.5 — TypeScript oracle consumer: `readAnchorScore`

**Complexity:** Medium — 150 Points · `type:feature`

**Milestone:** v2.1 Soroban Oracle Live

**Context**
Third-party developers need a typed helper to read the Soroban oracle without writing raw RPC calls.

**Problem**
No TypeScript consumer helper shipped.

**What needs to be done**

1. Add `lib/oracle/read.ts` with `readAnchorScore(contractId, anchorId, rpcUrl)` calling `invoke_host_function` (read-only).
2. Add `readLeaderboard(contractId, corridorId, limit, rpcUrl)`.
3. Export from `packages/sdk/src/index.ts`.

**Key files**

- New: `lib/oracle/read.ts`
- `packages/sdk/src/index.ts`
- `tests/oracle-read.spec.ts`

**Done when**

- Both helpers return correctly typed values against a mocked RPC. SDK exports them.

---

### W4.6 — Contract upgrade pattern: `upgrade` admin function

**Complexity:** High — 200 Points · `type:feature`

**Milestone:** v2.1 Soroban Oracle Live

**Context**
Soroban contracts support WASM hash upgrades without redeployment. Without an upgrade function, any bug fix requires a new contract address, breaking all consumers.

**Problem**
No upgrade path in the current contract.

**What needs to be done**

1. Add `upgrade(new_wasm_hash: BytesN<32>)` function gated by 2-of-3 admin multi-sig.
2. Calls `env.deployer().update_current_contract_wasm(new_wasm_hash)`.
3. Emit an `Upgraded` event with old and new hashes.
4. Document the upgrade governance process in `docs/ORACLE_SPEC.md`.

**Key files**

- `contracts/reputation/src/admin.rs`
- `contracts/reputation/src/lib.rs`
- `docs/ORACLE_SPEC.md`

**Done when**

- Upgrade function callable by admin multi-sig. Test verifies the contract WASM hash changes post-upgrade.

---

### W4.7 — Contract property tests: fuzz `submit_outcome`

**Complexity:** High — 200 Points · `type:test`

**Milestone:** v2.1 Soroban Oracle Live

**Context**
The contract tests in `contracts/reputation/tests/` cover the happy path. Fuzz testing catches arithmetic overflow and boundary errors.

**Problem**
No fuzz / property tests.

**What needs to be done**

1. Add a proptest-based fuzzer for `submit_outcome` varying `settlement_ms`, `slippage_bps`, `success`, and `anchor_id`.
2. Assert: no integer overflow, score always in [0, 10000], no panic.
3. Run in CI under `cargo test --features proptest`.

**Key files**

- `contracts/reputation/tests/fuzz.rs`
- `contracts/reputation/Cargo.toml`

**Done when**

- Fuzzer runs 10,000 iterations in CI with no panics.

---

### W4.8 — Oracle TypeScript integration test against testnet

**Complexity:** High — 200 Points · `type:test`

**Milestone:** v2.1 Soroban Oracle Live

**Context**
Unit tests mock the RPC. An integration test verifies the full write→read cycle against the deployed testnet contract.

**Problem**
No integration test for the oracle.

**What needs to be done**

1. Add `tests/integration/oracle.spec.ts` gated behind `INTEGRATION_TESTS=true`.
2. Submit a fixture outcome via `lib/publisher/queue.ts`.
3. Read back via `readAnchorScore` (W4.5).
4. Assert score changed in the expected direction.

**Key files**

- New: `tests/integration/oracle.spec.ts`

**Done when**

- Test passes against testnet under `INTEGRATION_TESTS=true`.

---

## Workstream 5 — SDK, Public API & MCP (W5.1 onwards)

`@stellarintel/sdk` completion, public rate and reputation endpoints, and MCP tool expansion.

---

### W5.1 — `@stellarintel/sdk`: package scaffold

**Complexity:** High — 200 Points · `type:feature`

**Milestone:** v4.0 Universal

**Context**
`packages/sdk/` exists as a placeholder. `docs/SDK.md` describes the planned API. Nothing is exported yet.

**Problem**
`pnpm add @stellarintel/sdk` installs an empty package.

**What needs to be done**

1. Wire `packages/sdk/src/index.ts` exporting: `StellarIntelClient`, `getCorridor`, `getAnchorRates`, `getAnchorScore`, `readLeaderboard`.
2. Add changesets release config.
3. Build to `packages/sdk/dist/` with ESM + CJS dual output.

**Key files**

- `packages/sdk/src/index.ts`
- `packages/sdk/package.json`
- `packages/sdk/tsconfig.json`

**Done when**

- `import { StellarIntelClient } from '@stellarintel/sdk'` resolves and typechecks in a fresh project.

---

### W5.2 — `StellarIntelClient`: `getCorridor` and `getAnchorRates`

**Complexity:** Medium — 150 Points · `type:feature`

**Milestone:** v4.0 Universal

**Context**
The SDK client wraps the public API. `getCorridor` and `getAnchorRates` are the two most commonly used methods.

**Problem**
No methods implemented.

**What needs to be done**

1. `getCorridor(corridorId)` calls `GET /v1/public/corridors/[id]`.
2. `getAnchorRates(corridorId, amount)` calls `GET /api/rates/[corridor]?amount=N`.
3. Both return typed responses; network errors throw `StellarIntelError`.

**Key files**

- `packages/sdk/src/client.ts`
- `tests/sdk-client.spec.ts`

**Done when**

- Both methods return typed results against a mock server. Error path throws `StellarIntelError`.

---

### W5.3 — `GET /v1/public/corridors` — corridor listing endpoint

**Complexity:** Trivial — 100 Points · `type:feature`

**Milestone:** v2.3 Public API

**Context**
No public endpoint lists the supported corridors. Third-party developers hardcode corridor IDs.

**Problem**
Discovery requires reading the source code.

**What needs to be done**

1. Add `app/api/v1/public/corridors/route.ts` returning the list from `lib/stellar/anchors.ts`.
2. Each corridor: `id`, `send_asset`, `receive_fiat`, `country`, `anchor_count`.
3. No auth required.

**Key files**

- New: `app/api/v1/public/corridors/route.ts`
- `lib/api/openapi.ts`

**Done when**

- `GET /v1/public/corridors` returns a JSON array of 7 corridor objects. Schema in OpenAPI spec.

---

### W5.4 — `GET /v1/public/scores` — public reputation endpoint

**Complexity:** Medium — 150 Points · `type:feature`

**Milestone:** v2.3 Public API

**Context**
`/api/reputation/leaderboard` is the internal route. A public versioned endpoint with rate limiting enables third-party dashboards.

**Problem**
No rate-limited public reputation API.

**What needs to be done**

1. Add `app/api/v1/public/scores/route.ts` returning anchor scores (same as leaderboard but with API-key gate).
2. Accept optional `?corridor=` filter.
3. Rate-limit: 100 req/min per key.

**Key files**

- New: `app/api/v1/public/scores/route.ts`
- `lib/api/openapi.ts`

**Done when**

- Authenticated request returns anchor scores. 429 on limit breach.

---

### W5.5 — MCP tool: `execute_offramp` (planned v4 GA)

**Complexity:** High — 200 Points · `type:feature`

**Milestone:** v4.0 Universal

**Context**
`packages/mcp/` has `list_corridors`, `list_anchors_for_corridor`, `quote_corridor`. `execute_offramp` is the most valuable tool for AI agents.

**Problem**
Agent can discover and quote but can't execute without `execute_offramp`.

**What needs to be done**

1. Add `execute_offramp` MCP tool: accepts `corridorId`, `amount`, `anchorId`, `userPublicKey`; returns an `executeUrl` for the user to open and sign.
2. Tool does NOT sign; it generates a SEP-24 interactive URL. User signs via Freighter.
3. Add agent-safety note in tool description: "User must sign; tool never holds keys."

**Key files**

- `packages/mcp/src/tools/execute-offramp.ts`
- `packages/mcp/src/index.ts`
- `docs/MCP.md`

**Done when**

- Claude calling `execute_offramp` returns a `stellar-intel.vercel.app/offramp?anchor=...&amount=...` URL the user can open.

---

### W5.6 — MCP tool: `get_anchor_reputation`

**Complexity:** Medium — 150 Points · `type:feature`

**Milestone:** v4.0 Universal

**Context**
An agent answering "which anchor should I use?" needs reputation data alongside rates.

**Problem**
No MCP tool surfaces reputation scores.

**What needs to be done**

1. Add `get_anchor_reputation(anchorId, corridorId?)` tool calling `/api/reputation/[anchor]`.
2. Return `{ score, fillRate, settleTimeP50Ms, slippageBps, disputeRatio, lastUpdated }`.

**Key files**

- `packages/mcp/src/tools/get-anchor-reputation.ts`
- `packages/mcp/src/index.ts`

**Done when**

- Tool returns typed reputation object. MCP README updated with example prompt.

---

### W5.7 — MCP tool: `compare_corridors`

**Complexity:** Trivial — 100 Points · `type:feature`

**Milestone:** v4.0 Universal

**Context**
Users want to compare multiple corridors side-by-side (e.g., USDC→NGN vs USDC→KES) to pick the fastest-settling option.

**Problem**
No multi-corridor comparison tool.

**What needs to be done**

1. Add `compare_corridors(corridorIds: string[])` fetching rates for each in parallel.
2. Return a ranked table of `{ corridorId, bestRate, anchor, settlementEstimateMs }`.

**Key files**

- `packages/mcp/src/tools/compare-corridors.ts`

**Done when**

- Tool returns a ranked list for two corridors. Claude can present it as a markdown table.

---

### W5.8 — SDK: React hooks `useStellarIntel` and `useAnchorRates`

**Complexity:** Medium — 150 Points · `type:feature`

**Milestone:** v4.0 Universal

**Context**
`hooks/useAnchorRates.ts` lives in the Stellar Intel app. Third-party React developers want to import the same hook from the SDK.

**Problem**
Hook is not exported from the SDK package.

**What needs to be done**

1. Move `useAnchorRates` to `packages/sdk/src/hooks/useAnchorRates.ts`.
2. Add `useStellarIntel({ baseUrl })` context provider.
3. Export from SDK barrel.
4. Document in `docs/SDK.md`.

**Key files**

- New: `packages/sdk/src/hooks/useAnchorRates.ts`
- New: `packages/sdk/src/hooks/useStellarIntel.tsx`
- `docs/SDK.md`

**Done when**

- `import { useAnchorRates } from '@stellarintel/sdk/react'` resolves in a Next.js project.

---

### W5.9 — OpenAPI spec: auto-emit on build

**Complexity:** Trivial — 100 Points · `type:ci`

**Milestone:** v1.3 Polish

**Context**
`scripts/emit-openapi.mts` generates `public/openapi.json`. It is currently not wired into the build.

**Problem**
The published spec can drift from the actual API routes.

**What needs to be done**

1. Add `pnpm run emit-openapi` to the CI build step before `next build`.
2. Assert `public/openapi.json` has no uncommitted diff in CI (`git diff --exit-code public/openapi.json`).

**Key files**

- `.github/workflows/ci.yml`
- `package.json`

**Done when**

- CI fails when `openapi.json` is stale relative to route changes.

---

## Workstream 6 — UI: Landing Page & Anchor Scorecard (W6.1 onwards)

`app/page.tsx` is a bare placeholder. The anchor leaderboard page is incomplete.

---

### W6.1 — Homepage hero: one-line pitch + CTA

**Complexity:** Medium — 150 Points · `type:feature`

**Milestone:** v1.6 Landing Polish

**Context**
`app/page.tsx` renders nothing useful. First impression for grant reviewers and new users.

**Problem**
Bare placeholder.

**What needs to be done**

1. Render: headline ("Execution layer for stablecoin value on Stellar"), sub-headline, two CTAs ("Compare rates →" and "Read the docs →").
2. Add a rate-freshness badge showing current USDC→NGN best rate (SSR-fetched, revalidate 60 s).
3. Add partner anchor logos strip.

**Key files**

- `app/page.tsx`
- New: `components/landing/Hero.tsx`
- New: `components/landing/AnchorLogos.tsx`

**Done when**

- Homepage renders a pitch, live rate badge, and anchor logos. Core Web Vitals LCP < 2.5 s.

---

### W6.2 — Homepage: "How it works" three-step explainer

**Complexity:** Trivial — 100 Points · `type:feature`

**Milestone:** v1.6 Landing Polish

**Context**
The off-ramp flow (compare → execute → settle) is not explained on the landing page.

**Problem**
New visitors don't understand the product without navigating to the off-ramp page.

**What needs to be done**

1. Add a three-step section: "1. Compare rates across anchors", "2. Sign once with your wallet", "3. Watch it settle in real time".
2. Use Lucide icons; no custom SVGs.

**Key files**

- `app/page.tsx`
- New: `components/landing/HowItWorks.tsx`

**Done when**

- Three-step section renders below the hero on the homepage.

---

### W6.3 — Homepage: live corridor stats ticker

**Complexity:** Medium — 150 Points · `type:feature`

**Milestone:** v1.6 Landing Polish

**Context**
A live stats strip (number of corridors, anchors, outcomes published, total volume processed) demonstrates real traction.

**Problem**
No stats surface on the landing page.

**What needs to be done**

1. Add `GET /api/stats` returning `{ corridors, anchors, outcomesPublished, volumeUsdc }`.
2. Render as an animated count-up strip on the homepage.

**Key files**

- New: `app/api/stats/route.ts`
- New: `components/landing/StatsTicker.tsx`
- `app/page.tsx`

**Done when**

- Stats strip renders with real values from the reputation store. Counts animate on page load.

---

### W6.4 — Anchor leaderboard page: full implementation

**Complexity:** High — 200 Points · `type:feature`

**Milestone:** v2.0 Observable

**Context**
`app/anchors/page.tsx` is a placeholder per the Explore report. The anchor leaderboard is a flagship feature for grant reviewers.

**Problem**
No leaderboard UI.

**What needs to be done**

1. Fetch `/api/reputation/leaderboard?corridor=...` client-side with SWR.
2. Render a sortable table: anchor name, composite score, fill rate, settle time P50, slippage bps, dispute ratio, 30-day sparkline.
3. Add corridor selector (all / usdc-ngn / usdc-kes / …).
4. Add "Verify on-chain" link to Stellar Expert for each anchor's oracle entry.

**Key files**

- `app/anchors/page.tsx`
- New: `components/anchors/Leaderboard.tsx`
- `components/anchors/AnchorCard.tsx`

**Done when**

- Leaderboard renders all anchors with real reputation data. Sorting and corridor filter work.

---

### W6.5 — Anchor detail page

**Complexity:** Medium — 150 Points · `type:feature`

**Milestone:** v2.0 Observable

**Context**
The leaderboard links to `/anchors/[id]` but no detail page exists.

**Problem**
Clicking an anchor goes to 404.

**What needs to be done**

1. Render: anchor name, logo, home domain, supported corridors, composite score, history sparkline, last 10 outcomes table, dispute log.
2. Add "Submit dispute" button linking to the dispute API.

**Key files**

- New: `app/anchors/[id]/page.tsx`
- New: `components/anchors/AnchorDetail.tsx`

**Done when**

- Every anchor in the leaderboard has a functioning detail page with live data.

---

### W6.6 — Rate table: "best rate" badge + sort by landed value

**Complexity:** Medium — 150 Points · `type:feature`

**Milestone:** v1.1 Hardening

**Context**
`components/offramp/RateTable.tsx` shows rates but doesn't highlight the best option.

**Problem**
Users manually compare rows; cognitive load is high.

**What needs to be done**

1. Add `"Best rate"` badge on the row with the highest `totalReceived`.
2. Default sort order: `totalReceived DESC`.
3. Add column sort toggle (click header to sort by rate, fee, settle time).

**Key files**

- `components/offramp/RateTable.tsx`

**Done when**

- Best rate is badged. Table sorts on column header click. Default is by totalReceived.

---

### W6.7 — Mobile-responsive off-ramp drawer

**Complexity:** Medium — 150 Points · `type:feature`

**Milestone:** v1.1 Hardening

**Context**
`ExecuteDrawer` is a side-panel. On mobile (<640 px) it covers the full viewport but has layout issues.

**Problem**
Off-ramp is unusable on mobile.

**What needs to be done**

1. Convert to a bottom sheet on mobile (Tailwind `sm:` breakpoint).
2. Fix step content overflow on 375 px viewport.
3. Ensure Freighter popup triggers correctly on mobile Safari.

**Key files**

- `components/offramp/ExecuteDrawer.tsx`

**Done when**

- Playwright mobile viewport test (375 px) passes the happy-path flow.

---

## Workstream 7 — Community Health & Docs (W7.1 onwards)

Contributor funnel, GitHub automation, and missing documentation.

---

### W7.1 — `all-contributors` bot setup

**Complexity:** Trivial — 100 Points · `type:community`

**Milestone:** v1.3 Polish

**Context**
`maintainer.md` calls for all-contributors. The config and bot workflow need to be committed.

**Problem**
Contributor attribution is manual; contributors are invisible.

**What needs to be done**

1. Add `.all-contributorsrc` at repo root with initial config.
2. Add `.github/workflows/all-contributors.yml` (bot workflow).
3. Add `<!-- ALL-CONTRIBUTORS-LIST:START -->` placeholder to `README.md`.

**Key files**

- New: `.all-contributorsrc`
- New: `.github/workflows/all-contributors.yml`
- `README.md`

**Done when**

- Bot responds to `@all-contributors please add @user for code` and updates `README.md`.

---

### W7.2 — `CODEOWNERS`

**Complexity:** Trivial — 100 Points · `type:community`

**Milestone:** v1.3 Polish

**Context**
PRs touching the Soroban contract or SEP clients have no required reviewer routing.

**Problem**
Security-sensitive changes can merge without expert review.

**What needs to be done**

1. Add `.github/CODEOWNERS` assigning the maintainer to `contracts/`, `lib/stellar/`, `lib/intent/`, `docs/SECURITY.md`, `docs/THREAT_MODEL.md`.
2. Assign `*` to maintainer as catch-all.

**Key files**

- New: `.github/CODEOWNERS`

**Done when**

- PRs touching contract code require maintainer approval.

---

### W7.3 — `SUPPORT.md` and GitHub Discussions templates

**Complexity:** Trivial — 100 Points · `type:community`

**Milestone:** v1.3 Polish

**Context**
`CODE_OF_CONDUCT.md` exists but `SUPPORT.md` does not. Discussions has no category templates.

**Problem**
New community members don't know where to ask for help.

**What needs to be done**

1. Add `SUPPORT.md` pointing to GitHub Discussions and the FAQ.
2. Add `.github/DISCUSSION_TEMPLATE/` with templates for "Question", "Anchor onboarding", "Agent integration".

**Key files**

- New: `SUPPORT.md`
- New: `.github/DISCUSSION_TEMPLATE/question.yml`
- New: `.github/DISCUSSION_TEMPLATE/anchor-onboarding.yml`

**Done when**

- `SUPPORT.md` is present. Discussion templates appear when creating a new discussion.

---

### W7.4 — Welcome bot: first-time contributor comment

**Complexity:** Trivial — 100 Points · `type:community`

**Milestone:** v1.3 Polish

**Context**
First-time contributors get no onboarding message.

**Problem**
Drop-off rate is high when contributors don't know where to start.

**What needs to be done**

1. Add `.github/workflows/welcome.yml` using `actions/first-interaction`.
2. Comment: "Welcome! Read `CONTRIBUTING.md` → `docs/ARCHITECTURE.md` → pick a `good-first-issue`."

**Key files**

- New: `.github/workflows/welcome.yml`

**Done when**

- First-time contributor on a PR receives a welcome comment with the onboarding checklist.

---

### W7.5 — Stale bot: 90-day issue close

**Complexity:** Trivial — 100 Points · `type:community`

**Milestone:** v1.3 Polish

**Context**
100+ planned issues will accumulate stale backlog without automated triage.

**Problem**
Issue board becomes unmanageable.

**What needs to be done**

1. Add `.github/workflows/stale.yml` (`actions/stale`).
2. Mark stale after 90 days; close after 14 more.
3. Exempt labels: `help-wanted`, `good-first-issue`, `epic/*`.

**Key files**

- New: `.github/workflows/stale.yml`

**Done when**

- Stale issues marked and closed automatically. Exempted labels bypass the bot.

---

### W7.6 — `FUNDING.yml`

**Complexity:** Trivial — 100 Points · `type:community`

**Milestone:** v1.3 Polish

**Context**
GitHub shows a "Sponsor" button when `.github/FUNDING.yml` exists.

**Problem**
No sponsor button; community can't fund the project directly.

**What needs to be done**

1. Add `.github/FUNDING.yml` with `github: [determined-001]` (or the maintainer's GitHub handle) and Open Collective if applicable.

**Key files**

- New: `.github/FUNDING.yml`

**Done when**

- "Sponsor" button visible on the repo.

---

### W7.7 — Changesets + release automation

**Complexity:** High — 200 Points · `type:ci`

**Milestone:** v1.3 Polish

**Context**
`packages/mcp` and `packages/sdk` need automated versioning. `release.yml` exists but uses a manual tag trigger without changesets.

**Problem**
SDK versions are bumped manually; contributors can't trigger releases.

**What needs to be done**

1. Add `@changesets/cli` to the workspace.
2. Add `.changeset/config.json` with linked packages.
3. Update `release.yml` to run `pnpm changeset publish` on changesets PR merge.
4. Add PR check requiring a changeset file for package source changes.

**Key files**

- New: `.changeset/config.json`
- `.github/workflows/release.yml`
- New: `.github/workflows/require-changeset.yml`

**Done when**

- Merging a changesets PR publishes updated packages to npm automatically.

---

### W7.8 — `docs/CONTRIBUTING.md`: expanded contributor guide

**Complexity:** Medium — 150 Points · `type:docs`

**Milestone:** v1.3 Polish

**Context**
`CONTRIBUTING.md` exists but is thin. Phase 1 adds changesets, Wave rewards, and the `contracts/` Rust codebase.

**Problem**
New contributors can't set up the Rust/Soroban toolchain or understand Wave rewards from the current guide.

**What needs to be done**

1. Add "Setting up Rust + Soroban CLI" section.
2. Add "Changesets" section (when/how to add).
3. Add "Wave Program rewards" section (Drips, complexity tiers, claim process).
4. Add "Contract tests" section (`cargo test` in `contracts/reputation/`).

**Key files**

- `CONTRIBUTING.md`

**Done when**

- A first-time contributor can follow the guide end-to-end including Rust setup and a changeset.

---

### W7.9 — `docs/ARCHITECTURE_DECISIONS/` — ADR-0001 and ADR-0002

**Complexity:** Medium — 150 Points · `type:docs`

**Milestone:** v1.3 Polish

**Context**
No ADR folder exists. Engineering decisions are undocumented.

**Problem**
Grant reviewers and new contributors can't understand why key choices were made.

**What needs to be done**

1. Create `docs/ARCHITECTURE_DECISIONS/` folder.
2. Write `ADR-0001-intent-based-execution.md` — why intent-based routing over pure rate aggregation.
3. Write `ADR-0002-sqlite-dev-postgres-prod.md` — why SQLite for dev, Postgres for prod reputation store.
4. Add a table of contents to `docs/ARCHITECTURE.md`.

**Key files**

- New: `docs/ARCHITECTURE_DECISIONS/ADR-0001-intent-based-execution.md`
- New: `docs/ARCHITECTURE_DECISIONS/ADR-0002-sqlite-dev-postgres-prod.md`
- `docs/ARCHITECTURE.md`

**Done when**

- Both ADRs are present and cross-linked from `ARCHITECTURE.md`.

---

### W7.10 — `docs/CASE_STUDIES.md` placeholder (open-source section)

**Complexity:** Medium — 150 Points · `type:docs`

**Milestone:** v1.3 Polish

**Context**
The full case study (actual $500 transaction with TX links) is a maintainer task. But the community can write the scaffolding — structure, methodology, corridor context.

**Problem**
No case study doc.

**What needs to be done**

1. Write `docs/CASE_STUDIES.md` with sections: "Methodology", "USDC → NGN ($500, MoneyGram)", "USDC → KES ($200, Cowrie)".
2. For each: estimated landed value, benchmark against manual wire transfer, FX source, timeline.
3. Leave TX link and actual screenshot slots as `[MAINTAINER: add after live run]` placeholders.

**Key files**

- New: `docs/CASE_STUDIES.md`

**Done when**

- Doc is present with full structure and all data fields populated (placeholders where TX links needed).

---

### W7.11 — Auto-label GitHub Action

**Complexity:** Trivial — 100 Points · `type:ci`

**Milestone:** v1.3 Polish

**Context**
`maintainer.md` lists auto-labeling by branch prefix / path. No workflow exists yet.

**Problem**
Labels must be applied manually; inconsistent.

**What needs to be done**

1. Add `.github/workflows/auto-label.yml` using `actions/labeler`.
2. Map paths: `contracts/**` → `module/oracle`, `lib/stellar/**` → `module/sep`, `packages/mcp/**` → `module/mcp`, `packages/sdk/**` → `module/sdk`.

**Key files**

- New: `.github/workflows/auto-label.yml`
- New: `.github/labeler.yml`

**Done when**

- A PR touching `contracts/` gets labeled `module/oracle` automatically.

---

### W7.12 — `docs/AGENT_GUIDE.md` — community draft

**Complexity:** Medium — 150 Points · `type:docs`

**Milestone:** v4.0 Universal

**Context**
The MCP server is live. An agent guide showing Claude completing an off-ramp in five tool calls is the D2 "agent-native" framing unlock.

**Problem**
No agent guide.

**What needs to be done**

1. Write `docs/AGENT_GUIDE.md` showing:
   - Install: `claude mcp add @stellarintel/mcp`
   - Five-tool-call off-ramp session transcript (list_corridors → quote → compare → execute → status)
   - OpenAI function-calling equivalent
   - Agent-safety section (non-custodial guarantee, what the agent never touches)
2. Cross-link from `docs/MCP.md` and README.

**Key files**

- New: `docs/AGENT_GUIDE.md`
- `docs/MCP.md`
- `README.md`

**Done when**

- Guide is present with complete session transcript. Safety section clearly states the agent never holds keys or funds.
