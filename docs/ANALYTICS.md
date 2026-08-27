# Stellar Intel — Analytics & Funnel Dashboard

> Privacy-respecting product analytics for the off-ramp funnel. This document
> defines the event taxonomy, funnel configuration, dashboard setup, and
> cost-conscious access model for the team.

**Last reviewed:** 2026-08-26

**Status:** Implemented (Plausible integration + funnel events) · Milestone v1.3

---

## Table of contents

- [Design principles](#design-principles)
- [Funnel events](#funnel-events)
- [Funnel definition](#funnel-definition)
- [Dashboard setup](#dashboard-setup)
- [Team access model](#team-access-model)
- [Conversion rate calculations](#conversion-rate-calculations)
- [Staging vs production data](#staging-vs-production-data)
- [Related](#related)

---

## Design principles

1. **No PII.** Event properties never include wallet addresses, recipient
   details, or exact amounts. `redactProperties()` in `lib/analytics.ts` scans
   every payload before it leaves the browser: registered PII keys become
   `[REDACTED]`, Stellar public keys become `[REDACTED_WALLET]`, and
   email-shaped values become `[REDACTED_EMAIL]`. Amounts are reduced to a
   coarse bucket (`amountBucket()`) rather than sent raw. Corridor and anchor
   **are** sent — they are not user-identifying and the funnel is useless
   without them.
2. **No cookies.** Plausible uses a cookie-free script; no consent banner
   required.
3. **Aggregate only.** Funnel steps are counted, not profiled. We know _how
   many_ users dropped off at each step, not _which_ users.
4. **Cost-conscious.** One shared Plausible account covers the team; no
   per-seat analytics cost. Self-hosted option documented as alternative.

---

## Funnel events

Six events track the off-ramp user journey from corridor selection to
transaction completion (or failure). Events fire client-side via
`trackFunnelEvent()` in `lib/analytics.ts`; names are defined once in the
`FUNNEL_EVENTS` constant so call sites cannot drift from this table.

| #   | Event name              | Fires when                                      | Properties (aggregate, no PII)                       |
| --- | ----------------------- | ----------------------------------------------- | ---------------------------------------------------- |
| 1   | `corridor_selected`     | User picks a different corridor in the selector | `corridor`, `amount_bucket`                          |
| 2   | `rate_table_viewed`     | Rate table first shows results for a corridor   | `corridor`                                           |
| 3   | `execute_drawer_opened` | Execute drawer opens for an anchor              | `corridor`, `anchor`, `amount_bucket`                |
| 4   | `execution_confirmed`   | User confirms and execution begins              | `corridor`, `anchor`, `amount_bucket`                |
| 5   | `execution_completed`   | Payment submits successfully                    | `corridor`, `anchor`, `amount_bucket`                |
| 6   | `execution_failed`      | Execution errors out                            | `corridor`, `anchor`, `amount_bucket`, `error_class` |

`execution_failed` is not a funnel step — it is the drop-off explanation for
step 4 → step 5. `error_class` is a fixed vocabulary (`network_mismatch`,
`execute_error`), never free text.

### Event implementation

```ts
// lib/analytics.ts (shipped)
export const FUNNEL_EVENTS = {
  rateTableViewed: 'rate_table_viewed',
  corridorSelected: 'corridor_selected',
  executeDrawerOpened: 'execute_drawer_opened',
  executionConfirmed: 'execution_confirmed',
  executionCompleted: 'execution_completed',
  executionFailed: 'execution_failed',
} as const;

/** Coarse bucket so analytics never sees an exact figure. */
export function amountBucket(amount: string | number | null | undefined): string;

/** Redacts PII, drops non-scalar props, then calls window.plausible. */
export function trackFunnelEvent(eventName: FunnelEventName, props?: FunnelEventProps): void;
```

`trackFunnelEvent` no-ops when `window.plausible` is absent — which is the case
in dev and test whenever `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` is unset, because
`app/layout.tsx` only injects the Plausible script when that variable is
present. There is no separate `NODE_ENV` guard and no debug flag; leaving the
domain unset is the off switch.

Amount buckets: `0-10`, `10-50`, `50-100`, `100-500`, `500-1000`, `1000+`, and
`unknown` for a missing or non-finite amount.

### Where events fire

| Event                   | Component / Hook                       | Trigger point                                           |
| ----------------------- | -------------------------------------- | ------------------------------------------------------- |
| `corridor_selected`     | `app/offramp/page.tsx`                 | `handleCorridorChange`, only when the corridor changes  |
| `rate_table_viewed`     | `components/offramp/RateTable.tsx`     | `useEffect` on first results per corridor (ref-guarded) |
| `execute_drawer_opened` | `components/offramp/ExecuteDrawer.tsx` | `useEffect` on open, once per anchor + amount           |
| `execution_confirmed`   | `components/offramp/ExecuteDrawer.tsx` | Start of the execute handler                            |
| `execution_completed`   | `components/offramp/ExecuteDrawer.tsx` | After the payment submits and step flips to `done`      |
| `execution_failed`      | `components/offramp/ExecuteDrawer.tsx` | Both error branches of the execute handler              |

---

## Funnel definition

The five events form a sequential funnel:

```
corridor_selected → rate_table_viewed → execute_drawer_opened → execution_confirmed → execution_completed
```

**Step 1 → Step 2:** User selects a corridor and sees rates.
**Step 2 → Step 3:** User chooses an anchor and opens the execute drawer.
**Step 3 → Step 4:** User confirms; SEP-10 auth and SEP-24 withdraw begin.
**Step 4 → Step 5:** User signs in Freighter and the payment submits.

`execution_failed` sits alongside step 5, splitting step-4 traffic into
completed vs failed. Segment it by `error_class` to separate technical failures
from abandonment.

### Expected conversion benchmarks

These are **planning estimates, not measured data.** Replace them with real
figures once the funnel has accumulated traffic.

| Step                                            | Expected range | Notes                                   |
| ----------------------------------------------- | -------------- | --------------------------------------- |
| `corridor_selected` → `rate_table_viewed`       | 70–90%         | Low friction; most users see rates      |
| `rate_table_viewed` → `execute_drawer_opened`   | 30–50%         | Decision point; users compare rates     |
| `execute_drawer_opened` → `execution_confirmed` | 50–70%         | Friction from Freighter install/connect |
| `execution_confirmed` → `execution_completed`   | 60–80%         | Technical failures + user abandon       |
| **Overall funnel**                              | **8–25%**      | End-to-end conversion                   |

---

## Dashboard setup

### Option A: Plausible Cloud (recommended)

1. Create a Plausible account at [plausible.io](https://plausible.io).
2. Add your domain (e.g. `stellarintel.app`).
3. Set `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` to that domain in the deployment
   environment. Leave it unset locally — that is what keeps dev traffic out of
   the production property.
4. Go to **Site settings → Goals** and add six custom events:
   - `corridor_selected`
   - `rate_table_viewed`
   - `execute_drawer_opened`
   - `execution_confirmed`
   - `execution_completed`
   - `execution_failed`
5. Go to **Funnel** and create a new funnel with the first five events in
   order. `execution_failed` stays a standalone goal, not a funnel step.
6. Set the time window to 30 days (adjust as needed).
7. In **Custom properties**, enable `corridor`, `anchor`, `amount_bucket` and
   `error_class` so the funnel can be segmented.

### Option B: Plausible Self-Hosted

For zero-cost, self-host Plausible CE:

```bash
git clone https://github.com/plausible/analytics.git
cd analytics
docker compose up -d
```

Configure via `plausible-conf.env`:

```
BASE_URL=https://analytics.yourdomain.com
SECRET_KEY_BASE=<generate>
TOTP_VAULT_KEY=<generate>
```

Point your Plausible script tag to your self-hosted instance:

```html
<script
  defer
  data-domain="yourdomain.com"
  src="https://analytics.yourdomain.com/js/script.js"
></script>
```

### Option C: Lightweight internal page (no third-party)

If analytics-provider seats are a concern, build a lightweight internal
dashboard using the existing `/api/metrics` endpoint as a pattern:

1. **Create `/api/funnel/route.ts`** — accept event POSTs, store in memory
   or SQLite (same pattern as `lib/reputation/`).
2. **Create `app/admin/funnel/page.tsx`** — read-only admin page showing
   funnel counts and conversion rates.
3. **Gate access** with `ADMIN_SECRET_KEY` (existing env var).

This approach keeps all data internal and requires zero external services.

---

## Team access model

### Plausible Cloud

- **One shared account** — all team members use the same login.
- **No per-seat cost** — Plausible Cloud pricing is per-pageview, not per-user.
- **Shared dashboard link** — bookmark the funnel view and share in Slack/README.

### Self-hosted Plausible

- **Unlimited users** — self-hosted Plausible CE has no user limit.
- **SSO optional** — integrate with your identity provider if needed.

### Internal dashboard

- **Admin-gated** — requires `ADMIN_SECRET_KEY` to access.
- **No external dependency** — all data stays in your infrastructure.
- **Read-only** — the funnel page is view-only; no mutation.

---

## Conversion rate calculations

Funnel conversion rate between steps:

```
conversion_rate(step_n → step_n+1) = count(step_n+1) / count(step_n) × 100
```

Overall funnel conversion:

```
overall_conversion = count(execution_completed) / count(corridor_selected) × 100
```

### Plausible funnel view

Plausible's built-in funnel visualization shows:

- **Drop-off percentage** between each step
- **Conversion percentage** for each step
- **Time-to-convert** (optional, if timing events are added)

### Internal dashboard formula

```ts
// app/admin/funnel/page.tsx (pseudocode)
const steps = [
  'corridor_selected',
  'rate_table_viewed',
  'execute_drawer_opened',
  'execution_confirmed',
  'execution_completed',
];

const counts = await getEventCounts(steps); // from your event store

const funnel = steps.map((step, i) => ({
  step,
  count: counts[i],
  conversionFromPrevious: i === 0 ? 100 : (counts[i] / counts[i - 1]) * 100,
  dropOff: i === 0 ? 0 : counts[i - 1] - counts[i],
}));
```

---

## Staging vs production data

Environment separation is driven entirely by `NEXT_PUBLIC_PLAUSIBLE_DOMAIN`.
`app/layout.tsx` injects the Plausible script only when that variable is set,
and `trackFunnelEvent` no-ops when `window.plausible` is absent. There is no
in-code environment check to keep in sync.

### Staging

- Point `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` at a **separate** Plausible property (or
  a separate self-hosted instance) so staging traffic never contaminates the
  production funnel.

### Production

- Set `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` to the production domain.

### Development and test

- Leave `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` unset. No script loads and no events
  fire. This is why `.env.example` ships the variable commented out.

### Testing funnel events locally

There is no debug flag. To watch events without sending them anywhere, stub the
provider from the browser console before exercising the flow:

```js
window.plausible = (name, opts) => console.log('[funnel]', name, opts?.props);
```

For assertions rather than eyeballing, `tests/analytics.spec.ts` already covers
every event name, the redaction rules, and the bucketing:

```bash
npm run test -- analytics
```

---

## Related

- [`issues-ui.md` #C096](../issues-ui.md) — Plausible integration issue
- [`issues-ui.md` #C097](../issues-ui.md) — Funnel event tracking issue
- [`issues-ui.md` #C098](../issues-ui.md) — Error event tracking issue
- [`lib/metrics.ts`](../lib/metrics.ts) — Server-side operational metrics
- [`docs/ROADMAP.md`](ROADMAP.md) — v1.3 observability wave
