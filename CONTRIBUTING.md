# Contributing to Stellar Intel

Thank you for your interest in contributing. This document covers everything
you need to get started.

---

## Before You Begin

- Read the [Code of Conduct](CODE_OF_CONDUCT.md). All contributors are expected to follow it.
- For significant changes, open an issue first to discuss the approach before writing code.
- For bug fixes and small improvements, a pull request is sufficient.

---

## Development Setup

```bash
git clone https://github.com/Ezedike-Evan/stellar-intel.git
cd stellar-intel
npm install
cp .env.example .env.local
npm run dev
```

See [README.md](README.md) for full setup instructions and environment variable reference.

---

## Workflow

1. Fork the repository and create a branch from `main`.
2. Name branches descriptively: `feat/sep24-fee-fetching`, `fix/anchor-rate-display`, `docs/readme-update`.
3. Make your changes. Keep commits focused — one logical change per commit.
4. Run checks before pushing:
   ```bash
   npm run typecheck
   npm run lint
   npm run build
   ```
5. Open a pull request against `main`. Fill in the PR description template.

---

## Code Standards

### TypeScript

- Strict mode is enabled. All code must pass `npm run typecheck` with zero errors.
- Prefer explicit types over `any`. Use `unknown` when the type is genuinely unknown.
- Export types from `types/` — do not inline complex types in component files.

### Components

- One component per file.
- Components live in `components/`. UI primitives live in `components/ui/`.
- Keep components focused. If a component exceeds ~150 lines, consider splitting it.

### Data Fetching

- Use SWR hooks from `hooks/` for client-side data fetching.
- Network calls belong in `lib/` — not inside components or hooks.
- No mock data in production code. If real data is unavailable, surface an error state.

### Styling

- Tailwind CSS v4 only. No inline `style` props unless absolutely necessary.
- Follow the existing class ordering convention (layout → spacing → typography → colour).

### Commits

Follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
feat: add SEP-24 fee fetching for Cowrie anchor
fix: correct exchange rate computation for NGN corridor
docs: update environment variable reference
refactor: extract anchor TOML resolution into lib/sep1.ts
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`.

---

## Adding a New Anchor

Anchors are defined in `constants/anchors.ts` (re-exported via `constants/index.ts`). To add a new anchor:

1. Add an entry to `KNOWN_ANCHORS` with the anchor's `id`, `name`, `domain`,
   `supportedCountries`, `supportedCurrencies`, and `depositMethods`.
2. The anchor must have a publicly resolvable `stellar.toml` at `https://{domain}/.well-known/stellar.toml`.
3. The `stellar.toml` must expose a transfer server — `TRANSFER_SERVER_SEP0024` (SEP-24) or `TRANSFER_SERVER` (SEP-6). SEP-6-only anchors are supported; see [docs/ANCHOR_ONBOARDING.md](docs/ANCHOR_ONBOARDING.md).
4. Verify the anchor's `/fee` endpoint returns live data before submitting the PR.

---

## Pull Request Checklist

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] No `isMock`, `// MOCK`, or hardcoded rate values added
- [ ] New anchor entries include a verified `stellar.toml` domain
- [ ] PR description explains what changed and why

---

## Issue Numbering & Label Conventions

This repo uses several namespaces to organise work across waves, modules, and
documentation debt. Understanding them helps you navigate the issue tracker and
write PRs that auto-link correctly.

### Issue numbering

| Prefix | Range | Purpose |
| ------ | ----- | ------- |
| `#001–#250` | Main tracker | Wave-scoped engineering tickets (see `docs/ROADMAP.md`). |
| `#B001–#B100` | Batch 2 | Supplementary issues from `issues-batch-2.md`. |
| `#W1.1–W7.x` | Wave issues | Per-workstream milestone issues from `WAVE_ISSUES.md`. |
| `#D001–D999` | Doc/infra debt | Documentation gaps, infra improvements, and technical-debt tickets that don't fit a wave. Sometimes referenced as `#D047` inline in code comments. |
| `#N/A` | Meta | Issues opened against the issue tracker itself (template improvements, workflow changes). |

A PR title like `fix: correct exchange rate computation for NGN corridor` will
auto-close an issue when the body contains `Closes #NNN`.

### Label taxonomy

Labels are the single source of truth for issue triage. They are defined in
`.github/labels.yml` and synced to GitHub by
`.github/workflows/label-sync.yml`. The taxonomy follows these rules:

- **Lower-case, hyphenated, namespaced with `/`** — e.g. `module/oracle`,
  `epic/reputation`.
- **One concern per namespace.** A label belongs to exactly one category
  (type, state, difficulty, wave, epic, module).
- **State labels are flat** — `blocked`, `help-wanted`, `design-review`.

| Category | Examples | Purpose |
| -------- | -------- | ------- |
| **Type** | `bug`, `feature`, `docs`, `chore`, `refactor`, `test` | What kind of change the issue represents. Every issue has exactly one type label. |
| **State** | `blocked`, `help-wanted`, `good-first-issue`, `design-review`, `needs-triage` | Workflow status. Applied and removed as the issue progresses. |
| **Difficulty** | `difficulty/good-first-issue`, `difficulty/intermediate`, `difficulty/hard` | Estimated effort. Set by a maintainer during triage. |
| **Wave** | `wave/1.0`, `wave/2.0`, `wave/2.1` | Which milestone the issue belongs to. Maps to `docs/ROADMAP.md`. |
| **Epic** | `epic/execution-layer`, `epic/reputation`, `epic/agents`, `epic/anchor-integration`, `epic/ui`, `epic/docs-community` | High-level theme the issue contributes to. |
| **Module** | `module/oracle`, `module/router`, `module/reputation`, `module/mcp`, `module/api`, `module/ui`, `module/sep10`, `module/sep24`, `module/sep38` | Which subsystem the change lands in. Helps route PRs to the right reviewer. |
| **Meta** | `release`, `dependencies`, `size/xs`–`size/xl` | Release tracking, dependency updates, and PR size estimation. |

### D-numbering (documentation & infra debt)

`D`-prefixed issues (`#D001`, `#D002`, …) track documentation gaps and
infrastructure improvements that are not visible to end users but affect
contributor experience, maintainability, or operator workflows. They follow
the same triage process as numbered issues but live in a separate namespace
so they can be planned independently of feature work.

Examples from the codebase:
- `#D002` — Uptime probe ledger
- `#D005` — Quote-latency probe
- `#D006` — Quote-drift probe
- `#D014` — Sentry / dead-letter alert sink
- `#D035` — SEP-24 live execution flow e2e test
- `#D047` — Rate-limit audit follow-up
- `#D060` / `#746` — Plausible analytics integration

When referencing a D-issue in code, use the pattern:
```typescript
// ─── Uptime / quote-latency probe ledger (Issue #D002 / #D005) ────────────────
```

### Branch naming

Branches should be named descriptively:
- `feat/<short-description>` — new capabilities
- `fix/<short-description>` — bug fixes
- `docs/<short-description>` — documentation changes
- `chore/<short-description>` — build, tooling, deps
- `refactor/<short-description>` — code structure changes with no behaviour change

### "One issue per PR" rule

Every PR must link exactly one issue with a closing keyword (`Closes`,
`Fixes`, `Resolves`). This ensures:
1. Issues auto-close on merge.
2. The changelog generator picks up a clean mapping.
3. Reviews stay scoped.

If a change genuinely spans multiple issues (rare), close the primary issue
and reference the others in the PR body. Never leave a `Closes #` line
unfilled or filled with an example number.

---

## Questions

Open an issue with the `question` label.
