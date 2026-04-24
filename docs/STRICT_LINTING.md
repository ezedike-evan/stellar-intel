# Strict Linting & CI Gates

> The rules Stellar Intel enforces, and _why_. If you are wondering "should I
> turn this on locally?", the answer is yes — CI will catch it eventually,
> and fixing it at write-time is cheaper than fixing it at review-time.

## Philosophy

**Defects are cheapest at the keystroke.** Every gate below catches a class
of defect we would otherwise catch in review (expensive), in QA (slower),
or in production (most expensive). We pay the up-front cost of strict
tooling so the engineering loop stays fast.

Two guiding principles:

1. **Zero-warning policy.** Warnings are just deferred errors. We fail CI on
   any lint warning (`--max-warnings 0`). No "I'll clean it up later" — it
   never gets cleaned up later.
2. **Gate, then automate.** A rule only earns a CI gate if we are willing to
   block merges on it. If it is not worth blocking, it is not worth
   configuring.

---

## Enforced in CI

Every PR runs, in order of earliest failure:

| Gate | Command | Fails on |
|------|---------|----------|
| **Prettier** | `npm run format:check` | Any unformatted diff. Rerun `npm run format` to fix. |
| **ESLint (zero warnings)** | `npm run lint` | Any `no-explicit-any`, `no-unused-vars`, `no-console`, Next.js core-web-vital rule. |
| **TypeScript** | `npm run typecheck` | Any type error under the strict flag set below. |
| **Vitest** | `npm run test` | Any failing unit test. Coverage uploaded to Codecov. |
| **Next build** | `npm run build` | Build error, missing env var at build-time, circular import. |
| **Commitlint** | workflow `commitlint` | Commit that does not match `<type>[(scope)]: <subject>`. |
| **PR title** | workflow `pr-title` | PR title not following Conventional Commits. |
| **Dependency review** | workflow `dependency-review` | New dep with GPL / AGPL licence or CVE ≥ moderate. |
| **Bundle size** | workflow `bundle-size` | > 10 kB total JS growth vs. base branch without a size label. |
| **Lighthouse** | workflow `lighthouse` | Posted as comment; informational unless performance degrades sharply. |
| **CodeQL** | workflow `codeql` | Security-extended + security-and-quality queries. |

Run the full local equivalent with `npm run test:release`.

---

## TypeScript strict flags

Enabled in `tsconfig.json`:

| Flag | Catches |
|------|---------|
| `strict` | All the standard strict-mode checks (`strictNullChecks`, `noImplicitAny`, …). |
| `noUncheckedIndexedAccess` | `arr[i]` is inferred as `T \| undefined`, forcing explicit null checks on index access. |
| `noImplicitOverride` | Subclass methods must use `override`, preventing accidental parent-method shadowing. |
| `exactOptionalPropertyTypes` | `{ x?: T }` and `{ x?: T \| undefined }` are distinct. Prevents "undefined leaked through an optional". |
| `noFallthroughCasesInSwitch` | Every non-empty `case` ends in a terminator. |
| `forceConsistentCasingInFileNames` | Prevents import-path case drift between macOS/Windows (case-insensitive FS) and Linux CI (case-sensitive). |

These are deliberately opinionated. If a flag blocks you, prefer adding
a narrow type annotation over disabling the flag repo-wide.

---

## ESLint rules we care about

Declared in `eslint.config.mjs`. Notable non-defaults:

- `@typescript-eslint/no-explicit-any`: **error**. `any` defeats the point
  of TypeScript; use `unknown` at system boundaries and narrow.
- `no-console`: **warn** (which CI treats as error under `--max-warnings 0`).
  Use `lib/telemetry` / structured logs, not raw `console.log`.
- `no-unused-vars`: **error**. Unused imports and dead bindings are pure
  cost.
- Next.js `core-web-vitals`: performance rules around `<Image>`, `<Link>`,
  and `next/head` usage.

To debug: `npm run lint -- --debug` prints the full rule chain.

---

## Commit & PR hygiene

### Conventional Commits

Format: `<type>[(scope)]: <subject>`

```
feat(router): rank anchors by net landed value, not headline rate
fix(sep24): retry /transaction poll on transient 502
docs(ops): add branch-protection setup script
ci(ops): fail bundle-size check on > 10 kB growth
chore(deps): bump @stellar/stellar-sdk to 14.7.0
```

Accepted types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`,
`build`, `ci`, `chore`, `revert`.

Scopes map to module labels — keep them aligned with
[`.github/labels.yml`](../.github/labels.yml). Empty scope is allowed for
repo-wide changes (`chore: reshuffle root`).

### Pre-commit hooks

`.husky/pre-commit` runs `lint-staged` against the staged files only, so
the hook stays under ~2 seconds on a typical change. `.husky/commit-msg`
runs `commitlint`. Neither hook runs the full typecheck — that is CI's
job, not the contributor's.

Hooks are installed via `npm install` (the `prepare` script). If they do
not fire, rerun `npm install` or `npx husky install`.

---

## Branch protection

Repo settings → **Branches → main**:

- Require a pull request before merging.
- Require **1** approving review.
- Require status checks to pass before merging:
  - `check (node 20)`
  - `check (node 22)`
  - `build (node 20)`
  - `codeql-analysis`
  - `pr-title`
  - `commitlint`
  - `dependency-review`
- Require branches to be **up to date** before merging.
- Require **linear history**.
- Include administrators (even maintainers follow the rules).
- Restrict who can push to matching branches — maintainers only.

A helper script to apply this via the API lives at
[`scripts/protect-main.sh`](../scripts/protect-main.sh). Run it after
changing required checks.

---

## Escape hatches

There are none. If a rule is wrong, we change the rule — we do not sprinkle
`// eslint-disable-next-line` or `@ts-expect-error` to move on. The one
exception is vendor-interop files at a system boundary (e.g. a third-party
type shim), which are allowed a `// eslint-disable` with a comment
explaining _why_.
