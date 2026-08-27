# Production Audit

**Last reviewed:** 2026-08-26

A claim-by-claim audit of what this repository actually enforces, what it only
documents, and what is not true yet. It follows the method
[`POSITIONING.md`](POSITIONING.md) sets out — _a positioning document that cannot
be falsified is marketing_ — so every row names where the evidence lives and
what command reproduces it.

## How to read the status column

| Status                    | Meaning                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------- |
| **Enforced in CI**        | A merge to `main` fails if this stops being true. The check is named in the row.        |
| **Enforced in code**      | The invariant is a refusal in a code path, but nothing in CI would catch its removal.   |
| **Documented, not gated** | Written down and believed to be true; no automated check holds it.                      |
| **Not true yet**          | Stated here because it has been claimed somewhere, or is assumed. It is not true today. |

The third and fourth categories are the point of this document. An audit that
lists only the green rows is a marketing page with a table in it.

## Reproducing this audit

```bash
npm run test:release      # format:check + lint + typecheck + vitest + build
npm run emit-openapi && git diff --exit-code -- public/openapi.json
npm run check:registry
cargo test --manifest-path contracts/reputation/Cargo.toml --locked
cargo clippy --manifest-path contracts/reputation/Cargo.toml --all-targets -- -D warnings
npx tsx scripts/verify-oracle-read.mts
```

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
nothing would fail if a future change introduced one. That is a real gap and is
the single most valuable test this repository does not have.

## 2. Security posture

| Claim                                  | Evidence                                                   | Status                |
| -------------------------------------- | ---------------------------------------------------------- | --------------------- |
| A vulnerability disclosure path exists | [`SECURITY.md`](SECURITY.md) § "Reporting a vulnerability" | Documented, not gated |
| Threat model is reviewed on a cadence  | [`THREAT_MODEL.md`](THREAT_MODEL.md) § "Review cadence"    | Documented, not gated |
| Dependencies are reviewed on every PR  | `.github/workflows/ci.yml` → `dependency-review`           | Enforced in CI        |
| Static analysis runs on every PR       | CodeQL (`Analyze (javascript-typescript)`)                 | Enforced in CI        |
| No secret is committed                 | —                                                          | Not true yet          |

**"No secret is committed" has no gate.** There is no secret-scanning step in
CI. GitHub's own push protection may apply at the platform level, but this
repository does not assert it.

## 3. Rate limiting

| Claim                                      | Evidence                                                             | Status                |
| ------------------------------------------ | -------------------------------------------------------------------- | --------------------- |
| Public read routes are rate limited        | [`RATE_LIMIT_AUDIT.md`](RATE_LIMIT_AUDIT.md) § "Coverage table"      | Documented, not gated |
| Rate-limit headers are on the v1 API       | `lib/api/v1.ts` → `rateLimitHeaders`                                 | Enforced in code      |
| Write and expensive routes are all covered | [`RATE_LIMIT_AUDIT.md`](RATE_LIMIT_AUDIT.md) § "Flagged for `#D047`" | Not true yet          |

The audit document maintains its own flagged list of uncovered routes. That list
is non-empty, and this row exists so the gap is visible from here rather than
only from inside that file.

## 4. SEP conformance

| Claim                                             | Evidence                                                                   | Status                     |
| ------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------- |
| SEP-1 / SEP-10 / SEP-24 are implemented           | [`SEP_COMPLIANCE.md`](SEP_COMPLIANCE.md) § "What Stellar Intel implements" | Documented, not gated      |
| Per-anchor SEP support is recorded and current    | [`SEP_COMPLIANCE.md`](SEP_COMPLIANCE.md) § "Per-anchor SEP support matrix" | Documented, not gated      |
| Every registered anchor is transfer-capable       | `scripts/check-registry.mjs`, CI job `registry guard`                      | Enforced in CI             |
| Anchor reachability is checked nightly            | `.github/workflows/nightly.yml` → `anchor-domains`                         | Enforced in CI (warn-only) |
| Firm SEP-38 quotes are available across the fleet | [`POSITIONING.md`](POSITIONING.md) § "The claims this replaces"            | **Not true yet**           |

**One of seven registered anchors advertises `ANCHOR_QUOTE_SERVER` at all**, and
it does not quote the corridor it is registered for. Ranking across firm quotes
is not possible today. This is the single largest gap between what the product
is shaped for and what the network currently supports.

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

Reading the live deployment on 2026-08-05:

```
Oracle contract : CCZ54NTEOVL2DKWCGJA5XHTHOGRDS7JHFKYWEC6QH2IMZLYNM3FBFKDG
Deployed at     : 2026-07-09T08:53:11.769Z
Contract version: 0
Admin           : GAZW2PQFFJGH7RH6PB5VQASJIRAGEMZCID72CXYHRM27QYP4R5YRY777
Upgrade admin   : (unset)
::warning::Deployed contract is missing pending_admin, upgrade_admin — the on-chain
bytecode predates the current source.
Registered anchors (0): (none)
```

Three findings follow, and they are the most consequential in this document:

1. **`contract_version()` returns `0` and the upgrade admin is unset**, so
   `init_upgrade` was never called. There is no in-place upgrade path from the
   currently deployed bytecode — a new entrypoint requires a fresh deploy.
2. **The deployed bytecode predates the current source** by enough that
   `pending_admin` and `upgrade_admin` are missing. Testnet is not a stale copy
   of `main`; it is a different contract.
3. **Zero anchors are registered**, so a third party reading the contract today
   gets an empty list. The "ripped out" test does not pass.

## 7. API stability

| Claim                                                     | Evidence                                                   | Status                |
| --------------------------------------------------------- | ---------------------------------------------------------- | --------------------- |
| The committed OpenAPI spec matches the code               | CI step `OpenAPI spec is in sync` (`git diff --exit-code`) | Enforced in CI        |
| Every v1 route appears in the spec                        | `tests/openapi-coverage.spec.ts`                           | Enforced in CI        |
| Responses carry an `API-Version` header                   | `lib/logger.ts`                                            | Enforced in code      |
| A versioning and deprecation policy is published          | [`VERSIONING.md`](VERSIONING.md)                           | Documented, not gated |
| The support window is "current + 1 previous, 180 days"    | `lib/api/api-version.ts` → `SUPPORTED_API_VERSIONS`        | **Not true yet**      |
| `Sunset` / `Warning: 299` deprecation headers are emitted | —                                                          | **Not true yet**      |
| `/api/status` publishes `announced_deprecations`          | —                                                          | **Not true yet**      |

`SUPPORTED_API_VERSIONS` has exactly one element, and `negotiateApiVersion`
rejects anything else — so the support window `VERSIONING.md` promises is
contradicted by the code that enforces it. The deprecation lifecycle and the
status endpoint have zero implementation: `grep` for `sunset`, `Deprecation:`
and `announced_deprecations` across `lib/` and `app/` returns nothing.

Tracked in #874.

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
| Anchor registry            | `npm run check:registry`                                                  |
| Production build           | `next build`                                                              |
| Rust consumer crate        | `cargo test`, `cargo doc`, `cargo publish --dry-run`                      |
| Soroban contract           | `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`, wasm build |
| Commit message convention  | `commitlint`                                                              |
| One closing keyword per PR | `.github/workflows/one-issue-per-pr.yml`                                  |
| WCAG AA contrast           | `tests/contrast.spec.ts`                                                  |

Counts as of this audit: **56** `#[test]` functions across 13 integration test
files in `contracts/reputation/tests/`, **7** in the consumer crate, and **~1,890**
vitest assertions across ~170 spec files.

### Gates that do not exist

- **No secret scanning.**
- **No end-to-end test in the merge gate.** Playwright smoke exists but is
  skipped on PRs.
- **No custody-boundary test.** §1's central claim is unguarded.
- **No link checker**, so a doc can reference a file that does not exist.

## 10. Accessibility

| Claim                                         | Evidence                                                  | Status           |
| --------------------------------------------- | --------------------------------------------------------- | ---------------- |
| Palette contrast meets WCAG AA in both themes | `tests/contrast.spec.ts`, parsed from `app/globals.css`   | Enforced in CI   |
| Components avoid measured-failing grey values | Same file, raw-grey scanner over `components/` and `app/` | Enforced in CI   |
| Every surface uses the palette tokens         | —                                                         | **Not true yet** |

`components/offramp/*`, `app/anchors`, `app/admin` and `lib/prose.ts` still use
raw Tailwind colours. `lib/prose.ts` is invisible to the guard entirely — the
walker only scans `.tsx` under `components/` and `app/`. Tracked in #967 and
#968.

---

## Summary of open gaps

Ordered by how much they would matter to someone deciding whether to depend on
this project.

1. **The deployed testnet contract predates `main`, has no upgrade path, and has
   no anchors registered.** Everything that reads the oracle is reading an empty
   contract. §6.
2. **Firm SEP-38 quotes do not exist across the fleet**, so quote-ranking claims
   cannot be true yet. §4.
3. **`VERSIONING.md` promises four things the code does not implement.** §7.
4. **The custody boundary — the project's central claim — has no automated
   guard.** §1.
5. **No secret scanning in CI.** §2.
6. **Rate-limit coverage is incomplete** and tracked in its own flagged list. §3.
7. **Half the UI bypasses the palette tokens.** §10.

None of these is hidden elsewhere in the repository; each is stated in the
document that owns the subject. This audit exists so they are visible in one
place, with the same status vocabulary, to a reader who has not read all of them.

---

_See also: [`POSITIONING.md`](POSITIONING.md) for the claims this project
retired, and [`PROPOSAL.md`](PROPOSAL.md) for what it is for._

