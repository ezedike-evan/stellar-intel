# Changelog

All notable changes to Stellar Intel are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- `StatusTracker`: when `stellar_transaction_id` is a valid 64-char hex, render a link to `{STELLAR_EXPERT_URL}/tx/{id}` opening in a new tab (`target="_blank" rel="noopener noreferrer"`) ([#47](https://github.com/Ezedike-Evan/stellar-intel/issues/47))
- `lib/reporter`: pluggable error reporter with noop default; wire via `configureReporter()` at app startup (#184)

[Unreleased]: https://github.com/Ezedike-Evan/stellar-intel/commits/main
