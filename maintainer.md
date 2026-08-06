# Maintainer Notes

## Program — Security · Production readiness · S-tier (opened 2026-08-06)

Supersedes the 2026-07-23 uplift TODO (mainnet-deploy item deferred; the SDK / MCP /
oracle-read / publisher-wiring items shipped to `main` and are now tracked in the two
roadmaps). Deadline anchor for band-protecting work = **next wave entry ≈ W8, ~2026-08-20**.

Backing findings (verified 2026-08-05/06 — Drips + security + production-readiness pass):

- **Live prod:** core endpoints 200 (`/api/v1/health`, `/api/metrics`, `/api/snapshot`,
  `/api/reputation/leaderboard`); **500s** on `/api/reputation/actuarial`, `/probe-coverage`,
  and the whole `/api/graphql` surface; the reputation record renders **empty (`n:0`)** —
  the durable Postgres store is unconfigured in prod and `lib/reputation/pool.ts` throws
  `ReputationStoreUnavailableError`.
- **npm `@stellarintel/sdk` = 404** while `README.md` shows a version badge; the package
  exists as the `packages/sdk` workspace, never published.
- **Contract** deployed testnet only (`CCZ54NTEOVL2DKWCGJA5XHTHOGRDS7JHFKYWEC6QH2IMZLYNM3FBFKDG`),
  near-zero invocations, `events:0`; app oracle reads return `onChain:null` in prod.
- **Local `vitest`:** 31 failed / 3246 passed (19 files) — mostly a concurrent worktree under
  `.claude/worktrees/issues-batch-c/` being picked up, plus 3 palette-drift snapshots.

### Phase 0 — Protect the A band (before W8 entry) [PROD]

- [ ] Configure `DATABASE_URL` in Vercel prod so the probe loop persists and the record stops
      rendering `n:0` (`lib/reputation/pool.ts`). **[maintainer — dashboard]**
- [ ] Make the three 500ing routes degrade instead of throwing:
      `app/api/reputation/actuarial/route.ts`, `.../probe-coverage/route.ts`, and the GraphQL
      resolvers — swap `getReputationStore()` for the `tryGetReputationStore()` pattern already
      used in `app/api/reputation/leaderboard/route.ts`. **[code]**
- [ ] Publish `@stellarintel/sdk` (workspace exists) **or** drop the npm badge in `README.md`.
      Badge fix is code; publish is maintainer. **[code (badge) / maintainer (publish)]**
- [ ] Refresh snapshots (`vitest -u`) and rerun the suite scoped to `main` (exclude
      `.claude/worktrees/`); confirm the 31 failures are worktree/palette noise. **[code]**

### Phase 1 — CRITICAL security (before any mainnet / real money) [SEC]

- [ ] Contract `init`/`init_upgrade` are unauthenticated and front-runnable
      (`contracts/reputation/src/lib.rs:35,129` → `admin.rs:29`, `upgrade.rs:44`): first caller
      wins and can seize the WASM-replacement authority. Migrate to `#[contractconstructor]` so
      deploy + admin + upgrade-admin bind atomically; re-audit after. **[code]**
- [ ] SEP-6 SSRF (`app/api/sep6/withdraw/route.ts`): `transferServer` is validated only by
      `^https://`, fetched server-side, and the body is reflected — GET variant is unratelimited.
      Allowlist the host against the anchor registry in `constants/` before fetch; add
      `enforceRateLimit` to the GET. **[code]**
- [ ] Rotate `CRON_SECRET` (read aloud this session). **[maintainer — Vercel env]**

### Phase 2 — HIGH security [SEC]

- [ ] Unauth reputation ledger append (`app/api/reputation/append/route.ts`): anyone can POST
      forged outcome rows that feed anchor scores → on-chain publish. Require an Ed25519 sig over
      `intentHash` (reuse the dispute route's verify). **[code]**
- [ ] Intent signature + replay is documented (`docs/INTENT_API.md`) but never wired —
      `lib/intent/replay.ts::registerIntentReplay` is referenced only in tests, and no intent
      route verifies a signature. Wire `registerIntentReplay` + `Keypair.verify` into
      `/api/intent*`, or correct the docs. **[code]**
- [ ] Cron auth fail-open (`publisher/tick:118`, `reconcile:46`, `refresh:65`): `Bearer ${undefined}`
      authenticates when the secret is unset, and the compare is not timing-safe. Fail closed +
      `timingSafeEqual`. **[code]**
- [ ] GraphQL unbounded (`app/api/graphql/route.ts`, `lib/graphql/*`): no depth/complexity limit,
      introspection on in prod, unauth mutation on the shared bucket. Add depth + complexity
      limits, disable introspection in prod, auth + cost-weight the mutation. **[code, adds dep]**
- [ ] Contract has no TTL management anywhere (`contracts/reputation/src/storage.rs` + all write
      sites): instance + persistent entries will archive → guaranteed oracle outage. Add
      `extend_ttl` on every mutating entrypoint + persistent read; add a public `bump()`. **[code]**
- [ ] Contract DoS accumulators (`aggregate.rs:20` `settle_sum`, `volume_savings.rs:65`): one
      rogue publisher submitting `u64::MAX`/`i128::MAX` traps that corridor forever under
      `overflow-checks=true`. Use `checked_add` + upper bounds + an admin reset. **[code]**
- [ ] v2 score freeze after migration (`lib.rs:288`, `score.rs:73`, `migration.rs`):
      `set_corridor_metrics` writes only the v1 key, so v2 readers silently serve stale scores.
      Write both keys (or read v1 through). **[code]**

### Phase 3 — MED security + hardening [SEC][PROD]

- [ ] Rate limiter keys on the spoofable first `x-forwarded-for` hop (`lib/api/rate-limit.ts`) and
      silently degrades to per-instance without a shared backend (`lib/api/shared-state.ts`). Use
      the Vercel-trusted IP; fail closed (or alarm) in prod when there is no shared backend. **[code]**
- [ ] Contract: clamp the composite output (`score.rs:37` can mint 30× scores), enforce rate
      staleness / monotonic timestamp / per-corridor publisher scoping (`corridor_rate.rs`), and
      **emit events** on every state transition (takeover is invisible today); add an upgrade
      timelock. **[code]**
- [ ] Web: validate + rate-limit the admin POST (`app/api/admin/disputes/route.ts`), constrain
      metrics `anchorId` to registry IDs (`app/api/metrics/route.ts`), and persist disputes to
      Postgres (in-memory Maps today, lost on cold start and not shared across instances). **[code]**
- [ ] Add the missing tests the audit flagged: `volume_savings` (zero tests today),
      `init`/`init_upgrade` auth-rejection (`env.set_auths(&[])`), arithmetic boundaries,
      set-after-migrate v2 read; delete the dead `contracts/reputation/src/error.rs`. **[code]**

### Phase 4 — Production-readiness sign-off [PROD]

- [ ] End-to-end offramp smoke test against a live anchor — the execution path depends on SEP-38
      firm quotes the README admits are scarce; verify it works or degrades honestly.
      **[code + maintainer]**
- [ ] Re-probe every endpoint post-fix: all public routes return 200 or a clean 4xx, none 500. **[code]**
- [ ] Monitoring / alerting on the probe loop + cron jobs (they silently no-op today when the
      store is unconfigured). **[maintainer]**

### Phase 5 — S-tier ($500) path — multi-wave [S]

- [ ] Mainnet contract deploy (only after Phase 1–2 fixes + re-audit): committed mainnet contract
      ID + real invocations. **[maintainer — irreversible]**
- [ ] Wire the live app to actually read/write the oracle (`onChain:null` in prod today). **[code]**
- [ ] Make the published SDK a real external dependency against the mainnet oracle.
      **[code + maintainer]**
- [ ] Deepen toward runtime-level integration / multiple mainnet contracts with cross-calls. **[code]**

**Timing.** The security fixes are the critical path *for* the mainnet deploy that S-tier needs —
same path, not competing. W8 = clean A; W9 = mainnet + depth shipped pre-entry; W10 = S
materializes (band changes lag capability by ≥1 wave).

### Reversible-change map — what a code session can apply now vs maintainer-only

**Reversible code changes (git-revertible, no external side-effects) — safe to apply now:**

- _Production 500s / Drips band protection:_ graceful-degrade on `actuarial`, `probe-coverage`,
  and the GraphQL resolvers; README npm-badge fix; `vitest -u` snapshot refresh + `main`-scoped
  rerun.
- _Web security:_ SEP-6 SSRF allowlist + GET rate-limit; Ed25519 auth on `reputation/append`;
  intent signature + replay wiring (or doc correction); cron fail-closed + `timingSafeEqual`;
  GraphQL depth/complexity/introspection; trusted-IP rate limiter; admin-POST validation; metrics
  `anchorId` constraint; disputes → Postgres.
- _Contract security:_ `#[contractconstructor]` for init; `extend_ttl` + `bump()`; `checked_add`
  + bounds + admin reset; v2 dual-key write; composite clamp; rate staleness / monotonic / scoping;
  event emission; upgrade timelock; new tests; delete dead `error.rs`. **Apply + test locally only
  — do NOT deploy; contract edits ship behind the re-audit gate.**
- _Drips depth:_ wire app oracle reads (`onChain`); SDK example against the real contract.

**Maintainer-only / irreversible (do NOT do without an explicit go):**

- Rotate `CRON_SECRET`; configure `DATABASE_URL` and monitoring in Vercel — dashboard/secrets.
- `npm publish @stellarintel/sdk` / `@stellarintel/mcp`; crates.io / PyPI publishes — login/2FA,
  hard to unpublish.
- **Mainnet contract deploy** — irreversible, funded key, must follow the re-audit.
- Commissioning the external re-audit.

## 11. Anchor Fleet Status

- [x] Monthly recheck complete for the latest survey snapshot.

Latest documented snapshot: 92 directory-tagged domains -> 32 reachable
`stellar.toml` files -> 9 transfer-capable / 23 issuer-only; 60 unreachable or
unconfirmed.

The 23 issuer-only domains (advertise an asset/issuer but no SEP-6/SEP-24
transfer rails, so they back no corridor) are enumerated with reasons in
[`docs/anchors/exclusions.md`](docs/anchors/exclusions.md).

Source: `scripts/anchor-survey.snapshot.json`, generated
2026-06-25T23:08:26.806Z from
`https://api.stellar.expert/explorer/public/directory?tag[]=anchor&limit=200`.

Refresh cadence: re-run `node scripts/anchor-survey.mjs --json` monthly, update
these counts, and keep the recheck checkbox aligned with the current snapshot.
