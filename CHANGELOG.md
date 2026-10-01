# Changelog

All notable changes to Stellar Intel are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- **PeraHub** (`perahub`) is registered as a SEP-31-only USDC→PHP anchor (#1303, ANC035). PeraHub (PETNET, Philippines) advertises exactly one transfer server — `DIRECT_PAYMENT_SERVER` at `https://stellar.perahub.com.ph/sep31` — plus SEP-10 and SEP-12, and no SEP-6 or SEP-24, so there is no deposit rail to quote against. The lane is recorded in `sep31Corridors` (never `corridors`), which keeps it out of `SERVED_CORRIDOR_IDS`, out of `VISIBLE_CORRIDORS` and out of every quote path: SEP-31 receiving requires a bilateral sending-anchor agreement we do not have. The new `usdc-php` corridor is defined so the lane resolves for health probes and the survey, and is flagged off in `tests/corridors.coverage.spec.ts`. Facts verified 2026-09-29 against the anchor's own TOML and `GET /sep31/info` (receive USDC, min 0.1, max 1000, fee 5 + 1%, `peso_amount` field; USDC listed under the canonical issuer).
- **KB Trading** (`clpx`, CLPX → CLP, Chile) is registered as a tracked, never-routed anchor (#1304, ANC036). Unlike a SEP-31-only anchor, KB Trading genuinely runs SEP-6 and SEP-24 and genuinely accepts CLPX deposits (`deposit.CLPX` enabled, min 14000, max 3500000), so it is transfer-capable by the registry guard's mechanical test and needed an `ALLOWLIST` entry — the public anchor directory the survey crawls does not list `kbtrading.org` at all. Its withdraw map is `CLPX: { enabled: false }, BTCLN: enabled (lightning)` on both SEP-6 and SEP-24, so no programmatic rail moves CLPX back out to fiat: the only CLPX→CLP path is SEP-31 receive, which is never routed because it needs a bilateral sending-anchor agreement. The new `clpx-clp` corridor is therefore defined (so the lane resolves for health probes and the survey) while the anchor's `corridors` stays empty and the lane lives in `sep31Corridors`, keeping it out of `SERVED_CORRIDOR_IDS`, `VISIBLE_CORRIDORS` and every quote path. Verified 2026-09-29 against the anchor's own TOML, `/sep6/info`, `/sep24/info` and `/sep31/info`; the other TOML assets (XCHF, IDRT, TRYB, XSGD, KRW) are all `status=test` and are deliberately not registered.
- `POST /api/reputation/refresh` now runs `probeAllAnchorSep31` in the probe sweep through a `sep31-info` `DurableProbeStore`, so SEP-31 capability samples are persisted, and reports `sep31Info` in the `probed` counts; `tests/reputation-refresh-sweep.spec.ts` covers the sweep wiring (#1310)
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
