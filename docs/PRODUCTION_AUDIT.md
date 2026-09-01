# Production Audit

**Last reviewed:** 2026-08-28

A claim-by-claim audit of what this repository actually enforces, what it only
documents, and what is not true yet. It follows the method
[`POSITIONING.md`](POSITIONING.md) sets out — _a positioning document that cannot
be falsified is marketing_ — so every row names where the evidence lives and
what command reproduces it.

**Open findings are linked, not restated.** Every gap below points at the issue
that tracks it, and the [findings index](#findings-index) collects them in one
place. A finding with no issue is a finding nobody owns, so it does not appear
here without one.

## How to read the status column

| Status                    | Meaning                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------- |
| **Enforced in CI**        | A merge to `main` fails if this stops being true. The check is named in the row.        |
| **Enforced in code**      | The invariant is a refusal in a code path, but nothing in CI would catch its removal.   |
| **Documented, not gated** | Written down and believed to be true; no automated check holds it.                      |
| **Not true yet**          | Stated here because it has been claimed somewhere, or is assumed. It is not true today. |

The third and fourth categories are the point of this document. An audit that
lists only the green rows is a marketing page with a table in it.

## Findings index

Every open finding, in the section it belongs to, with the issue that owns it.
This table is the audit's contract: if a row here has no issue number, the
finding is untracked and that is itself the bug.

| §   | Finding                                                                      | Tracked in                                                         |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| §1  | The custody boundary has no CI guard                                         | [#1147](https://github.com/ezedike-evan/stellar-intel/issues/1147) |
| §6  | Deployed testnet contract predates `main`; no upgrade path; zero anchors     | [#1149](https://github.com/ezedike-evan/stellar-intel/issues/1149) |
| §6  | Probe-derived signals are not published on chain                             | [#785](https://github.com/ezedike-evan/stellar-intel/issues/785)   |
| §7  | `VERSIONING.md` promises a deprecation lifecycle the code does not implement | [#1150](https://github.com/ezedike-evan/stellar-intel/issues/1150) |
| §9  | Browser tests never run for a fork PR, and never run on `main`               | [#1029](https://github.com/ezedike-evan/stellar-intel/issues/1029) |
| §9  | Playwright's `testDir` hygiene                                               | [#1027](https://github.com/ezedike-evan/stellar-intel/issues/1027) |
| §9  | Live-anchor calls on the merge path                                          | [#1034](https://github.com/ezedike-evan/stellar-intel/issues/1034) |
| §9  | `leaderboard-api` hits real anchors and times out                            | [#1032](https://github.com/ezedike-evan/stellar-intel/issues/1032) |
| §9  | `mcp-e2e` quote test times out under full-suite load                         | [#1035](https://github.com/ezedike-evan/stellar-intel/issues/1035) |
| §9  | `format:check` scans cargo artifacts and fails the local release gate        | [#1036](https://github.com/ezedike-evan/stellar-intel/issues/1036) |
| §10 | `lib/**/*.ts` is invisible to the contrast guard                             | [#968](https://github.com/ezedike-evan/stellar-intel/issues/968)   |
| §10 | No check that images and icon-only controls carry accessible names           | [#1069](https://github.com/ezedike-evan/stellar-intel/issues/1069) |
| §11 | Every published package is a 404; the docs still print install commands      | [#1072](https://github.com/ezedike-evan/stellar-intel/issues/1072) |

## Reproducing this audit

```bash
npm run test:release      # typecheck + lint + format:check + vitest + build
npm run emit-openapi && git diff --exit-code -- public/openapi.json
npm run emit-llms-full && git diff --exit-code -- lib/seo/llms-full.generated.txt
npm run check:registry
cargo test --manifest-path contracts/reputation/Cargo.toml --locked
cargo clippy --manifest-path contracts/reputation/Cargo.toml --all-targets -- -D warnings
npx tsx --tsconfig tsconfig.scripts.json scripts/verify-oracle-read.mts
npx playwright test --list
curl -s https://stellar-intel.vercel.app/api/reputation/probe-coverage
```

The last two are new to this revision, and both are read-only. Between them
they produce §9's and §6's headline numbers.

---

## 1. Custody

| Claim                                              | Evidence                                                                      | Status                |
| -------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------- |
| The app never takes custody of user funds          | [`NON_CUSTODY.md`](NON_CUSTODY.md) § "How the boundary is enforced"           | Enforced in code      |
| No private key is ever held server-side for a user | [`SECURITY.md`](SECURITY.md) § "Custody boundary", § "Key & secret handling"  | Enforced in code      |
| Every payment leg is signed in the user's wallet   | [`NON_CUSTODY.md`](NON_CUSTODY.md) § "What Stellar Intel never holds"         | Enforced in code      |
| The publisher holds a signing key                  | `PUBLISHER_SECRET`, used only to write reputation outcomes — never user funds | Documented, not gated |

The custody boundary is architectural: there is no code path that could take
custody, which is a stronger statement than a policy. It is **not** gated in CI —
nothing would fail if a future change introduced one. Tracked in
[#1147](https://github.com/ezedike-evan/stellar-intel/issues/1147), and it
remains the single most valuable test this repository does not have.

## 2. Security posture

| Claim                                  | Evidence                                                   | Status                |
| -------------------------------------- | ---------------------------------------------------------- | --------------------- |
| A vulnerability disclosure path exists | [`SECURITY.md`](SECURITY.md) § "Reporting a vulnerability" | Documented, not gated |
| Threat model is reviewed on a cadence  | [`THREAT_MODEL.md`](THREAT_MODEL.md) § "Review cadence"    | Documented, not gated |
| Dependencies are reviewed on every PR  | `.github/workflows/dependency-review.yml`                  | Enforced in CI        |
| Static analysis runs on every PR       | `.github/workflows/codeql.yml`                             | Enforced in CI        |
| No secret is committed                 | `.github/workflows/secret-scan.yml`                        | Enforced in CI        |

Secret scanning is gitleaks against a committed [`.gitleaks.toml`](../.gitleaks.toml),
in two jobs answering different questions. The **PR job** scans only the commits
a change adds and fails the check, so a secret cannot land; it is fast enough to
run on every pull request. The **scheduled job** scans every commit weekly,
because a gate can only see forward — a repository whose history was never
swept is not clean, it is unchecked.

The config extends gitleaks' maintained rule set and adds two the defaults do
not cover: a literal assignment to one of this repository's own server-side
secrets (`PUBLISHER_SECRET`, `CRON_SECRET`, `ADMIN_SECRET_KEY`,
`REVALIDATE_SECRET`), and a Stellar account secret seed (`S…` strkey). Its
allowlists are scoped: published Stellar identifiers (`G…`, `C…`) and
documentation placeholders are exempt everywhere, while fabricated fixture
credentials under `tests/` are exempt only from the generic entropy rules — a
real seed or a hard-coded `CRON_SECRET` is still a finding in a test file.
Historical false positives are pinned by fingerprint in
[`.gitleaksignore`](../.gitleaksignore) with the reasoning attached, rather than
by widening a rule.

Reproduce either job locally:

```bash
gitleaks git --config .gitleaks.toml     # full history
gitleaks dir --config .gitleaks.toml     # working tree
```

This closes [#1148](https://github.com/ezedike-evan/stellar-intel/issues/1148).
It does not replace GitHub's platform-level push protection, which acts before a
commit reaches the remote; the two are complementary, and this one is the part a
reader can verify from the repository.

## 3. Rate limiting

| Claim                                      | Evidence                                                                                   | Status           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ | ---------------- |
| Public read routes are rate limited        | `enforceRateLimit` / `withV1` on every public handler                                      | Enforced in code |
| Rate-limit headers are on the v1 API       | `lib/api/v1.ts` → `rateLimitHeaders`                                                       | Enforced in code |
| Write and expensive routes are all covered | `#D047` ([#733](https://github.com/ezedike-evan/stellar-intel/issues/733)), closed by #929 | Enforced in code |
| Coverage does not regress                  | `tests/rate-limit-coverage.spec.ts`; 429 paths in the v1 suites                            | Enforced in CI   |

**This section has changed since the last revision, and in the right
direction.** The previous audit listed coverage as **Not true yet** against a
non-empty flagged list. `#929` closed that list: of the 31 route handlers under
`app/api` and `app/v1`, the four without a per-caller limit are
`publisher/tick`, `reputation/reconcile`, `reputation/reconcile-volume-savings`
and `reputation/refresh` — all four `CRON_SECRET`-gated, which is a different
control rather than a missing one.

[`RATE_LIMIT_AUDIT.md`](RATE_LIMIT_AUDIT.md) still reports "1 of 16 routes
covered". Its tables predate `#929` and are wrong now; it needs the same refresh
this document just had.

## 4. SEP conformance

| Claim                                             | Evidence                                                                   | Status                     |
| ------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------- |
| SEP-1 / SEP-6 / SEP-10 / SEP-24 are implemented   | [`SEP_COMPLIANCE.md`](SEP_COMPLIANCE.md) § "What Stellar Intel implements" | Documented, not gated      |
| Per-anchor SEP support is recorded and current    | [`SEP_COMPLIANCE.md`](SEP_COMPLIANCE.md) § "Per-anchor SEP support matrix" | Documented, not gated      |
| Every registered anchor is transfer-capable       | `scripts/check-registry.mjs`, CI job `registry guard`                      | Enforced in CI             |
| Anchor reachability is checked nightly            | `.github/workflows/nightly.yml` → `anchor-domains`                         | Enforced in CI (warn-only) |
| Firm SEP-38 quotes are available across the fleet | [`POSITIONING.md`](POSITIONING.md) § "The claims this replaces"            | **Not true yet**           |

**One of seven registered anchors advertises `ANCHOR_QUOTE_SERVER` at all**, and
it does not quote the corridor it is registered for. Ranking across firm quotes
is not possible today.

This one carries no issue on purpose, and it is the only such row in the
document. It is not a defect in this repository — it is a fact about the live
network, and it becomes true as anchors adopt SEP-38 rather than as anyone here
writes code. The gap it creates in the product's shape is real and is stated in
`POSITIONING.md`; there is nothing to assign.

`anchor-domains` is deliberately warn-only: it probes third-party domains, and a
red `main` nobody can fix trains people to ignore the signal.

## 5. Signing determinism

| Claim                                             | Evidence                                                            | Status         |
| ------------------------------------------------- | ------------------------------------------------------------------- | -------------- |
| Intent canonicalization is deterministic          | [`CANONICAL_JSON.md`](CANONICAL_JSON.md) § "Canonicalization rules" | Enforced in CI |
| The intent hash is reproducible from the envelope | [`CANONICAL_JSON.md`](CANONICAL_JSON.md) § "Hash"                   | Enforced in CI |
| Signature verification rejects a tampered intent  | [`CANONICAL_JSON.md`](CANONICAL_JSON.md) § "Signature"              | Enforced in CI |

Covered by the unit suite, which CI runs on node 20 and node 22.

## 6. On-chain oracle

| Claim                                                     | Evidence                                                                             | Status                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------- |
| The reputation contract compiles and its tests pass       | CI job `soroban contract (reputation)` — fmt, clippy `-D warnings`, test, wasm build | Enforced in CI        |
| A deployable wasm artifact builds                         | Same job, `--target wasm32-unknown-unknown --release`                                | Enforced in CI        |
| A contract is deployed to testnet                         | `.deployments/testnet.json` — `CCZ54NTE…`, 2026-07-09                                | Documented, not gated |
| A mainnet publish requires 90 days of probe coverage      | `packages/publisher/src/gate.ts` → `evaluatePublishGate`                             | Enforced in code      |
| Admin transfer is two-step                                | `contracts/reputation/src/admin.rs`; `tests/multisig.rs`                             | Enforced in CI        |
| Operational admin and upgrade admin are distinct accounts | `scripts/verify-oracle-read.mts`                                                     | **Not true yet**      |
| The upgrade-admin role can be rotated                     | `contracts/reputation/src/upgrade.rs`                                                | **Not true yet**      |
| The deployed bytecode matches current `main`              | `scripts/verify-oracle-read.mts`                                                     | **Not true yet**      |
| Anchors are registered on the deployed contract           | `scripts/init-oracle-registry.ts`                                                    | **Not true yet**      |
| Probe-derived signals are published on chain              | `packages/publisher` writes `outcome_log` only                                       | **Not true yet**      |

### The live read

Reading the deployment on **2026-08-28** — unchanged in substance from the
2026-08-05 reading the previous revision recorded, which is itself the finding:

```
Oracle contract : CCZ54NTEOVL2DKWCGJA5XHTHOGRDS7JHFKYWEC6QH2IMZLYNM3FBFKDG
Deployed at     : 2026-07-09T08:53:11.769Z
Contract version: 0
Admin           : GAZW2PQFFJGH7RH6PB5VQASJIRAGEMZCID72CXYHRM27QYP4R5YRY777
Upgrade admin   : (unset)
::warning::Deployed contract is missing pending_admin, upgrade_admin — the on-chain
bytecode predates the current source.
::warning::Operational admin and upgrade admin are not two distinct accounts.
::warning::contract_version() is 0 — init_upgrade was never called.
Registered anchors (0): (none)
```

The upgrade-admin rotation in `contracts/reputation/src/upgrade.rs` is on `main`
and is not on chain. Everything reading the oracle is reading a seven-week-old
contract with an empty anchor list. Tracked in
[#1149](https://github.com/ezedike-evan/stellar-intel/issues/1149); extending the
publisher past `outcome_log` is [#785](https://github.com/ezedike-evan/stellar-intel/issues/785).

### The 90-day gate, and where it stands

`GET /api/reputation/probe-coverage` on **2026-08-29T00:30Z**:

| Field                     | Value                     |
| ------------------------- | ------------------------- |
| `thresholdDays`           | 90                        |
| `fleetThresholdMet`       | `false`                   |
| `daysUntilFleetThreshold` | **76**                    |
| `continuousDays`          | **14**, all seven anchors |
| First probe day           | 2026-08-15                |

**This is not a finding and it has no issue.** The gate is working exactly as
designed — `evaluatePublishGate` refuses a mainnet publish below the threshold,
and `coverage: null` is a refusal rather than "unknown, proceed". It is recorded
here because a reader deciding whether to depend on the oracle needs the number:
mainnet is **76 days away at the earliest**, and any interruption in probing
resets the streak rather than pausing it. All seven anchors currently show a
one-day gap at the head of the window, which is the report counting the
in-progress day.

Anything that reads the on-chain record before then is reading an empty
contract. That is the point of the gate — never launch an empty credit bureau —
and it is the single biggest determinant of when the oracle half becomes real.

## 7. API stability

| Claim                                                     | Evidence                                                   | Status                |
| --------------------------------------------------------- | ---------------------------------------------------------- | --------------------- |
| The committed OpenAPI spec matches the code               | CI step `OpenAPI spec is in sync` (`git diff --exit-code`) | Enforced in CI        |
| The committed docs corpus matches `docs/`                 | CI step `llms-full.txt is in sync`                         | Enforced in CI        |
| Every v1 route appears in the spec                        | `tests/openapi-coverage.spec.ts`                           | Enforced in CI        |
| Responses carry an `API-Version` header                   | `lib/logger.ts`                                            | Enforced in code      |
| A versioning and deprecation policy is published          | [`VERSIONING.md`](VERSIONING.md)                           | Documented, not gated |
| The support window is "current + 1 previous, 180 days"    | `lib/api/api-version.ts` → `computeSupportedApiVersions`   | Enforced in code¹     |
| `Sunset` / `Warning: 299` deprecation headers are emitted | `lib/api/deprecation.ts`, `lib/logger.ts`                  | Enforced in code¹     |
| `/api/status` publishes `announced_deprecations`          | `app/api/status/route.ts`                                  | Enforced in code      |

¹ The window and the headers it unlocks are both computed from
`API_VERSION_HISTORY` and exercised in
`tests/api-version-negotiation.spec.ts` against synthetic history (a version
retired 179 days ago stays in the window, 181 days ago it doesn't) — but real
production history has exactly one version, since none has ever been
retired. So `SUPPORTED_API_VERSIONS` still has one element and no live
response carries `Sunset`/`Warning` today. That is expected, not a gap: the
mechanism is real and tested; it has simply never had a reason to produce a
second entry. It does the first time a version ships and the outgoing one is
recorded with a `supersededAt`.

The previous revision pointed at #874. **That issue is closed** — the policy
half landed in #827 and the code half did not, until
[#1150](https://github.com/ezedike-evan/stellar-intel/issues/1150).

## 8. Trust boundaries

| Claim                                           | Evidence                                                  | Status                |
| ----------------------------------------------- | --------------------------------------------------------- | --------------------- |
| Trust boundaries are documented                 | [`ARCHITECTURE.md`](ARCHITECTURE.md) § "Trust boundaries" | Documented, not gated |
| Anchor responses are treated as untrusted input | [`ARCHITECTURE.md`](ARCHITECTURE.md)                      | Documented, not gated |
| Cron routes require a shared secret             | `CRON_SECRET` bearer check on each cron route             | Enforced in code      |
| Admin routes require a separate secret          | `ADMIN_SECRET_KEY`                                        | Enforced in code      |

## 9. Build and quality gates

Every row here fails a merge to `main` if it stops holding.

| Gate                       | Command                                                                   |
| -------------------------- | ------------------------------------------------------------------------- |
| Formatting                 | `npm run format:check` (covers `**/*.md` too)                             |
| Lint, zero warnings        | `npm run lint` (`eslint --max-warnings 0`)                                |
| Types                      | `npm run typecheck` (`tsc --noEmit`)                                      |
| Unit suite + coverage      | `npm run test -- --coverage`, on node 20 **and** 22                       |
| OpenAPI drift              | `npm run emit-openapi` + `git diff --exit-code`                           |
| Docs-corpus drift          | `npm run emit-llms-full` + `git diff --exit-code`                         |
| Anchor registry            | `npm run check:registry`                                                  |
| Production build           | `next build`                                                              |
| Rust consumer crate        | `cargo test`, `cargo doc`, `cargo publish --dry-run`                      |
| Soroban contract           | `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`, wasm build |
| Commit message convention  | `commitlint`                                                              |
| One closing keyword per PR | `.github/workflows/one-issue-per-pr.yml`                                  |
| WCAG AA contrast           | `tests/contrast.spec.ts`                                                  |

Counts as of this audit: **69** `#[test]` functions across 14 integration test
files in `contracts/reputation/tests/`, **11** in the consumer crate, and
**~3,860** vitest assertions across ~228 spec files.

### The suite the gate cannot run

The browser suite exists and, since #1131, it collects: `npx playwright test
--list` reports **36 tests in 9 files**. It still does not protect a merge.

- **It never runs for a contributor.** The `Playwright smoke` job is gated on
  `needs.deploy.outputs.preview-url != ''`, and the `deploy` job that produces
  that URL is gated on `github.event.pull_request.head.repo.full_name ==
github.repository`. Every fork PR skips it. Nothing runs it on `main` after
  merge either. [#1029](https://github.com/ezedike-evan/stellar-intel/issues/1029)
- **`testDir` hygiene is still open** as
  [#1027](https://github.com/ezedike-evan/stellar-intel/issues/1027), though its
  body predates the conversion — the nine files it names are Playwright specs
  today. Worth re-reading before working it.
- **There is no npm script for it.** `npx playwright install chromium` followed
  by `npx playwright test` is the only entry point, which is why "run the
  browser tests" is not in anyone's muscle memory.

### The release gate depends on the network

`npm run test:release` is the documented one-liner and it is not reliably
runnable offline or on a bad day:

- Parts of the unit suite call live anchors, so a slow third party fails a
  merge a contributor cannot fix.
  [#1034](https://github.com/ezedike-evan/stellar-intel/issues/1034) moves those
  checks off the merge path;
  [#1032](https://github.com/ezedike-evan/stellar-intel/issues/1032) stubs
  `leaderboard-api`, and
  [#1035](https://github.com/ezedike-evan/stellar-intel/issues/1035) covers the
  `mcp-e2e` timeout that only appears under full-suite load.
- `format:check` runs first and scans `contracts/**/target/`, so any local
  `cargo build` makes the whole gate exit 1 before running anything useful.
  [#1036](https://github.com/ezedike-evan/stellar-intel/issues/1036) — one line
  in `.prettierignore`.

### Gates that do not exist

- **No end-to-end test in the merge gate.** Playwright smoke exists on PRs but
  is skipped for fork PRs (the preview deploy it depends on requires the PR to
  come from this repository), so no contributor PR is browser-verified before
  merge. `.github/workflows/postmerge-playwright.yml` closes half the gap: it
  runs the full Playwright suite against `main` after every merge, against a
  locally built `next start`, independent of who opened the PR — so `main`
  itself is never left unverified, but no PR is blocked by it.
  [#1029](https://github.com/ezedike-evan/stellar-intel/issues/1029).
- **No custody-boundary test.** §1's central claim is unguarded,
  [#1147](https://github.com/ezedike-evan/stellar-intel/issues/1147).
- **No link checker**, so a doc can reference a file that does not exist.

## 10. Accessibility

| Claim                                         | Evidence                                                  | Status           |
| --------------------------------------------- | --------------------------------------------------------- | ---------------- |
| Palette contrast meets WCAG AA in both themes | `tests/contrast.spec.ts`, parsed from `app/globals.css`   | Enforced in CI   |
| Components avoid measured-failing grey values | Same file, raw-grey scanner over `components/` and `app/` | Enforced in CI   |
| Images and controls carry accessible names    | —                                                         | **Not true yet** |
| Every surface uses the palette tokens         | —                                                         | **Not true yet** |

**Improved since the last revision.** `components/offramp/*`, `app/anchors` and
`app/admin` are clean — #967 tokenized them — and `lib/prose.ts` no longer holds
a raw grey either. The scanner's blind spot is what remains: it walks `.tsx`
under `components/` and `app/` only, and `lib/oracle/freshness.ts:166-168` sits
outside it with `text-gray-400` in the dark theme, one of the values
`contrast.spec.ts` bans by name. Tracked in
[#968](https://github.com/ezedike-evan/stellar-intel/issues/968), which is
scoped to exactly this: extend the guard to `lib/**/*.ts`.

Contrast is also the only accessibility property with a gate. Nothing checks
that an image carries `alt` or that an icon-only button carries an accessible
name — a control that renders and clicks is invisible to the suite and unusable
to anyone who cannot see the icon. Tracked in
[#1069](https://github.com/ezedike-evan/stellar-intel/issues/1069).

## 11. Distribution

| Claim                                    | Evidence                                      | Status           |
| ---------------------------------------- | --------------------------------------------- | ---------------- |
| The publish workflows exist              | `.github/workflows/publish-*.yml`             | Documented       |
| `@stellarintel/sdk` is installable       | `npm view @stellarintel/sdk` → **E404**       | **Not true yet** |
| `@stellarintel/mcp` is installable       | `npm view @stellarintel/mcp` → **E404**       | **Not true yet** |
| `@stellarintel/publisher` is installable | `npm view @stellarintel/publisher` → **E404** | **Not true yet** |

Three publish workflows exist and are trigger-gated on release tags. The
repository has no release tags, so none of them has ever run, and every install
command the docs print fails. `/docs/sdks` and `/docs/mcp` still print them.
Tracked in [#1072](https://github.com/ezedike-evan/stellar-intel/issues/1072).

This is a section the previous revision did not have, and it is the finding a
reader is most likely to hit first: the quickstart is the first page they open.

---

## Summary of open gaps

Ordered by how much they would matter to someone deciding whether to depend on
this project.

1. **The oracle is empty and the deployment is stale.** The contract on testnet
   predates `main`, has no upgrade path, and has zero anchors registered — and
   the mainnet publish that would fix the emptiness is **76 days away** behind
   the probe gate. §6 ·
   [#1149](https://github.com/ezedike-evan/stellar-intel/issues/1149) ·
   [#785](https://github.com/ezedike-evan/stellar-intel/issues/785)
2. **Nothing you can install exists.** Every package is a 404 and the docs still
   print the install command. §11 ·
   [#1072](https://github.com/ezedike-evan/stellar-intel/issues/1072)
3. **No browser test protects a merge**, and none runs on `main`. §9 ·
   [#1029](https://github.com/ezedike-evan/stellar-intel/issues/1029)
4. **The custody boundary — the project's central claim — has no automated
   guard.** §1 · [#1147](https://github.com/ezedike-evan/stellar-intel/issues/1147)
5. **`VERSIONING.md` promises three things the code does not implement**, and the
   issue that used to track it was closed without them. §7 ·
   [#1150](https://github.com/ezedike-evan/stellar-intel/issues/1150)
6. **The release gate is network-dependent and locally fragile.** §9 ·
   [#1034](https://github.com/ezedike-evan/stellar-intel/issues/1034) ·
   [#1036](https://github.com/ezedike-evan/stellar-intel/issues/1036)
7. **Firm SEP-38 quotes do not exist across the fleet**, so quote-ranking claims
   cannot be true yet. §4 — no issue, because there is nothing here to assign.
8. **Accessibility is guarded for contrast and nothing else.** §10 ·
   [#1069](https://github.com/ezedike-evan/stellar-intel/issues/1069) ·
   [#968](https://github.com/ezedike-evan/stellar-intel/issues/968)

### What improved since the last revision

Recorded because an audit that only accumulates is one nobody believes.

- **Rate-limit coverage went from one route to every public route** (#929). §3
  was the previous revision's sixth-ranked gap and is now closed.
- **The palette sweep landed** (#967): three of the four surfaces named in §10
  are clean.
- **The browser suite collects again** (#1131). It does not gate a merge, which
  is a different problem, but "no browser test has ever run" is no longer the
  accurate sentence.

### Adjacent documents that need the same treatment

- [`RATE_LIMIT_AUDIT.md`](RATE_LIMIT_AUDIT.md) — its coverage table predates
  #929 and now understates reality by a wide margin.

---

_See also: [`POSITIONING.md`](POSITIONING.md) for the claims this project
retired, and [`PROPOSAL.md`](PROPOSAL.md) for what it is for._
