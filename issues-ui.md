# Stellar Intel — UI Issues Batch C (100 issues)

> **Scope**: Off-ramp rate table, ExecuteDrawer, off-ramp page shell, trust
> signals, wallet UX, StatusTracker, brand/global, accessibility, performance,
> analytics, and SEO. None of these are in `issue.md` (#001–#250) or
> `issues-batch-2.md` (#B001–#B100).
>
> **Workstreams:**
>
> - **D. Rate table UI** — `#C001–#C015`
> - **E. ExecuteDrawer UX** — `#C016–#C028`
> - **F. Off-ramp page shell** — `#C029–#C040`
> - **G. Trust & liveness signals** — `#C041–#C050`
> - **H. Wallet UX** — `#C051–#C060`
> - **I. StatusTracker** — `#C061–#C070`
> - **J. Brand & global** — `#C071–#C080`
> - **K. Accessibility** — `#C081–#C090`
> - **L. Performance** — `#C091–#C095`
> - **M. Analytics & SEO** — `#C096–#C100`
>
> **Format**: matches `issues-batch-2.md` exactly so `scripts/create-issues.sh`
> can file them mechanically.

---

## WORKSTREAM D — RATE TABLE UI (`#C001–#C015`)

#C001 [FEAT] [UI] Rate freshness countdown in rate table header
Description
The rate table refreshes via SWR every 30 seconds but gives the user no signal. Users who move money professionally need to know how fresh the data is.
Requirements

- Add a countdown below or beside the rate table title: "Rates valid for ~28s" that counts down from 30 to 0, then resets on SWR revalidation.
- Use `useAnchorRates` revalidation timestamp as the reset trigger.
- Respect `prefers-reduced-motion` — fall back to static "last updated Xs ago" text.
  Acceptance Criteria
- Countdown resets on every SWR revalidation; never shows stale time.
- Under reduced-motion: shows elapsed seconds since last fetch, no animation.
  Estimated File Changes: 3 (components/offramp/RateTableHeader.tsx, hooks/useCountdown.ts, components/offramp/RateTable.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

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

#C004 [FEAT] [UI] Hover state animation on rate rows
Description
Rate rows have no hover state beyond cursor change. A subtle background highlight with a right-pointing arrow hint makes the table feel interactive.
Requirements

- On hover: background lightens (dark mode: `bg-white/5`, light mode: `bg-black/3`), a `→` icon fades in on the right edge.
- Transition: 120ms ease.
- Touch devices: no persistent hover state.
  Acceptance Criteria
- Hover renders correctly in light + dark; no flicker on rapid hover in/out.
  Estimated File Changes: 2 (components/offramp/RateRow.tsx, styles related)
  Labels: feature, epic/ui, module/ui, difficulty/good-first-issue
  Milestone: v1.3 Off-ramp Polish

---

#C005 [FEAT] [UI] Rate table sorting UI — implement OfframpSortKey controls
Description
`OfframpSortKey` type exists in `types/index.ts` but no sort controls exist in the UI. Users cannot sort by rate, fee, or processing time.
Requirements

- Add sort toggle buttons on column headers: "Rate", "Fee", "Time".
- Toggle: unsorted → ascending → descending → unsorted.
- Sort state lives in local component state (not URL, not global).
- Sorting is client-side on the already-fetched `rates[]` array.
  Acceptance Criteria
- Three sortable columns; correct ascending/descending order; no re-fetch on sort.
  Estimated File Changes: 3 (components/offramp/RateTable.tsx, components/offramp/SortToggle.tsx, lib/sort.ts)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

#C006 [FEAT] [A11Y] aria-live region wrapping rate table for screen reader announcements
Description
When rates load or update, screen reader users receive no notification. An `aria-live="polite"` region should announce updates.
Requirements

- Wrap rate table in `<div aria-live="polite" aria-atomic="false">`.
- Announce: "Rates updated. Best rate: ₦1,542 via Cowrie." on each revalidation.
- Do not announce on identical data (no change).
  Acceptance Criteria
- VoiceOver/NVDA announces the update message on revalidation; silent when unchanged.
  Estimated File Changes: 2 (components/offramp/RateTable.tsx, hooks/useRateAnnouncement.ts)
  Labels: accessibility, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

#C007 [FEAT] [UI] URL state sync — corridor + amount in query params
Description
Changing corridor or amount does not update the URL, so back/forward navigation loses the selection and the page cannot be deep-linked.
Requirements

- Write `corridor` and `amount` to URL query params on change: `?corridor=usdc-ngn&amount=100`.
- Read from URL on mount (SSR-safe).
- Browser history: replace, not push (avoid polluting history on every keystroke).
  Acceptance Criteria
- Direct URL with params renders the correct corridor + amount on load. Back nav restores previous selection.
  Estimated File Changes: 2 (app/offramp/page.tsx, hooks/useOfframpParams.ts)
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

#C009 [FEAT] [UI] Rate savings callout next to Best Rate badge
Description
The "Best Rate" badge tells users which anchor wins, but not by how much. Show "You save ₦450 vs worst option" next to the badge.
Requirements

- Compute: `(bestRate - worstRate) * amount` for the selected amount.
- Show inline: "Save ₦{N} vs others" or "Save {X}% vs others".
- Update reactively with amount changes.
- Hide when only one rate is available (no comparison).
  Acceptance Criteria
- Savings amount correct for a hand-verified example; hidden when < 2 rates.
  Estimated File Changes: 3 (components/offramp/RateRow.tsx, lib/savings.ts, tests/savings.spec.ts)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
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

#C011 [FEAT] [UI] Rate table initial skeleton rows (distinct from SWR refresh)
Description
On first mount before any rates arrive, the rate table shows nothing. Skeleton rows fill the expected layout space so the page doesn't jump.
Requirements

- Show 4 skeleton rows (matching real row height) while `useAnchorRates` is in loading state.
- Skeleton rows have pulse animation.
- On data arrival: skeleton fades out, real rows stagger in (#C003).
  Acceptance Criteria
- No layout shift between skeleton and real rows; CLS = 0 on this transition.
  Estimated File Changes: 2 (components/offramp/RateTable.tsx, components/offramp/RateRowSkeleton.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/good-first-issue
  Milestone: v1.3 Off-ramp Polish

---

#C012 [FEAT] [UI] "No rates available" empty state with illustration and recovery
Description
When all anchors fail for a corridor, the rate table renders blank. Empty state should explain what happened and offer a way out.
Requirements

- Render a friendly empty state: "No rates available for USDC→NGN right now." with a sub-message "Anchors may be temporarily unavailable. Rates refresh every 30 seconds."
- Show which anchors were tried and failed (from `errors[]`).
- CTA: "Try another corridor" link to corridor selector, "Refresh now" button.
  Acceptance Criteria
- Empty state shows when `rates.length === 0` and `errors.length > 0`; never a blank table.
  Estimated File Changes: 2 (components/offramp/RateTableEmpty.tsx, components/offramp/RateTable.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
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

#C014 [FEAT] [UI] Best rate row visual distinction — green left border
Description
The "Best Rate" badge inside the row is small. Adding a green left border to the winning row makes it scannable at a glance, consistent with how comparison UIs (Skyscanner, Google Flights) highlight the winner.
Requirements

- Best-rate row gets a 3px left border in `green-500` (dark mode: `green-400`).
- If best rate changes on revalidation, border moves to the new winner without animation delay.
  Acceptance Criteria
- Exactly one row has the green border at any time; moves on revalidation.
  Estimated File Changes: 1 (components/offramp/RateRow.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/good-first-issue
  Milestone: v1.3 Off-ramp Polish

---

#C015 [FEAT] [UI] Rate row expandable detail panel
Description
Currently the rate row shows only Rate, Fee, You Receive, and Time. A click-to-expand reveals: full fee breakdown (fee_fixed, fee_percent), min/max amount, SEP tier (firm quote vs indicative), anchor processing notes.
Requirements

- Chevron icon on each row. Click toggles an inline expanded panel below the row.
- Expanded panel shows: fee breakdown, min amount, max amount, SEP source (SEP-38 firm / SEP-24 indicative / SEP-6 indicative), last-updated timestamp.
- Only one row can be expanded at a time.
  Acceptance Criteria
- Panel opens/closes without layout shift; content correct for a fixture.
  Estimated File Changes: 3 (components/offramp/RateRow.tsx, components/offramp/RateRowDetail.tsx, types/index.ts)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

## WORKSTREAM E — EXECUTEDRAWER UX (`#C016–#C028`)

#C016 [FEAT] [A11Y] Focus trap in ExecuteDrawer
Description
The production analysis identifies missing focus trap in ExecuteDrawer as a WCAG failure. Keyboard users can tab out of the open drawer into the background page.
Requirements

- Use `focus-trap-react` (zero-dependency wrapper). Activate on drawer open, deactivate on close.
- Initial focus: first focusable element inside the drawer.
- Escape key: close drawer only if in `idle` or `error` state; no-op mid-execution.
  Acceptance Criteria
- Tab cycling stays inside the open drawer; Escape closes when safe. WCAG 2.1 AA pass.
  Estimated File Changes: 2 (components/offramp/ExecuteDrawer.tsx, package.json)
  Labels: accessibility, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

#C017 [FEAT] [A11Y] aria-describedby linking amount input to helper text
Description
The amount input has a helper text "Enter USDC amount to compare" but it is not programmatically associated with the input.
Requirements

- Give helper text a stable `id` (e.g. `amount-helper`).
- Add `aria-describedby="amount-helper"` to the `<input>`.
- Same pattern for any other inputs with helper text in the off-ramp page.
  Acceptance Criteria
- Screen reader announces helper text when input is focused.
  Estimated File Changes: 1 (components/offramp/AmountInput.tsx)
  Labels: accessibility, epic/ui, module/ui, difficulty/good-first-issue
  Milestone: v1.3 Off-ramp Polish

---

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

#C019 [FEAT] [UI] Error recovery flow — "Retry" vs "Start over" in ExecuteDrawer error step
Description
When the ExecuteDrawer hits an error state it shows a generic error. Users don't know if they should retry the same step or start over.
Requirements

- Classify errors as retryable (network timeout, Horizon 503) vs non-retryable (user rejected, wrong memo, expired challenge).
- Retryable: show "Retry" button that re-attempts the failed step.
- Non-retryable: show "Start over" button that resets to idle, and a clear reason.
- Map to the error code system (P1.5.1) when available.
  Acceptance Criteria
- Retryable errors show Retry; non-retryable show Start over; both restore a working state.
  Estimated File Changes: 3 (components/offramp/ExecuteDrawer.tsx, lib/errors/classify.ts, tests/ExecuteDrawer.error.spec.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/hard
  Milestone: v1.3 Off-ramp Polish

---

#C020 [FEAT] [UI] Per-step error descriptions in ExecuteDrawer
Description
The current error step shows a generic "Something went wrong." Users cannot self-diagnose.
Requirements

- Map each failure point to a human-readable message: "Freighter rejected the signature", "Anchor challenge expired — refresh and try again", "Horizon rejected the transaction — check your USDC balance".
- Include a link to the RUNBOOK for the error type (when published).
  Acceptance Criteria
- Three distinct error scenarios show three distinct messages; no "Something went wrong" for classified errors.
  Estimated File Changes: 2 (components/offramp/ExecuteDrawer.tsx, lib/errors/messages.ts)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

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

#C023 [FEAT] [UI] Escape key behavior scoped by ExecuteDrawer state
Description
Pressing Escape mid-execution risks losing the transaction context. Escape should only close the drawer when safe.
Requirements

- `idle` / `error` / `done` states: Escape closes the drawer.
- All mid-execution states (`authenticating` → `signing`): Escape shows a "Are you sure? Closing now may leave the transaction in an unknown state." confirmation dialog.
- Dialog has two options: "Stay" (dismiss dialog) and "Close anyway" (close drawer, transaction may be in-flight).
  Acceptance Criteria
- Escape mid-execution shows the confirmation dialog; Escape in idle closes immediately.
  Estimated File Changes: 2 (components/offramp/ExecuteDrawer.tsx, components/ui/ConfirmCloseDialog.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

#C024 [FEAT] [UI] Step time estimates in ExecuteDrawer StepIndicator
Description
Users don't know how long each step takes. Adding per-step estimates reduces abandonment during slow KYC or Horizon submission.
Requirements

- Each step label gets a time suffix: "Authenticating (~5s)", "KYC (~30s)", "Submitting to Stellar (~10s)".
- Estimates come from a constants file (not live data at this point).
  Acceptance Criteria
- All 6 step labels include a time estimate; estimates are accurate within 2× for live anchors.
  Estimated File Changes: 2 (components/offramp/StepIndicator.tsx, lib/stellar/step-estimates.ts)
  Labels: feature, epic/ui, module/ui, difficulty/good-first-issue
  Milestone: v1.3 Off-ramp Polish

---

#C025 [FEAT] [UI] ExecuteDrawer width cap on desktop — 480px max-width centered
Description
On wide desktop screens the ExecuteDrawer side panel stretches to fill an uncomfortable width. Cap it and center the content.
Requirements

- On screens ≥ 1024px: drawer renders as a centered modal, max-width 480px, with a blurred backdrop.
- On screens < 1024px: keep current bottom-sheet behaviour.
- No layout shift on resize across the breakpoint.
  Acceptance Criteria
- Desktop: 480px centered modal. Mobile: full-width bottom sheet. Resize across 1024px is seamless.
  Estimated File Changes: 1 (components/offramp/ExecuteDrawer.tsx)
  Labels: enhancement, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

#C026 [FEAT] [UI] Popular amount quick-select chips
Description
Most users send round amounts. Chips below the amount input eliminate a typing step.
Requirements

- Four chips: "$50 / $100 / $500 / $1,000".
- Clicking a chip sets the amount input and triggers a rate refetch.
- Active chip highlighted.
- Chips disappear on focus into the amount input (replaced by the user's typed value).
  Acceptance Criteria
- Selecting $100 chip sets amount to 100, rate table updates. Typing manually deselects all chips.
  Estimated File Changes: 2 (components/offramp/AmountInput.tsx, components/offramp/AmountChips.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/good-first-issue
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

#C029 [FEAT] [A11Y] Skip navigation link in layout.tsx
Description
Keyboard users must tab through the full navigation on every page before reaching the rate table. A skip link fixes this.
Requirements

- Add `<a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-white focus:text-black focus:rounded">Skip to content</a>` as the first element in `app/layout.tsx`.
- `<main id="main-content">` in the layout.
  Acceptance Criteria
- First Tab on any page lands on the skip link; activating it moves focus to `#main-content`.
  Estimated File Changes: 1 (app/layout.tsx)
  Labels: accessibility, epic/ui, module/ui, difficulty/good-first-issue
  Milestone: v1.3 Off-ramp Polish

---

#C030 [FEAT] [SEO] OG/Twitter meta for /offramp route
Description
`#B092` adds social meta to the landing page only. The `/offramp` route has minimal metadata — no OG image, no Twitter card.
Requirements

- `generateMetadata` in `app/offramp/layout.tsx` with: `title`, `description`, `og:image` (the og-image from MAINTAINER Priority 4), `twitter:card: summary_large_image`.
- Dynamic title when corridor is set: "USDC → NGN rates — Stellar Intel".
  Acceptance Criteria
- Link preview on X/LinkedIn shows the OG image + correct title for both default and corridor-set states.
  Estimated File Changes: 2 (app/offramp/layout.tsx, app/offramp/page.tsx)
  Labels: feature, epic/ui, module/seo, difficulty/good-first-issue
  Milestone: v1.3 Off-ramp Polish

---

#C031 [FEAT] [UI] Legal disclaimer banner on /offramp page
Description
The production analysis flags missing legal disclaimers as a gap for a financial product handling real money.
Requirements

- Dismissible banner below the page header: "Stellar Intel is non-custodial. You sign every transaction with your own wallet. Rates are live quotes, not guarantees. [Terms]".
- Dismissed state stored in `localStorage`; does not reappear for 30 days.
- Not dismissible on first visit — user must scroll past it once.
  Acceptance Criteria
- Banner present on first visit; dismissed after acknowledgment; reappears after 30 days.
  Estimated File Changes: 2 (components/offramp/DisclaimerBanner.tsx, app/offramp/page.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/good-first-issue
  Milestone: v1.3 Off-ramp Polish

---

#C032 [FEAT] [UI] Testnet toggle UI — environment indicator
Description
The app is hard-coded to mainnet. There is no way for a developer to switch to testnet for testing without modifying env vars. A visible indicator prevents accidental mainnet transactions during development.
Requirements

- When `NEXT_PUBLIC_STELLAR_NETWORK=testnet`, show a persistent amber banner: "⚠ TESTNET — transactions do not use real funds".
- No toggle control in the UI (network set by env); banner is display-only.
- Entirely hidden on mainnet.
  Acceptance Criteria
- Banner visible on testnet build; absent on mainnet build. No env var → defaults to mainnet behavior.
  Estimated File Changes: 2 (components/offramp/TestnetBanner.tsx, app/offramp/layout.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/good-first-issue
  Milestone: v1.3 Off-ramp Polish

---

#C033 [FEAT] [A11Y] Refresh rates button aria-label
Description
The refresh button in the rate table header has no `aria-label`. Screen readers announce it as "button" with no context.
Requirements

- Add `aria-label="Refresh rates"` to the refresh button.
- When a refresh is in progress: `aria-label="Refreshing rates..."` + `aria-busy="true"`.
  Acceptance Criteria
- Screen reader announces "Refresh rates" on focus; "Refreshing rates" during the fetch.
  Estimated File Changes: 1 (components/offramp/RateTableHeader.tsx)
  Labels: accessibility, epic/ui, module/ui, difficulty/good-first-issue
  Milestone: v1.3 Off-ramp Polish

---

#C034 [FEAT] [UI] React Error Boundary around rate table
Description
If `useAnchorRates` or `RateTable` throws a runtime error, the entire `/offramp` page blanks. An error boundary contains the failure.
Requirements

- Wrap `<RateTable />` in an `ErrorBoundary` that catches render errors.
- Fallback: "Rate table encountered an error. [Retry]" with a reload CTA.
- Log the error to the structured logger (P1.4) when available.
  Acceptance Criteria
- A simulated throw in `RateTable` renders the fallback, not a blank page.
  Estimated File Changes: 2 (components/ui/ErrorBoundary.tsx, app/offramp/page.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

#C035 [FEAT] [UI] React Error Boundary around ExecuteDrawer
Description
If `ExecuteDrawer` throws mid-execution, the user loses their transaction state and the page blanks.
Requirements

- Wrap `<ExecuteDrawer />` in its own `ErrorBoundary`.
- Fallback: "An error occurred during your transaction. Your USDC has NOT been sent. [View wallet on Stellar Expert] [Close]".
- The message must be conservative: assume funds were NOT sent unless there is a confirmed transaction ID.
  Acceptance Criteria
- Simulated throw inside ExecuteDrawer shows the fallback with the conservative message.
  Estimated File Changes: 2 (components/offramp/ExecuteDrawer.tsx, components/ui/ErrorBoundary.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

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

#C037 [FEAT] [UI] Corridor selector loading state
Description
When the page first mounts, the corridor selector may briefly show an empty state while JS initializes. A skeleton prevents layout jump.
Requirements

- Show a skeleton pill in place of the corridor selector during hydration.
- Once hydrated: cross-fade to the real selector.
  Acceptance Criteria
- No layout shift (CLS = 0) during corridor selector hydration.
  Estimated File Changes: 1 (components/offramp/CorridorSelector.tsx)
  Labels: enhancement, epic/ui, module/ui, difficulty/good-first-issue
  Milestone: v1.3 Off-ramp Polish

---

#C038 [FEAT] [UI] Page transition animation between off-ramp states
Description
The off-ramp page currently has no page-level transitions. When the drawer opens or closes, the background page just sits there.
Requirements

- When ExecuteDrawer opens: background page blurs/dims (`backdrop-blur-sm` + `opacity-80`).
- When drawer closes: transition reverses.
- Transition duration: 200ms ease.
- Respect `prefers-reduced-motion`.
  Acceptance Criteria
- Drawer open blurs background; close restores it. No transition under reduced-motion.
  Estimated File Changes: 2 (app/offramp/page.tsx, components/offramp/ExecuteDrawer.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

#C039 [FEAT] [UI] "Copy rate" button on best rate row
Description
Users want to share or save the best rate. A copy button on the winning row writes a shareable string to clipboard.
Requirements

- Copy icon on the best rate row. On click: copies "Best USDC→NGN rate: ₦1,542 via Cowrie. Checked {timestamp} on stellarintel.xyz/offramp?corridor=usdc-ngn" to clipboard.
- Brief "Copied!" tooltip confirmation.
  Acceptance Criteria
- Clipboard contains the correct string; tooltip appears for 2 seconds then fades.
  Estimated File Changes: 2 (components/offramp/RateRow.tsx, hooks/useClipboard.ts)
  Labels: feature, epic/ui, module/ui, difficulty/good-first-issue
  Milestone: v1.3 Off-ramp Polish

---

#C040 [FEAT] [UI] "Popular amounts" pre-fill from corridor context
Description
Extend #C026 (chips) to suggest contextually appropriate amounts: "Typical Nigeria remittance: $50 · $100 · $200" vs "Typical Mexico: $100 · $300 · $500".
Requirements

- Per-corridor typical amounts defined in `constants/anchors.ts` (maintainer-set, not computed).
- Replace the static "$50 / $100 / $500 / $1,000" chips (#C026) with corridor-specific amounts when defined.
- Falls back to static chips when corridor has no defined typical amounts.
  Acceptance Criteria
- USDC→NGN shows Nigeria-typical amounts; USDC→MXN shows MXN-typical amounts.
  Estimated File Changes: 2 (constants/anchors.ts, components/offramp/AmountChips.tsx)
  Labels: enhancement, epic/ui, module/ui, difficulty/good-first-issue
  Milestone: v1.5 Anchor Fleet

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

#C042 [FEAT] [UI] Live anchor count badge — "3 of 5 anchors responding"
Description
When some anchors fail, users see fewer rate rows but don't know why. A live count tells them the comparison is partial.
Requirements

- Badge near rate table title: "5 of 5 anchors responding" (all good) or "3 of 5 anchors responding" (failures).
- Derives from `rates.length + errors.length` from `useAnchorRates`.
- Color: green when all responding, amber when partial, red when 0.
  Acceptance Criteria
- Badge updates on SWR revalidation; correct count for all three states.
  Estimated File Changes: 2 (components/offramp/AnchorCountBadge.tsx, components/offramp/RateTable.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/good-first-issue
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

#C044 [FEAT] [UI] Rate volatility badge — "Rate moving" when spread shifts > 2%
Description
If the best NGN rate jumped 2% between two SWR refreshes, that is worth surfacing. A brief "Rate moving ↑" badge next to the countdown alerts users to act.
Requirements

- Compare current best rate vs previous best rate (from `usePrevious`).
- If change > 2%: show "Rate moving ↑" (green) or "Rate moving ↓" (red) badge near the countdown.
- Badge auto-dismisses after 10 seconds.
- Respect `prefers-reduced-motion`.
  Acceptance Criteria
- Badge appears on > 2% shift; disappears after 10s; absent on < 2% shift.
  Estimated File Changes: 3 (components/offramp/RateVolatilityBadge.tsx, hooks/usePrevious.ts, components/offramp/RateTableHeader.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

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

#C048 [FEAT] [UI] Anchor scorecard deep-link from rate row
Description
Clicking an anchor's name in the rate row should navigate to its scorecard page.
Requirements

- Anchor name in the rate row is a link → `/anchors/{anchorId}`.
- Opens in the same tab.
- Does not trigger the ExecuteDrawer (click on name = navigate; click on row body = open drawer).
  Acceptance Criteria
- Clicking "Cowrie" in the rate row navigates to `/anchors/cowrie`; clicking elsewhere on the row opens the drawer.
  Estimated File Changes: 1 (components/offramp/RateRow.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/good-first-issue
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

#C051 [FEAT] [UI] Disconnect dropdown on WalletButton
Description
`useFreighter` returns a `disconnect` function but it is never surfaced in the UI. Users cannot disconnect from within the app.
Requirements

- Connected state shows a chevron on WalletButton. Click → dropdown with: truncated address, "Copy address", "View on Stellar Expert", "Disconnect".
- Dropdown closes on outside click or Escape.
- Keyboard accessible.
  Acceptance Criteria
- Disconnect clears wallet state; Copy writes the full address to clipboard; Stellar Expert opens in new tab.
  Estimated File Changes: 2 (components/ui/WalletButton.tsx, components/ui/WalletDropdown.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

#C052 [FEAT] [UI] Network mismatch prompt — "Switch to Stellar Mainnet"
Description
When a user has Freighter configured for testnet while the app expects mainnet, operations silently fail. A prompt guides them.
Requirements

- Detect `network !== 'MAINNET'` from `useFreighter`.
- Show a dismissible amber banner: "Your Freighter wallet is on {network}. Stellar Intel requires Mainnet. [Open Freighter to switch]".
- CTA opens Freighter extension.
  Acceptance Criteria
- Banner appears on testnet/network mismatch; absent on mainnet; CTA focuses Freighter.
  Estimated File Changes: 2 (components/ui/NetworkMismatchBanner.tsx, hooks/useFreighter.ts)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

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

#C054 [FEAT] [UI] Wallet address display with copy button
Description
The connected address shown in WalletButton is truncated but not copyable without opening the dropdown (#C051).
Requirements

- Address shown as `GABCD...XYZ` format.
- Inline copy button (clipboard icon) copies the full address.
- "Copied!" tooltip for 2 seconds.
  Acceptance Criteria
- Copy writes the full G-address (not truncated) to clipboard.
  Estimated File Changes: 1 (components/ui/WalletButton.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/good-first-issue
  Milestone: v1.3 Off-ramp Polish

---

#C055 [FEAT] [UI] USDC balance display when wallet connected
Description
Users should know their USDC balance before choosing an amount to off-ramp.
Requirements

- When wallet is connected: fetch USDC balance from Horizon (`accounts/{public_key}` → `balances` array).
- Display below the amount input: "Balance: 243.50 USDC".
- "Insufficient balance" validation when amount > balance.
- Refresh balance after a completed transaction.
  Acceptance Criteria
- Balance shown for connected wallet; "Insufficient" validation blocks execution.
  Estimated File Changes: 3 (hooks/useWalletBalance.ts, components/offramp/AmountInput.tsx, lib/stellar/horizon.ts)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

#C056 [FEAT] [UI] "Use max" button next to amount input
Description
Complementary to #C055 (balance display): a "Max" button sets the amount to the full USDC balance.
Requirements

- "Max" button appears next to amount input only when wallet is connected and balance > 0.
- Click sets amount = balance (floored to 2 decimal places).
  Acceptance Criteria
- Max button sets amount to wallet balance; absent when wallet not connected.
  Estimated File Changes: 1 (components/offramp/AmountInput.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/good-first-issue
  Milestone: v1.3 Off-ramp Polish

---

#C057 [FEAT] [UI] Wallet connection persistence across reloads
Description
After a hard reload, the user must reconnect Freighter even though they connected earlier. Freighter's API supports checking connection state on mount.
Requirements

- On mount, call `isConnected()` from `@stellar/freighter-api`. If true, restore the connected public key automatically.
- Show a brief "Reconnecting..." state during the check.
  Acceptance Criteria
- Page reload restores wallet connection within 500ms; no flicker to disconnected state.
  Estimated File Changes: 1 (hooks/useFreighter.ts)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

#C058 [FEAT] [UI] Wallet-not-connected CTA in rate table
Description
When no wallet is connected, the "Execute" button in each rate row shows "Connect Wallet" but there's no incentive to connect before browsing rates.
Requirements

- If wallet not connected: subtle "Connect wallet to execute" nudge below the rate table (not blocking the rates view).
- Clicking the nudge triggers the WalletButton connect flow.
- Nudge disappears on wallet connection.
  Acceptance Criteria
- Nudge visible when disconnected; hidden when connected; clicking triggers connect.
  Estimated File Changes: 2 (components/offramp/WalletNudge.tsx, app/offramp/page.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/good-first-issue
  Milestone: v1.3 Off-ramp Polish

---

#C059 [FEAT] [UI] Transaction history shortcut from WalletButton dropdown
Description
Extend the WalletButton dropdown (#C051) with a link to the user's transaction history.
Requirements

- Add "Transaction history" item to the WalletDropdown.
- Navigates to `/history` (route may be stubbed with a "coming soon" placeholder until Step 6 ships).
  Acceptance Criteria
- Menu item present and navigates to /history.
  Estimated File Changes: 1 (components/ui/WalletDropdown.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/good-first-issue
  Milestone: v1.5 Anchor Fleet

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

## WORKSTREAM I — STATUS TRACKER (`#C061–#C070`)

#C061 [FEAT] [UI] Link to Stellar Expert in StatusTracker
Description
When a transaction ID is available in StatusTracker, users cannot independently verify it on-chain without copying the hash manually.
Requirements

- Transaction hash shown as a clickable link → `https://stellar.expert/explorer/public/tx/{hash}`.
- Opens in new tab with `rel="noopener noreferrer"`.
- Aria-label: "View transaction {hash} on Stellar Expert (opens in new tab)".
  Acceptance Criteria
- Link present when `transactionId` available; opens correct URL in new tab.
  Estimated File Changes: 1 (components/offramp/StatusTracker.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/good-first-issue
  Milestone: v1.3 Off-ramp Polish

---

#C062 [FEAT] [UI] Copy transaction ID button in StatusTracker
Description
Users filing support requests need to copy the transaction ID. Currently there is no copy affordance.
Requirements

- Copy icon next to the transaction ID. Click copies to clipboard.
- "Copied!" tooltip for 2 seconds.
  Acceptance Criteria
- Clipboard contains the full transaction hash; tooltip appears.
  Estimated File Changes: 1 (components/offramp/StatusTracker.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/good-first-issue
  Milestone: v1.3 Off-ramp Polish

---

#C063 [FEAT] [UI] "What happens next" explainer per pending state in StatusTracker
Description
Users don't know what "Pending External" means. Each non-terminal status should have a one-line explainer.
Requirements

- Map each `WithdrawStatusValue` to an explainer: `pending_external` → "Cowrie is processing your bank transfer. This usually takes 5–30 minutes.", `pending_user_transfer_start` → "Waiting for the USDC payment to reach the anchor.", etc.
- Show the explainer below the status badge.
  Acceptance Criteria
- Each status has a unique, accurate explainer; maps to all 13 `WithdrawStatusValue` states.
  Estimated File Changes: 2 (components/offramp/StatusTracker.tsx, lib/stellar/status-messages.ts)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

#C064 [FEAT] [UI] StatusTracker estimated time remaining per state
Description
Complementary to #C063: show how much longer the user should expect to wait.
Requirements

- Per-state time estimates: `pending_external` → "~5–30 min", `completed` → no estimate.
- Estimates come from `lib/stellar/step-estimates.ts` (maintainer-set; not real-time AI).
- Show as "(usually ~X min)" dimmed text next to the status.
  Acceptance Criteria
- All non-terminal states have an estimate; terminal states show nothing.
  Estimated File Changes: 2 (components/offramp/StatusTracker.tsx, lib/stellar/step-estimates.ts)
  Labels: feature, epic/ui, module/ui, difficulty/good-first-issue
  Milestone: v1.3 Off-ramp Polish

---

#C065 [FEAT] [UI] StatusTracker error state — distinguish failure types
Description
The error state in StatusTracker is generic. Users cannot tell if the anchor failed, the payment was rejected, or if there is a network issue.
Requirements

- Map terminal error statuses (`error`, `expired`, `refunded`) to distinct messages.
- `error` → "The anchor reported an error. Your USDC was not settled. Contact {anchor} support with transaction ID {hash}."
- `refunded` → "The anchor refunded your USDC. Check your Stellar wallet."
- `expired` → "The transaction expired before settlement. Your USDC was not sent."
  Acceptance Criteria
- Three distinct messages for three error statuses; never shows "Something went wrong" for classified errors.
  Estimated File Changes: 2 (components/offramp/StatusTracker.tsx, lib/stellar/status-messages.ts)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

#C066 [FEAT] [UI] StatusTracker poll backoff UX — "Still checking..." counter
Description
For slow transactions that poll many times without resolving, the UI looks frozen. A poll counter reassures users the app is still working.
Requirements

- After 5 poll attempts without resolution: show "(checked {N} times, still waiting...)" below the status.
- After 20 attempts (100 seconds): escalate message to "This is taking longer than usual. Anchor may be experiencing delays."
  Acceptance Criteria
- Counter appears at attempt 5; escalation message at attempt 20.
  Estimated File Changes: 1 (components/offramp/StatusTracker.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/good-first-issue
  Milestone: v1.3 Off-ramp Polish

---

#C067 [FEAT] [UI] StatusTracker share button — share transaction link
Description
On completed state, allow users to share proof of their transaction.
Requirements

- "Share" button in the `completed` state.
- Uses Web Share API if available; falls back to copying a shareable URL.
- Shared message: "I just off-ramped {amount} USDC → {currency} via Stellar Intel. View transaction: {stellar.expert link}".
  Acceptance Criteria
- Share API invoked on modern mobile; fallback copy on desktop. URL includes the tx hash.
  Estimated File Changes: 2 (components/offramp/StatusTracker.tsx, hooks/useShare.ts)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

#C068 [FEAT] [UI] StatusTracker "Done" redirect to new transaction CTA
Description
After a completed transaction the user is shown success state but has no obvious next step.
Requirements

- In `completed` state: show "Off-ramp another amount" button that resets the ExecuteDrawer to idle and scrolls back to the rate table.
- Also show "View transaction history" (→ `/history`).
  Acceptance Criteria
- "Off-ramp another" resets drawer to idle and focuses the amount input; history link navigates.
  Estimated File Changes: 1 (components/offramp/StatusTracker.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/good-first-issue
  Milestone: v1.3 Off-ramp Polish

---

#C069 [FEAT] [UI] StatusTracker receipt print/export
Description
Users may need a paper record of their transaction for tax or compliance purposes.
Requirements

- "Download receipt" button in `completed` state.
- Generates a PDF (via `window.print()` with a print-only stylesheet) showing: date, amount, anchor, corridor, rate, fee, transaction hash, Stellar Expert link.
- Print stylesheet hides all non-receipt UI elements.
  Acceptance Criteria
- Print dialog opens with receipt content only; all fields populated.
  Estimated File Changes: 3 (components/offramp/StatusTracker.tsx, components/offramp/TransactionReceipt.tsx, styles/print.css)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.5 Anchor Fleet

---

#C070 [FEAT] [UI] StatusTracker anchor contact info on error
Description
When a transaction errors, users need to know how to contact the anchor. Currently there is no escalation path.
Requirements

- In `error` state: show the anchor's support contact from the registry (email or URL from `constants/anchors.ts`).
- Format: "Contact Cowrie support: support@cowrie.exchange" with a mailto link.
- Populate contact info for all registered anchors in `constants/anchors.ts`.
  Acceptance Criteria
- Error state shows anchor-specific contact; falls back to "Contact the anchor directly" if no contact info.
  Estimated File Changes: 2 (constants/anchors.ts, components/offramp/StatusTracker.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/good-first-issue
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

#C073 [FEAT] [UI] Favicon set for off-ramp route
Description
`#B092` adds favicons to the landing page. The off-ramp route inherits the default Next.js favicon. Ensure the full set is present.
Requirements

- Add to `app/layout.tsx` metadata: `favicon.ico`, `apple-touch-icon.png` (180×180), `favicon-32×32.png`, `favicon-16×16.png`.
- Use the brand mark from the wordmark (MAINTAINER Priority 4 dependency).
  Acceptance Criteria
- Browser tab shows the brand favicon; iOS home screen shows the apple-touch-icon.
  Estimated File Changes: 2 (app/layout.tsx, public/favicons/\*)
  Labels: feature, epic/ui, module/ui, difficulty/good-first-issue
  Milestone: v1.3 Off-ramp Polish

---

#C074 [FEAT] [UI] App-level loading skeleton during initial JS hydration
Description
On slow connections, the page briefly shows unstyled HTML before JS hydrates. A loading skeleton prevents this.
Requirements

- Add a `loading.tsx` in `app/` that renders a skeleton navbar + skeleton rate table.
- Skeleton is identical in layout to the real page to prevent CLS.
  Acceptance Criteria
- Throttled 3G connection shows skeleton then real page with zero layout shift.
  Estimated File Changes: 2 (app/loading.tsx, components/ui/AppSkeleton.tsx)
  Labels: enhancement, epic/ui, module/ui, difficulty/intermediate
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

#C076 [FEAT] [UI] Keyboard shortcut hints
Description
Power users benefit from keyboard shortcuts for common actions.
Requirements

- `K`: opens corridor selector.
- `R`: triggers a rate refresh.
- `Escape`: closes ExecuteDrawer (when safe — see #C023).
- Show shortcut hints as small `<kbd>` labels near their targets (discoverable but not prominent).
- Only active when no modal or input is focused.
  Acceptance Criteria
- All three shortcuts functional; `<kbd>` labels visible in the UI; no conflict with browser shortcuts.
  Estimated File Changes: 3 (hooks/useKeyboardShortcuts.ts, components/offramp/RateTableHeader.tsx, components/offramp/CorridorSelector.tsx)
  Labels: feature, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.5 Anchor Fleet

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

#C078 [FEAT] [UI] Dark mode system preference detection fallback
Description
If `localStorage` is unavailable (private browsing, storage blocked), the dark mode flash prevention script throws a silent error and falls back to light mode.
Requirements

- Wrap the flash prevention script in a try/catch.
- Fallback to `window.matchMedia('(prefers-color-scheme: dark)')` when localStorage unavailable.
  Acceptance Criteria
- Private browsing mode still respects system dark mode preference.
  Estimated File Changes: 1 (app/layout.tsx inline script)
  Labels: enhancement, epic/ui, module/ui, difficulty/good-first-issue
  Milestone: v1.3 Off-ramp Polish

---

#C079 [FEAT] [UI] Sitemap.xml for all routes
Description
No `sitemap.xml` exists. Search engines cannot discover the app's routes efficiently.
Requirements

- `app/sitemap.ts` (Next.js 13+ API) generating entries for: `/`, `/offramp`, `/anchors`, `/anchors/{id}` for each registered anchor.
- `changeFrequency: 'daily'` for `/offramp` and `/anchors`; `'weekly'` for anchor detail pages.
  Acceptance Criteria
- `/sitemap.xml` returns valid XML with all routes; validates on Google Search Console.
  Estimated File Changes: 1 (app/sitemap.ts)
  Labels: feature, epic/ui, module/seo, difficulty/good-first-issue
  Milestone: v1.3 Off-ramp Polish

---

#C080 [FEAT] [UI] robots.txt — explicit crawl rules
Description
No `robots.txt`. Search crawlers may index API routes.
Requirements

- `app/robots.ts` (Next.js API): allow all public routes, disallow `/api/*` and `/_next/*`.
- Include sitemap reference: `Sitemap: https://stellarintel.xyz/sitemap.xml`.
  Acceptance Criteria
- `/robots.txt` returns correct disallow rules; sitemap referenced.
  Estimated File Changes: 1 (app/robots.ts)
  Labels: feature, epic/ui, module/seo, difficulty/good-first-issue
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

#C083 [FEAT] [A11Y] Heading hierarchy audit — single h1 on /offramp
Description
The production analysis does not call out heading structure but WCAG 1.3.1 requires logical heading hierarchy. `/offramp` may have multiple `h1` or skipped heading levels.
Requirements

- Ensure exactly one `<h1>` on `/offramp` ("Off-Ramp" or similar).
- Section headings use `<h2>`; sub-sections `<h3>`.
- No heading levels skipped (e.g. h1 → h3).
  Acceptance Criteria
- axe reports zero heading order violations on `/offramp`.
  Estimated File Changes: 3 (app/offramp/page.tsx, components/offramp/RateTable.tsx, components/offramp/ExecuteDrawer.tsx)
  Labels: accessibility, epic/ui, module/ui, difficulty/good-first-issue
  Milestone: v1.3 Off-ramp Polish

---

#C084 [FEAT] [A11Y] Landmark region audit — main, nav, header presence
Description
Screen reader users navigate by landmark regions. If `<main>`, `<nav>`, `<header>` are absent or duplicated, navigation is broken.
Requirements

- Exactly one `<main>` per page with `id="main-content"` (referenced by skip link #C029).
- Exactly one `<nav>` for the top navigation.
- No duplicate landmarks.
  Acceptance Criteria
- axe reports zero landmark violations on `/offramp` and landing.
  Estimated File Changes: 2 (app/layout.tsx, app/offramp/page.tsx)
  Labels: accessibility, epic/ui, module/ui, difficulty/good-first-issue
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

#C087 [FEAT] [A11Y] Table semantics for rate table — proper <table> markup
Description
If the rate table is rendered as `<div>` rows, screen readers cannot navigate it as a table. Semantic `<table>` markup enables column header association.
Requirements

- Render `RateTable` as a proper `<table>` with `<thead>`, `<tbody>`, `<th scope="col">`, `<td>`.
- `<caption>` for screen readers: "USDC to NGN off-ramp rates — 5 anchors".
- Caption updated when corridor changes.
  Acceptance Criteria
- Screen reader announces "table with 5 rows, 5 columns" and reads column headers per cell.
  Estimated File Changes: 2 (components/offramp/RateTable.tsx, components/offramp/RateRow.tsx)
  Labels: accessibility, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

#C088 [FEAT] [A11Y] Announce corridor change to screen readers
Description
When the user changes the corridor, the rate table updates but screen readers receive no announcement that the context changed.
Requirements

- After a corridor change, announce via `aria-live="assertive"`: "Showing USDC to KES rates. Loading..."
- After rates load: "USDC to KES rates loaded. Best rate: ₦{X} via {anchor}."
  Acceptance Criteria
- VoiceOver/NVDA announces corridor change and rate load completion.
  Estimated File Changes: 2 (hooks/useCorridorAnnouncement.ts, app/offramp/page.tsx)
  Labels: accessibility, epic/ui, module/ui, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

#C089 [FEAT] [A11Y] Dialog role and aria-modal on ExecuteDrawer
Description
The ExecuteDrawer must be properly announced as a dialog to screen readers.
Requirements

- Add `role="dialog"` and `aria-modal="true"` to the ExecuteDrawer container.
- `aria-labelledby` pointing to the drawer title.
- `aria-describedby` pointing to the current step description.
  Acceptance Criteria
- Screen reader announces "dialog, Executing off-ramp" when drawer opens.
  Estimated File Changes: 1 (components/offramp/ExecuteDrawer.tsx)
  Labels: accessibility, epic/ui, module/ui, difficulty/good-first-issue
  Milestone: v1.3 Off-ramp Polish

---

#C090 [FEAT] [A11Y] Error message IDs linked to form fields via aria-describedby
Description
Inline validation errors (amount min/max from #C036) must be programmatically associated with the input they describe.
Requirements

- Validation error message has a stable `id`.
- Input has `aria-describedby="{error-id} {helper-id}"` (multiple IDs allowed).
- `aria-invalid="true"` on the input when error is present.
  Acceptance Criteria
- Screen reader announces validation error when amount input is focused and invalid.
  Estimated File Changes: 1 (components/offramp/AmountInput.tsx)
  Labels: accessibility, epic/ui, module/ui, difficulty/good-first-issue
  Milestone: v1.3 Off-ramp Polish

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

#C092 [FEAT] [PERF] Server-side response cache on /api/rates
Description
Currently `cache: 'no-store'` — every client request hits all anchor APIs. A short server-side cache drastically reduces anchor API load.
Requirements

- 15-second `Cache-Control: max-age=15, stale-while-revalidate=60` on `/api/rates` responses.
- Cache keyed by `corridor + amount` (not per-IP — rates are not user-specific).
- Cache stored in Vercel KV or the Next.js Data Cache.
  Acceptance Criteria
- Two requests for the same corridor within 15s share a cache hit; anchor APIs called once per 15s window per corridor.
  Estimated File Changes: 2 (app/api/rates/route.ts, lib/stellar/server-rates.ts)
  Labels: feature, epic/perf, module/api, difficulty/intermediate
  Milestone: v1.3 Off-ramp Polish

---

#C093 [FEAT] [PERF] Lazy-load ExecuteDrawer — code split into async chunk
Description
`ExecuteDrawer` includes SEP-10/24 logic and is large. It is never needed until the user clicks Execute. Lazy-loading reduces the initial bundle.
Requirements

- `const ExecuteDrawer = dynamic(() => import('components/offramp/ExecuteDrawer'), { ssr: false })`.
- Loading state: `null` (drawer is not visible until invoked anyway).
- Bundle size for `/offramp` first-load JS must decrease by ≥ 20KB gzipped.
  Acceptance Criteria
- `/offramp` first-load JS < 180KB gzipped; ExecuteDrawer chunk loads on first click.
  Estimated File Changes: 1 (app/offramp/page.tsx)
  Labels: enhancement, epic/perf, module/perf, difficulty/good-first-issue
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

#C099 [FEAT] [SEO] Structured data (JSON-LD) on landing page
Description
Adding JSON-LD FinancialProduct schema helps search engines understand what Stellar Intel is and can improve rich result eligibility.
Requirements

- Add `<script type="application/ld+json">` to the landing page `<head>`.
- Schema type: `FinancialProduct` with: name, description, url, applicationCategory.
- Validate via Google Rich Results Test.
  Acceptance Criteria
- Google Rich Results Test reports no errors for the structured data on the landing page.
  Estimated File Changes: 1 (app/page.tsx)
  Labels: feature, epic/ui, module/seo, difficulty/good-first-issue
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
