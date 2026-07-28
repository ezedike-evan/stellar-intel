# Changelog

All notable changes to Stellar Intel are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- `isIndicativeRateSource` (`types/index.ts`): generalizes the firm-vs-estimate distinction already present on `AnchorRate.source`, so any anchor whose only integration is SEP-6 (or the SEP-24 `/fee` fallback) is labeled indicative in the UI — not just Cowrie, the anchor that surfaced the gap (#802)
- `RateTable`: the "Best Rate" badge now shows a "based on an indicative rate" caveat when the winning rate is not a firm SEP-38 quote (#802)
- `Leaderboard`: rows now render the `QuotePill` firm/indicative badge, matching `RateTable` (#802)
- `StatusTracker`: when `stellar_transaction_id` is a valid 64-char hex, render a link to `{STELLAR_EXPERT_URL}/tx/{id}` opening in a new tab (`target="_blank" rel="noopener noreferrer"`) ([#47](https://github.com/Ezedike-Evan/stellar-intel/issues/47))
- `lib/reporter`: pluggable error reporter with noop default; wire via `configureReporter()` at app startup (#184)

### Changed

- Homepage hero reframed to execution-layer positioning: badge, heading, subcopy, module heading, and off-ramp card description updated (#100)
- Consolidated duplicated helpers: single `sleep` (`lib/utils`), single `fetchWithTimeout` (`lib/stellar/http`), and shared validation patterns (`lib/patterns`) replacing scattered pubkey/amount regex literals.
- Docs re-synced with the code: `@stellar/stellar-sdk` v16, `NEXT_PUBLIC_APP_NAME` documented as required, `.env.example` completed with all read env vars, MCP install instructions corrected, anchor-onboarding path fixed to `constants/anchors.ts`, and the reputation composite formula in `docs/ANCHOR_REPUTATION.md` corrected to match `lib/reputation/composite.ts`.

### Fixed

- `QuotePill`: the `sep6-fee` badge visibly read "SEP-6" with no indication it was an estimate, unlike the `sep6-info` badge's "Indicative (SEP-6)" — both are now labeled "Indicative (SEP-6)" so a SEP-6 rate is never mistaken for a firm quote (#802)
- Stellar public-key validation now uses the correct base32 alphabet (`G[A-Z2-7]{55}`), rejecting keys containing `0`, `1`, `8`, or `9` that the previous `[A-Z0-9]` pattern wrongly accepted.
- `NEXT_PUBLIC_INTENT_FLOW` no longer had two flag accessors with opposite defaults; `lib/flags.ts` now exposes a single accessor (intent flow OFF unless explicitly `"true"`).

### Removed

- Deleted zero-reference orphan components/hooks (`Navbar`, `FreshnessPill`, `CountrySelector`, `CurrencySelector`, `TrustBar`, `useFlag`, `useToast`), the deprecated/banned `lib/stellar/estimatedRates.ts`, unwired scripts (`scripts/emit-version.ts`, `scripts/run-release-tests.js`), and unused named exports across `constants/`, `types/`, `lib/config`, `lib/logger`, and `lib/reputation`.

[Unreleased]: https://github.com/Ezedike-Evan/stellar-intel/commits/main
