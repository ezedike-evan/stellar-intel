# Stellar Intel — UI Issues Batch C (35 of 100 remaining)

> **Scope**: Off-ramp rate table, ExecuteDrawer, off-ramp page shell, trust
> signals, wallet UX, StatusTracker, brand/global, accessibility, performance,
> analytics, and SEO. None of these are in `issue.md` (#001–#250) or
> `issues-batch-2.md` (#B001–#B100).
>
> **Status**: 65 of the original 100 issues are resolved and removed from this
> file — 50 implemented directly (see branch `worktree-issues-batch-c`,
> commits reference `#C0xx` in their messages), 13 verified already
> satisfied by existing code with no change needed (#C011, #C017, #C026,
> #C035, #C052, #C054, #C057, #C058, #C062, #C073, #C083, #C089, #C090),
> and 2 evaluated and declined outright: #C037 (not an actual gap in this
> codebase) and #C070 (would require fabricating anchor support emails
> that aren't known). The 35 remaining below are genuinely open: still
> blocked on unshipped infrastructure (OTel tracing, DB layer, reputation
> event log, brand assets, a Plausible account, Vercel KV), still need a
> real visual/audit pass rather than a blind edit (contrast, focus rings,
> tap targets), or are bigger features/animation work not yet started.
> Workstream I (StatusTracker) is now fully closed and its section removed.
>
> **Workstreams (remaining issues only):**
>
> - **D. Rate table UI** — `#C002, #C003, #C008, #C010, #C013`
> - **E. ExecuteDrawer UX** — `#C018, #C021, #C022, #C027, #C028`
> - **F. Off-ramp page shell** — `#C036`
> - **G. Trust & liveness signals** — `#C041, #C043, #C045, #C046, #C047, #C049, #C050`
> - **H. Wallet UX** — `#C053, #C060`
> - **J. Brand & global** — `#C071, #C072, #C075, #C077`
> - **K. Accessibility** — `#C081, #C082, #C085, #C086`
> - **L. Performance** — `#C091, #C094, #C095`
> - **M. Analytics & SEO** — `#C096, #C097, #C098, #C100`
>
> **Format**: matches `issues-batch-2.md` exactly so `scripts/create-issues.sh`
> can file them mechanically.

---

## WORKSTREAM D — RATE TABLE UI (`#C001–#C015`)

#C002 [FEAT] [UI] Number ticker animation on rate values when SWR revalidates
Description
When SWR fetches fresh rates, values update silently. A brief number-roll animation on changed cells makes the liveness of the data tangible.
Requirements

- On revalidation, any rate cell whose value changed animates via a brief count-up/roll (100–150ms).
- Cells that did not change do not animate — only changed values.
- Respect `prefers-reduced-motion` — skip animation, still update value.
  Acceptance Criteria
- Changed cells animate; unchanged cells are static; snapshot test verifies DOM update.
  Estimated File Changes: 3 (components/offramp/RateCell.tsx, hooks/usePrevious.ts, components/offramp/RateTable.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

#C003 [FEAT] [UI] Staggered row entry animation on first rate table load
Description
On first load, all rate rows appear simultaneously, which feels abrupt. Staggered entry (rows slide/fade in 50ms apart) makes the data feel like it arrived live, not dumped.
Requirements

- Rows animate in with `opacity: 0 → 1` + `translateY(8px → 0)` on mount, staggered 50ms per row.
- Applies to first load only, not SWR revalidations.
- Respect `prefers-reduced-motion` — rows appear instantly.
  Acceptance Criteria
- 5 rows stagger over ~250ms total; rows do not shift layout during animation (no CLS).
  Estimated File Changes: 2 (components/offramp/RateTable.tsx, components/offramp/RateRow.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

#C008 [FEAT] [UI] Rate row sparkline — 5-point in-memory SWR history mini-chart
Description
Every SWR revalidation produces a new rate value. Store the last 5 values in a ref and render as a 5-point mini-chart per row. Transforms "snapshot comparator" into "live market intelligence."
Requirements

- `useRateHistory(anchorId, corridorId)` hook accumulates last 5 rate values in a ref (no persistence, resets on page reload).
- Render as an SVG polyline (60×24px) in each rate row. Green if last point > first; red if lower; gray if flat.
- Accessibility: `aria-label="Rate trend: [up/down/flat] over last 5 checks"`.
- Does not require DB — in-memory SWR history only.
  Acceptance Criteria
- After 5 SWR refreshes (2.5 min), each row shows a 5-point sparkline. Trend color correct.
  Estimated File Changes: 4 (hooks/useRateHistory.ts, components/offramp/Sparkline.tsx, components/offramp/RateRow.tsx, tests/Sparkline.spec.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/hard
  Milestone: v1.3 Off-ramp Polish

---

#C010 [ENHANCEMENT] [UI] Rate table responsive pass — 5-column layout on narrow screens
Description
The production analysis flags the 5-column rate table as cramped on screens < 400px. On small mobile devices the "You Receive" and "Fee" columns clip.
Requirements

- Below 400px: collapse "Fee" and "Time" columns; expose via expandable row detail.
- "You Receive" and "Rate" always visible.
- No horizontal scroll on any viewport ≥ 320px.
  Acceptance Criteria
- Zero horizontal overflow at 320/360/390px. All columns visible at 768px+.
  Estimated File Changes: 2 (components/offramp/RateTable.tsx, components/offramp/RateRow.tsx)
  Labels: enhancement, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

#C013 [FEAT] [UI] Rate value highlight flash on SWR revalidation
Description
Complementary to #C002 (number ticker): when a rate value changes on revalidation, briefly flash the cell background (amber for a better rate, red for worse) before settling.
Requirements

- Changed cells: flash `bg-amber-100/40` (better) or `bg-red-100/40` (worse) for 600ms.
- Unchanged cells: no flash.
- Respect `prefers-reduced-motion`.
  Acceptance Criteria
- Correct color per direction of change; duration is exactly 600ms; no flash when value unchanged.
  Estimated File Changes: 2 (components/offramp/RateCell.tsx, hooks/usePrevious.ts)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

## WORKSTREAM E — EXECUTEDRAWER UX (`#C016–#C028`)

#C018 [FEAT] [UI] Correlation ID visible in ExecuteDrawer
Description
When OTel tracing (P1.5) lands, each execution gets a correlation ID. Surface it in the ExecuteDrawer so users can paste it into a support request.
Requirements

- Show `Trace ID: {id}` in a monospace chip at the bottom of the drawer during and after execution.
- Copy-to-clipboard button on the chip.
- Only visible once execution has started (not in idle state).
- Depends on P1.5 (OTel) landing first — gate behind a feature flag until then.
  Acceptance Criteria
- Chip appears on execution start; copy button writes to clipboard; hidden in idle state.
  Estimated File Changes: 2 (components/offramp/ExecuteDrawer.tsx, components/ui/TraceChip.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.4 SEP-6

---

#C021 [FEAT] [UI] ExecuteDrawer amount + rate confirmation step before signing
Description
Currently the user jumps from rate selection directly to signing. Add a confirmation view: "You send 100 USDC. Cowrie settles ₦154,200 to your bank account. Fee: ₦800. Rate locks in 28s."
Requirements

- Insert a `confirming` step between `idle` and `authenticating` in the state machine.
- Display: send amount, anchor name, expected receive amount, fee breakdown, rate expiry countdown.
- Two CTAs: "Confirm & sign" → advance, "Cancel" → back to idle.
  Acceptance Criteria
- Confirmation step shows correct values for the selected rate; Cancel resets; Confirm proceeds.
  Estimated File Changes: 2 (components/offramp/ExecuteDrawer.tsx, components/offramp/ConfirmStep.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

#C022 [FEAT] [A11Y] Full keyboard navigation through ExecuteDrawer steps
Description
ExecuteDrawer relies on click-only interactions. Keyboard users cannot navigate steps or activate controls without a mouse.
Requirements

- All interactive elements (Confirm, Cancel, Retry, Copy) keyboard-accessible via Tab + Enter/Space.
- State machine step transitions must not require mouse click.
- Focus moves to the first focusable element in each new step automatically.
  Acceptance Criteria
- Full E2E flow completable with keyboard only; no mouse required.
  Estimated File Changes: 2 (components/offramp/ExecuteDrawer.tsx, e2e/executedrawer.keyboard.spec.ts)
  Labels: accessibility, epic/ui, module/ui, difficulty/hard
  Milestone: v1.3 Off-ramp Polish

---

#C027 [FEAT] [UI] Rate alert set from rate row (UI shell, data dependency pending)
Description
Users want to be notified when the NGN rate exceeds a target. Ship the UI affordance now; wire to the actual alert system when Step 9 (price alerts) lands.
Requirements

- Bell icon on each rate row. Click opens a small popover: "Alert me when {corridor} rate exceeds [___]".
- Submit stores the alert in `localStorage` keyed by wallet address (not server yet).
- Badge on bell icon when an alert is set.
- Feature-flagged: `PRICE_ALERTS_ENABLED`. Off by default until Step 9 backend lands.
  Acceptance Criteria
- Alert stored in localStorage; bell badge shows; feature-flagged to off.
  Estimated File Changes: 3 (components/offramp/RateAlertPopover.tsx, hooks/useRateAlerts.ts, lib/flags.ts)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.5 Anchor Fleet

---

#C028 [FEAT] [UI] "Compare two anchors" side-by-side panel
Description
Power users want to compare Cowrie vs Bitso in detail. Multi-select on rate rows opens a comparison panel.
Requirements

- Checkbox on each rate row. Select exactly 2 rows to unlock "Compare" button.
- Comparison panel slides in from the right: both anchors side by side, all fields (rate, fee, fee_percent, min, max, time, SEP tier, health status).
- Clear button resets selection.
  Acceptance Criteria
- Panel shows both anchors with all fields; clear resets; selecting > 2 shows a "max 2" warning.
  Estimated File Changes: 4 (components/offramp/RateTable.tsx, components/offramp/RateRow.tsx, components/offramp/ComparePanel.tsx, hooks/useRateCompare.ts)
  Labels: feature, epic/ui, module/ui, difficulty/hard
  Milestone: v1.5 Anchor Fleet

---

## WORKSTREAM F — OFF-RAMP PAGE SHELL (`#C029–#C040`)

#C036 [FEAT] [UI] Amount input validation feedback — per-anchor min/max
Description
If a user enters $5 for a corridor with a $10 minimum, the rate table silently returns nothing. Show inline validation.
Requirements

- When `amount` is below the minimum for any anchor in the corridor: show inline "Min amount for {anchor}: $X".
- When `amount` exceeds the maximum: "Max amount for {anchor}: $Y".
- Derive min/max from the rate response (already returned from `/api/rates`).
  Acceptance Criteria
- Entering $5 on a $10-min corridor shows the warning inline; entering $50 clears it.
  Estimated File Changes: 2 (components/offramp/AmountInput.tsx, hooks/useAmountValidation.ts)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

## WORKSTREAM G — TRUST & LIVENESS SIGNALS (`#C041–#C050`)

#C041 [FEAT] [UI] Trust bar on /offramp page — above rate table
Description
Users sending real money need social proof. A trust bar showing transactions completed and USDC processed turns an anonymous tool into a product with a track record.
Requirements

- Bar above the rate table: "X transactions completed · $Y USDC processed · Z anchors active".
- Values from the reputation event log (#P3.3) or start at 0 if no data yet.
- Starts at zero and grows with each real transaction — never fabricated.
- Render the bar with skeleton values until data loads; do not block rate table render.
  Acceptance Criteria
- Trust bar renders with real or zero values; never shows mock/placeholder numbers.
  Estimated File Changes: 3 (components/offramp/TrustBar.tsx, app/api/stats/route.ts, app/offramp/page.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

#C043 [FEAT] [UI] Anchor health dot in rate rows
Description
Users cannot tell if an anchor is normally fast or currently degraded. A health indicator (sourced from nightly health data or heuristic detector P1.5.8) surfaces this.
Requirements

- Green/amber/red dot next to anchor name in each rate row.
- Tooltip: "Cowrie — Healthy · avg 6s settlement · 99.2% uptime (30d)".
- Data from the health probe (P1.5.8 when available) or static "unknown" dot until then.
- "Unknown" state: gray dot, no tooltip.
  Acceptance Criteria
- Three dot states render correctly; tooltip appears on hover; keyboard-accessible via focus.
  Estimated File Changes: 3 (components/offramp/AnchorHealthDot.tsx, components/offramp/RateRow.tsx, lib/reputation/health.ts)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.5 Anchor Fleet

---

#C045 [FEAT] [UI] "Last updated" per-anchor timestamp in rate row tooltip
Description
Users want to know how fresh each individual anchor's rate is (some anchors cache for longer).
Requirements

- Each rate row has a clock icon. Hover/focus: tooltip "Cowrie rate fetched 8s ago".
- Timestamp derived from the fetch start time logged by `useAnchorRates`.
  Acceptance Criteria
- Tooltip shows elapsed seconds since fetch; updates every second.
  Estimated File Changes: 2 (components/offramp/RateRow.tsx, hooks/useElapsed.ts)
  Labels: feature, epic/ui, module/ui, difficulty/good-first-issue
  Milestone: v1.3 Off-ramp Polish

---

#C046 [FEAT] [UI] Rate history tooltip on row hover
Description
After Step 7 (DB layer) lands, show a mini rate history on hover: "Best in last 24h: ₦1,547 · Worst: ₦1,491 · Now: ₦1,542".
Requirements

- Tooltip on rate value cell showing 24h high/low from the DB layer (#P5.1).
- Gate behind `RATE_HISTORY_ENABLED` feature flag — off until Step 7 lands.
- Graceful degradation: no tooltip when flag off.
  Acceptance Criteria
- Tooltip shows correct 24h high/low; absent when feature flag off.
  Estimated File Changes: 3 (components/offramp/RateHistoryTooltip.tsx, lib/flags.ts, components/offramp/RateRow.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.5 Anchor Fleet

---

#C047 [FEAT] [UI] Transaction milestone social card — "First 100 transactions"
Description
When the transaction count crosses a milestone (10, 100, 1000), show a brief celebratory card that the user can share.
Requirements

- After `StatusTracker` reaches `completed` and the global txn count crosses a milestone threshold: render a dismissible card "Stellar Intel just processed its 100th transaction. You were part of it."
- Social share CTA: pre-filled tweet/X message.
- Only shows once per milestone (localStorage flag).
  Acceptance Criteria
- Card appears at the 100th transaction completion; does not re-appear after dismissal.
  Estimated File Changes: 3 (components/offramp/MilestoneCard.tsx, hooks/useMilestone.ts, app/offramp/page.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.5 Anchor Fleet

---

#C049 [FEAT] [UI] "Rate improving" indicator — show if best rate is better than 7d average
Description
Context for whether today's rate is a good one. If it's above the 7-day average, show "Above average rate" badge.
Requirements

- Compare current best rate vs 7d average from DB (#P5.1).
- If current > 7d avg: "Above average ↑" green badge on best rate row.
- If current < 7d avg: "Below average ↓" amber badge.
- Gate: `RATE_HISTORY_ENABLED` flag (same as #C046).
  Acceptance Criteria
- Correct badge for above/below 7d average; absent when flag off or no 7d history.
  Estimated File Changes: 2 (components/offramp/RateQualityBadge.tsx, components/offramp/RateRow.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.5 Anchor Fleet

---

#C050 [FEAT] [UI] Corridor comparison: show all rates in a single table
Description
Currently users must switch corridors to compare NGN vs KES rates. A "compare corridors" mode shows all corridors simultaneously.
Requirements

- Toggle button: "Compare corridors". When active, the rate table expands to show all corridors, one section per corridor.
- Only renders top anchor per corridor (not all 5 rows per corridor — that would be overwhelming).
- Amount input drives all corridors simultaneously.
  Acceptance Criteria
- All corridors shown simultaneously with the same amount; top anchor per corridor visible.
  Estimated File Changes: 3 (components/offramp/CorridorCompare.tsx, app/offramp/page.tsx, hooks/useAllCorridorRates.ts)
  Labels: feature, epic/ui, module/ui, difficulty/hard
  Milestone: v1.5 Anchor Fleet

---

## WORKSTREAM H — WALLET UX (`#C051–#C060`)

#C053 [FEAT] [UI] Freighter install guide when not installed
Description
When `isInstalled === false`, the WalletButton shows a connect prompt but no install guidance. New users don't know what Freighter is.
Requirements

- When Freighter is not detected: "Connect Wallet" button opens a modal explaining Freighter with: what it is, install link (chrome.google.com/webstore), and a "I've installed it — Connect" CTA that re-checks.
- Modal is dismissible.
  Acceptance Criteria
- Install guide modal renders when Freighter not detected; re-checking after install works.
  Estimated File Changes: 2 (components/ui/FreighterInstallModal.tsx, components/ui/WalletButton.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

#C060 [FEAT] [UI] Wallet-gated features lock icon
Description
Some features (price alerts #C027, history, portfolio) require a connected wallet. Show a lock icon on these features when disconnected, with a tooltip "Connect wallet to use this feature."
Requirements

- `<WalletGate>` wrapper component: renders children normally when connected, renders children with an overlaid lock icon and tooltip when disconnected.
- Clicking the lock triggers wallet connection.
  Acceptance Criteria
- Lock appears on disconnected wallet for gated features; disappears on connect.
  Estimated File Changes: 2 (components/ui/WalletGate.tsx, components/offramp/RateRow.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

## WORKSTREAM J — BRAND & GLOBAL (`#C071–#C080`)

#C071 [FEAT] [UI] Stellar gradient palette token swap — replace #2563eb globally
Description
The production analysis grades Visual Design C+ (65%). The primary culprit: generic `#2563eb` blue indistinguishable from hundreds of other fintech apps. Replace with Stellar-inspired deep purple → teal.
Requirements

- Replace `#2563eb` with the brand token set from `docs/BRAND.md` (MAINTAINER Priority 4 design task must complete first).
- Update `app/globals.css` Tailwind `@theme` tokens.
- Verify all components in light + dark mode.
- Depends on: MAINTAINER Priority 4 (wordmark + token doc) complete.
  Acceptance Criteria
- Zero `#2563eb` references in source after this PR; design review sign-off.
  Estimated File Changes: 3 (app/globals.css, components/\*_/_, tailwind.config.ts)
  Labels: feature, epic/ui, module/ui, difficulty/hard
  Milestone: v1.3 Off-ramp Polish

---

#C072 [FEAT] [UI] Wordmark integration in Header
Description
The header currently shows plain text "Stellar Intel." Replace with the SVG wordmark once the design asset is delivered (MAINTAINER Priority 4).
Requirements

- Replace the `<span>` text logo with `<Image src="/wordmark.svg" alt="Stellar Intel" />` in `Header.tsx`.
- Appropriate sizing for navbar context (height: 28px, auto width).
- Dark mode: use light variant of the wordmark.
- Depends on: wordmark SVG delivery from MAINTAINER Priority 4.
  Acceptance Criteria
- Wordmark renders in header at correct size; dark mode shows light variant.
  Estimated File Changes: 1 (components/layout/Header.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/good-first-issue
  Milestone: v1.3 Off-ramp Polish

---

#C075 [FEAT] [UI] CSS animation performance audit — force GPU compositing
Description
Animations in the rate table and ExecuteDrawer may use `top`/`left` properties which trigger layout recalculations. All animations should use only `transform` and `opacity`.
Requirements

- Audit all `transition`/`animation` CSS in components. Replace any `top`, `left`, `height`, `width` transitions with `transform: translateY/translateX/scale`.
- Add `will-change: transform` only on elements that animate frequently (SWR ticker cells).
  Acceptance Criteria
- Chrome DevTools Performance panel shows zero layout/paint during rate table animations.
  Estimated File Changes: 4 (components/offramp/RateRow.tsx, components/offramp/ExecuteDrawer.tsx, components/offramp/StepIndicator.tsx, app/globals.css)
  Labels: enhancement, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

#C077 [FEAT] [UI] Reduced motion pass for all off-ramp animations
Description
`prefers-reduced-motion` is respected in landing page animations but not audited for the off-ramp page.
Requirements

- Audit: rate table stagger (#C003), number ticker (#C002), highlight flash (#C013), ExecuteDrawer slide, StepIndicator pulse.
- For each: add `@media (prefers-reduced-motion: reduce)` rule disabling or reducing the animation.
  Acceptance Criteria
- Zero visible animations under `prefers-reduced-motion: reduce` for all off-ramp components.
  Estimated File Changes: 5 (components/offramp/RateTable.tsx, RateRow.tsx, RateCell.tsx, ExecuteDrawer.tsx, StepIndicator.tsx)
  Labels: accessibility, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

## WORKSTREAM K — ACCESSIBILITY (`#C081–#C090`)

#C081 [FEAT] [A11Y] WCAG contrast audit on off-ramp — gray-400 sweep
Description
The production analysis flags `gray-400` on white as a potential WCAG 4.5:1 failure. A full contrast audit is needed.
Requirements

- Identify all `text-gray-400` (and equivalent custom colors) on white/light backgrounds.
- Replace with minimum `text-gray-600` (light) / `text-gray-400` (dark, already passing on dark backgrounds).
- Run automated contrast check with `axe` on `/offramp`.
  Acceptance Criteria
- Zero WCAG 2.1 AA contrast failures on `/offramp` per axe.
  Estimated File Changes: multiple (components/offramp/_, components/ui/_)
  Labels: accessibility, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

#C082 [FEAT] [A11Y] Visible focus ring audit on off-ramp page
Description
The production analysis does not call out focus rings specifically but the standard Next.js/Tailwind setup often hides them via `outline: none`. All interactive elements need visible focus rings.
Requirements

- Audit: every `<button>`, `<a>`, `<input>`, `<select>` on `/offramp` has a visible focus indicator.
- Default Tailwind `ring-2 ring-offset-2 ring-blue-500` (or brand color after #C071) on focus.
- No `outline: none` without a replacement focus indicator.
  Acceptance Criteria
- Tab through all interactive elements on `/offramp`; all have visible focus rings.
  Estimated File Changes: 3 (app/globals.css, components/offramp/_, components/ui/_)
  Labels: accessibility, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

#C085 [FEAT] [A11Y] Interactive element minimum size — 44×44px on mobile
Description
The production analysis (Mobile Experience B+) notes tap targets may not account for fixed nav height on all devices. WCAG 2.5.5 (AAA) and iOS HIG require 44×44px minimum tap targets.
Requirements

- Audit all buttons and links on `/offramp` mobile view (375px).
- Any target below 44×44px: increase padding, not the visual size (preserve design).
- Rate row tap target must be the full row width.
  Acceptance Criteria
- Zero tap targets below 44×44px on 375px viewport per manual audit.
  Estimated File Changes: 3 (components/offramp/RateRow.tsx, components/ui/WalletButton.tsx, components/offramp/CorridorSelector.tsx)
  Labels: accessibility, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

#C086 [FEAT] [A11Y] Color-not-only indicator for Best Rate badge and health dots
Description
WCAG 1.4.1: color must not be the only means of conveying information. The Best Rate badge uses green color and a text label (passes). Health dots (#C043) use only color.
Requirements

- Health dots: add shape differentiation. Healthy: solid circle. Degraded: triangle outline. Down: X mark. Color is additive, not the only signal.
- Best Rate badge already passes (text + color) — no change needed.
  Acceptance Criteria
- Health status distinguishable without color in grayscale mode.
  Estimated File Changes: 1 (components/offramp/AnchorHealthDot.tsx)
  Labels: accessibility, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.5 Anchor Fleet

---

## WORKSTREAM L — PERFORMANCE (`#C091–#C095`)

#C091 [FEAT] [PERF] Rate limit /api/rates — 60 req/min per IP
Description
`/api/rates` is currently open to abuse — no rate limiting. A single client can hammer anchor APIs via Stellar Intel.
Requirements

- Token bucket: 60 requests/minute per IP using Vercel KV or an in-memory store.
- Return `429 Too Many Requests` with `Retry-After: {seconds}` header.
- `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers on all responses.
  Acceptance Criteria
- 61st request in 60s returns 429; client under limit receives 200 with correct headers.
  Estimated File Changes: 3 (app/api/rates/route.ts, lib/rateLimit.ts, package.json)
  Labels: feature, epic/perf, module/api, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

#C094 [FEAT] [PERF] Prefetch corridor data on corridor selector hover
Description
Rate data for a corridor could begin fetching while the user is hovering the corridor option, shaving time-to-display.
Requirements

- `useAnchorRates` supports a `prefetch` call triggered by `onMouseEnter` on a corridor option.
- SWR's `mutate` or `preload` used to warm the cache.
- Only prefetches corridors the user hovers; does not pre-fetch all corridors on mount.
  Acceptance Criteria
- After hovering a corridor option for 200ms, switching to that corridor shows rates from cache (< 100ms display time).
  Estimated File Changes: 2 (components/offramp/CorridorSelector.tsx, hooks/useAnchorRates.ts)
  Labels: enhancement, epic/perf, module/perf, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

#C095 [FEAT] [PERF] /offramp route bundle size enforcement in CI
Description
No automated enforcement of the bundle size target (< 180KB gzipped first-load JS for `/offramp`). Without this, incremental PRs silently bloat the bundle.
Requirements

- Add `size-limit` config targeting `/offramp` first-load JS.
- CI fails if the limit is exceeded.
- Separate limit for the ExecuteDrawer lazy chunk (after #C093): < 60KB gzipped.
  Acceptance Criteria
- A PR that adds a large dependency exceeding 180KB fails CI with a size-limit error.
  Estimated File Changes: 2 (.size-limit.json, .github/workflows/ci.yml)
  Labels: chore, epic/perf, module/ops, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

## WORKSTREAM M — ANALYTICS & SEO (`#C096–#C100`)

#C096 [FEAT] [ANALYTICS] Privacy-respecting analytics integration (Plausible or Fathom)
Description
No analytics exist. Zero visibility into which corridors users select, where they drop off, or how many complete execution.
Requirements

- Integrate Plausible Analytics (self-hosted or cloud) — no cookies, no GDPR issues, no PII.
- Track page views: `/`, `/offramp`, `/anchors`.
- Use the Next.js Script component; fire only after page hydration.
  Acceptance Criteria
- Plausible dashboard shows page view counts; no third-party cookies set; no PII collected.
  Estimated File Changes: 3 (app/layout.tsx, app/offramp/page.tsx, package.json)
  Labels: feature, epic/analytics, module/analytics, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

#C097 [FEAT] [ANALYTICS] Funnel event tracking — corridor → rate → execute → complete
Description
Page views are not enough. Tracking funnel drop-off shows where users abandon.
Requirements

- Custom Plausible goals (no PII in event payloads): `corridor-selected`, `amount-entered`, `rate-row-viewed`, `execute-drawer-opened`, `wallet-connected`, `signature-completed`, `transaction-completed`.
- Events fire at each funnel step.
- Never include wallet address, amount, or corridor in event properties (aggregate only).
  Acceptance Criteria
- All 7 events visible in Plausible dashboard; no PII in event names or properties.
  Estimated File Changes: 3 (hooks/useAnalytics.ts, components/offramp/RateRow.tsx, components/offramp/ExecuteDrawer.tsx)
  Labels: feature, epic/analytics, module/analytics, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

#C098 [FEAT] [ANALYTICS] Error event tracking — anchor failure rates
Description
When anchors fail, the errors currently go only into `errors[]` in the rate response. Tracking them in analytics surfaces systemic anchor reliability issues.
Requirements

- Fire a `anchor-rate-error` event (Plausible custom event) when an anchor is in `errors[]`.
- Event properties (aggregate, no PII): `anchorId`, `corridor`, `errorClass` (timeout / 4xx / 5xx / parse).
- Dashboard shows which anchors fail most per corridor.
  Acceptance Criteria
- `anchor-rate-error` events appear in Plausible with correct properties; no user data.
  Estimated File Changes: 2 (hooks/useAnchorRates.ts, hooks/useAnalytics.ts)
  Labels: feature, epic/analytics, module/analytics, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

#C100 [FEAT] [UI] "Share your savings" card after completed transaction
Description
Word-of-mouth acquisition: after a completed transaction, show a shareable card quantifying the user's saving vs going directly to the anchor.
Requirements

- In StatusTracker `completed` state: calculate savings = `(rate_via_intel - direct_anchor_rate) * amount`. If savings > 0: render "You saved ₦{N} vs going directly to {anchor}. Share your savings:" with a pre-filled tweet.
- If no comparison data (single anchor), skip the card.
- Share CTA uses Web Share API with fallback copy (#C067).
  Acceptance Criteria
- Card renders with correct savings amount; absent when no comparison data; share CTA functional.
  Estimated File Changes: 3 (components/offramp/StatusTracker.tsx, components/offramp/SavingsCard.tsx, hooks/useShare.ts)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.5 Anchor Fleet
