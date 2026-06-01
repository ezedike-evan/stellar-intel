# Stellar Intel — OSS Week Contributor Board

> Pin this issue for the duration of OSS Week. Thirty scoped, unblocked,
> reviewer-ready tickets — safe to pick up as a first PR. Each row links to
> a numbered ticket in [`issue.md`](../issue.md) where the full acceptance
> criteria live.

**How to pick one up**

1. Comment on the linked issue with "I'll take this" so nobody duplicates work.
2. Fork, branch off `main`, and follow the checklist in [`CONTRIBUTING.md`](../CONTRIBUTING.md).
3. Open a draft PR early — happy to review in progress.
4. Stuck? Post in [Discussions → OSS Week](https://github.com/Ezedike-Evan/stellar-intel/discussions).
   Office hours are 15:00 UTC Mon/Wed/Fri during the event.

**Every contributor merged during OSS week is named in the grant resubmission
document.** That is not a rhetorical line — it is the explicit commitment.

---

## 🟢 Start here (self-contained, < 2 hours)

| #   | Ticket         | What you ship                                                      | Files touched               |
| --- | -------------- | ------------------------------------------------------------------ | --------------------------- |
| 1   | `issue.md#015` | Skeleton loader on the rate table while SWR loads                  | `components/rate-table/*`   |
| 2   | `issue.md#022` | Error boundary + retry for a failed anchor TOML fetch              | `lib/sep1/*`, `components/` |
| 3   | `issue.md#031` | `formatCurrency` helper + unit tests                               | `lib/format/*`              |
| 4   | `issue.md#037` | `.env.example` audit + README env-var section parity               | `.env.example`, `README.md` |
| 5   | `issue.md#044` | Keyboard focus ring on all interactive rate rows                   | `components/rate-table/*`   |
| 6   | `issue.md#051` | Favicon set (16/32/180/192/512) — drop assets into `public/brand/` | `public/brand/`             |
| 7   | `issue.md#056` | Empty-state copy + illustration for zero-rates case                | `components/empty-state/*`  |
| 8   | `issue.md#063` | Lint rule sweep: convert remaining `no-explicit-any` sites         | `lib/*`, `hooks/*`          |
| 9   | `issue.md#068` | README "Troubleshooting" section — top five setup gotchas          | `README.md`                 |
| 10  | `issue.md#072` | Basic i18n scaffolding: extract hard-coded strings from header     | `components/header/*`       |

## 🟡 Next rung (~1 day, single module)

| #   | Ticket         | What you ship                                                  | Files touched             |
| --- | -------------- | -------------------------------------------------------------- | ------------------------- |
| 11  | `issue.md#078` | Replay-protection nonce for signed intents                     | `lib/intent/*`            |
| 12  | `issue.md#082` | SEP-38 quote fetcher with timeout + retry backoff              | `lib/sep38/*`             |
| 13  | `issue.md#089` | Anchor failure-rate counter → writes to the scoring store      | `lib/reputation/*`        |
| 14  | `issue.md#094` | `/api/health` endpoint with anchor-status rollup               | `app/api/health/*`        |
| 15  | `issue.md#101` | Address-book for NGN bank codes (validation + autocomplete)    | `constants/bank-codes.ts` |
| 16  | `issue.md#108` | Status tracker page: poll SEP-24 `/transaction` until terminal | `app/status/*`            |
| 17  | `issue.md#112` | Split-routing mock solver (deterministic, test-backed)         | `lib/router/*`            |
| 18  | `issue.md#119` | Sentry reporter scaffold — no secrets yet, pluggable           | `lib/telemetry/*`         |
| 19  | `issue.md#126` | Rate-table column sort by net landed value                     | `components/rate-table/*` |
| 20  | `issue.md#134` | Persist last-used corridor in `localStorage`                   | `hooks/use-corridor.ts`   |

## 🔵 Bigger bites (multi-module, pair with a reviewer first)

| #   | Ticket         | What you ship                                                  | Files touched                        |
| --- | -------------- | -------------------------------------------------------------- | ------------------------------------ |
| 21  | `issue.md#146` | Canonical intent hashing — deterministic JSON + Ed25519 verify | `lib/intent/*` + tests               |
| 22  | `issue.md#153` | Public read API: `GET /v1/public/scores` with cache + schema   | `app/api/v1/*`, `docs/INTENT_API.md` |
| 23  | `issue.md#161` | MCP tool: `stellar_intel.price_offramp`                        | `packages/mcp/*`                     |
| 24  | `issue.md#168` | Composite score formula + test vectors for three anchors       | `lib/reputation/*`                   |
| 25  | `issue.md#174` | Soroban contract skeleton: `write_observation`, `read_score`   | `contracts/oracle/*`                 |
| 26  | `issue.md#182` | Anchor scorecard page (public, per-anchor)                     | `app/anchors/[id]/*`                 |
| 27  | `issue.md#189` | SEP-10 auth: challenge tx, sign, submit, token cache           | `lib/sep10/*`                        |
| 28  | `issue.md#196` | Leaderboard page — top-5 anchors by net landed value, 30d      | `app/leaderboard/*`                  |
| 29  | `issue.md#203` | Playwright smoke test for the full off-ramp happy path         | `tests/e2e/*`                        |
| 30  | `issue.md#208` | Grafana dashboard JSON committed + linked from README          | `docs/observability/*`               |

---

## Not on the list?

- Filter issues by [`good-first-issue`](https://github.com/Ezedike-Evan/stellar-intel/labels/good-first-issue).
- Want to own a multi-issue mini-epic? Ask in Discussions and we'll tag you as `owner`.
- Have an idea that isn't tracked? Open one with the `feature` template.
