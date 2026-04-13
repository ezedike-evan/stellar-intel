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
git clone https://github.com/your-org/stellar-intel.git
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

Anchors are defined in `constants/index.ts`. To add a new anchor:

1. Add an entry to `KNOWN_ANCHORS` with the anchor's `id`, `name`, `domain`,
   `supportedCountries`, `supportedCurrencies`, and `depositMethods`.
2. The anchor must have a publicly resolvable `stellar.toml` at `https://{domain}/.well-known/stellar.toml`.
3. The `stellar.toml` must contain `TRANSFER_SERVER_SEP0024` for off-ramp/on-ramp support.
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

## Questions

Open an issue with the `question` label.
