# Changelog

All notable changes to Stellar Intel are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- `/faq` renders `docs/FAQ.md` and emits schema.org `FAQPage` JSON-LD from that file, so editing the markdown updates the markup with no second copy (#1061)
- `lib/api/api-version.ts` / `lib/api/deprecation.ts`: implements the deprecation lifecycle `docs/VERSIONING.md` documented but the code did not (#1150). `SUPPORTED_API_VERSIONS` is now computed from `API_VERSION_HISTORY` (each entry's `supersededAt` plus a 180-day `SUPPORT_WINDOW_DAYS`) instead of a hardcoded array; a pinned version still inside that window gets `Sunset` and `Warning: 299` on every response, stamped from `lib/logger.ts` alongside `API-Version`. New `GET /api/status` publishes `version`, `supported_versions`, and `announced_deprecations`. No version has ever been retired, so `SUPPORTED_API_VERSIONS` still has one element and no live response carries either header today — the mechanism is exercised in `tests/api-version-negotiation.spec.ts` against synthetic history rather than waiting on a real deprecation.
- `packages/python-sdk` (`stellarintel`): Python client generated from `public/openapi.json`, plus a hand-written `StellarIntelClient` wrapper adding per-call `Idempotency-Key` (a fresh UUID4 reused across that call's own retries, so a retry can never execute twice server-side) and backoff retries on 429/5xx that honour `Retry-After`. Ships `python-sdk.yml` (pytest + mypy on 3.11/3.12/3.13) and `publish-python-sdk.yml` (PyPI trusted publishing via OIDC on a `python-sdk-v*` tag — no stored token; needs a maintainer to configure the trusted publisher and the `pypi` environment first). (#821)
- `docs/ROADMAP.md`: new "v6 Ecosystem Infrastructure" section covering the 7 items epic #808 parked (Rust SDK, webhooks, GraphQL, developer portal, multi-corridor oracle v2, on-chain savings oracle, versioning policy, decentralization), each linked to its now-filed child issue (#868-#875). #808 cited a "Horizon 3" section that no longer exists in the roadmap after it moved from an H1/H2/H3 structure to the current v1-v5 wave structure; this section reconciles that drift instead of leaving the epic pointing at removed content.
- `isIndicativeRateSource` (`types/index.ts`): generalizes the firm-vs-estimate distinction already present on `AnchorRate.source`, so any anchor whose only integration is SEP-6 (or the SEP-24 `/fee` fallback) is labeled indicative in the UI — not just Cowrie, the anchor that surfaced the gap (#802)
- `RateTable`: the "Best Rate" badge now shows a "based on an indicative rate" caveat when the winning rate is not a firm SEP-38 quote (#802)
- `Leaderboard`: rows now render the `QuotePill` firm/indicative badge, matching `RateTable` (#802)
- Hardened the unversioned `POST /api/intent/offramp` (#805) to match the guarantees the public `/api/v1` surface already makes: `Idempotency-Key` header support (24h replay window, only for deterministic 200/400 outcomes), `X-RateLimit-Limit`/`X-RateLimit-Remaining`/`X-RateLimit-Reset` headers on every response, an `API-Version` header, and a unified `ApiError` envelope for the previously ad hoc 429 body. New `lib/api/idempotency.ts` and `lib/api/response.ts`.
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
