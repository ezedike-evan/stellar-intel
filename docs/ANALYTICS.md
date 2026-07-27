# Stellar Intel — Analytics & Funnel Dashboard

> Privacy-respecting product analytics for the off-ramp funnel. This document
> defines the event taxonomy, funnel configuration, dashboard setup, and
> cost-conscious access model for the team.

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

1. **No PII.** Event names and properties never include wallet addresses,
   amounts, corridor identifiers, or any data that could identify a user.
2. **No cookies.** Plausible uses a cookie-free script; no consent banner
   required.
3. **Aggregate only.** Funnel steps are counted, not profiled. We know _how
   many_ users dropped off at each step, not _which_ users.
4. **Cost-conscious.** One shared Plausible account covers the team; no
   per-seat analytics cost. Self-hosted option documented as alternative.

---

## Funnel events

Five events track the off-ramp user journey from corridor selection to
transaction completion. Events fire client-side via `hooks/useAnalytics.ts`.

| #  | Event name              | Fires when                                     | Properties (aggregate, no PII)           |
|----|-------------------------|------------------------------------------------|------------------------------------------|
| 1  | `corridor-selected`     | User picks a corridor from the selector        | —                                        |
| 2  | `rate-row-viewed`       | Rate table renders ≥1 anchor rate row           | —                                        |
| 3  | `execute-drawer-opened` | User clicks "Execute" on a rate row             | —                                        |
| 4  | `wallet-connected`      | Freighter wallet connects successfully          | —                                        |
| 5  | `transaction-completed` | SEP-24 transaction reaches `completed` state    | —                                        |

### Event implementation

```ts
// hooks/useAnalytics.ts
import { useCallback } from 'react';

type FunnelEvent =
  | 'corridor-selected'
  | 'rate-row-viewed'
  | 'execute-drawer-opened'
  | 'wallet-connected'
  | 'transaction-completed';

export function useAnalytics() {
  const track = useCallback((event: FunnelEvent) => {
    if (typeof window === 'undefined') return;
    if (process.env.NODE_ENV !== 'production') return;

    window.plausible?.(event);
  }, []);

  return { track };
}
```

### Where events fire

| Event                   | Component / Hook                          | Trigger point                                  |
|-------------------------|-------------------------------------------|------------------------------------------------|
| `corridor-selected`     | `components/offramp/CountrySelector.tsx`  | `onChange` handler after corridor state update  |
| `rate-row-viewed`       | `components/offramp/RateTable.tsx`        | `useEffect` after rates load (once per load)   |
| `execute-drawer-opened` | `components/offramp/ExecuteDrawer.tsx`    | `onOpen` callback                              |
| `wallet-connected`      | `hooks/useFreighter.ts`                   | After `isConnected` flips to `true`            |
| `transaction-completed` | `components/offramp/StatusTracker.tsx`    | When `status` transitions to `completed`        |

---

## Funnel definition

The five events form a sequential funnel:

```
corridor-selected → rate-row-viewed → execute-drawer-opened → wallet-connected → transaction-completed
```

**Step 1 → Step 2:** User selects a corridor and sees rates.
**Step 2 → Step 3:** User chooses a rate and opens the execute drawer.
**Step 3 → Step 4:** User connects their wallet to authenticate.
**Step 4 → Step 5:** User signs and completes the transaction.

### Expected conversion benchmarks

| Step                          | Expected range | Notes                                         |
|-------------------------------|----------------|-----------------------------------------------|
| corridor-selected → rate-row  | 70–90%         | Low friction; most users see rates             |
| rate-row → execute-drawer     | 30–50%         | Decision point; users compare rates            |
| execute-drawer → wallet       | 50–70%         | Friction from Freighter install/connect        |
| wallet → transaction-completed| 60–80%         | Technical failures + user abandon              |
| **Overall funnel**            | **8–25%**      | End-to-end conversion                         |

---

## Dashboard setup

### Option A: Plausible Cloud (recommended)

1. Create a Plausible account at [plausible.io](https://plausible.io).
2. Add your domain (e.g. `stellarintel.app`).
3. Go to **Site settings → Goals** and add five custom events:
   - `corridor-selected`
   - `rate-row-viewed`
   - `execute-drawer-opened`
   - `wallet-connected`
   - `transaction-completed`
4. Go to **Funnel** and create a new funnel with the five events in order.
5. Set the time window to 30 days (adjust as needed).

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
<script defer data-domain="yourdomain.com" src="https://analytics.yourdomain.com/js/script.js"></script>
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
overall_conversion = count(transaction-completed) / count(corridor-selected) × 100
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
  'corridor-selected',
  'rate-row-viewed',
  'execute-drawer-opened',
  'wallet-connected',
  'transaction-completed',
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

### Staging

- Fire events in `staging` environment with a `staging` property (aggregate
  only, no PII) to distinguish from production.
- Use Plausible's **Custom properties** or a separate staging Plausible
  instance.

### Production

- Events fire only when `NODE_ENV=production` (see `useAnalytics.ts` guard).
- No events fire in development or test environments.

### Testing funnel events locally

```bash
# Enable event logging in dev (console only)
NEXT_PUBLIC_ANALYTICS_DEBUG=true npm run dev
```

When `ANALYTICS_DEBUG` is set, `useAnalytics.ts` logs events to console
instead of calling `window.plausible`.

---

## Related

- [`issues-ui.md` #C096](../issues-ui.md) — Plausible integration issue
- [`issues-ui.md` #C097](../issues-ui.md) — Funnel event tracking issue
- [`issues-ui.md` #C098](../issues-ui.md) — Error event tracking issue
- [`lib/metrics.ts`](../lib/metrics.ts) — Server-side operational metrics
- [`docs/ROADMAP.md`](ROADMAP.md) — v1.3 observability wave
