# Changelog

All notable changes to Stellar Intel are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [0.1.0] — 2026-04-13

### Added

- Next.js 16 / React 19 / TypeScript project scaffold
- Off-ramp module — compare USDC withdrawal rates across Stellar anchors by country
- On-ramp module — compare USDC deposit fees per anchor per corridor
- Yield module — compare APYs across Blend, DeFindex, BENJI, and USDY
- Swap module — compare routes across SDEX, Soroswap, Phoenix, and Aquarius
- SDEX swap routing via Horizon `strict-send` path query (live implementation)
- Anchor constants for Cowrie (NG), Flutterwave (NG/KE/GH), Bitso (MX/BR), MyChoice (PH), Tempo (DE)
- Country support for Nigeria, Kenya, Ghana, Philippines, Mexico, Brazil, Germany
- `computeTotalReceived` fee formula for accurate anchor value comparison
- SWR-based data fetching hooks: `useAnchorRates`, `useSwapRoutes`, `useYieldRates`
- Dark/light theme with `useTheme` hook
- Tailwind CSS v4 styling
- `NEXT_PUBLIC_STELLAR_NETWORK`, `NEXT_PUBLIC_HORIZON_URL`, `NEXT_PUBLIC_STELLAR_EXPERT_URL` environment variable support
- MIT License
- `CONTRIBUTING.md` with development setup, code standards, and anchor integration guide
- `CODE_OF_CONDUCT.md` — Contributor Covenant v2.1

[Unreleased]: https://github.com/your-org/stellar-intel/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/your-org/stellar-intel/releases/tag/v0.1.0
