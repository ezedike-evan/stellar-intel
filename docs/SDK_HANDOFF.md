# SDK Handoff: Community Maintainer Model

> **Status: planning (v4).** The `@stellarintel/sdk` (TypeScript),
> `stellar-intel-py` (Python), and `stellar-intel-rs` (Rust) SDKs are v4
> "Universal" deliverables (see [`docs/ROADMAP.md`](ROADMAP.md) and
> [`docs/SDK.md`](SDK.md)). This document defines the maintainer structure so
> the SDKs do not depend solely on the core team once they ship.

**Last reviewed:** 2026-08-26

## Motivation

A community-maintained SDK is more trustworthy and longer-lived than one gated
on a single team. This document establishes who can maintain each SDK, how they
earn that role, and how decisions are made without requiring core-team sign-off
on every PR.

## Maintainer structure

Each SDK has an independent maintainer group:

| SDK                 | Language   | Minimum maintainers | Core-team veto              |
| ------------------- | ---------- | ------------------- | --------------------------- |
| `@stellarintel/sdk` | TypeScript | 2                   | Yes (breaking changes only) |
| `stellar-intel-py`  | Python     | 2                   | Yes (breaking changes only) |
| `stellar-intel-rs`  | Rust       | 2                   | Yes (breaking changes only) |

"Minimum maintainers" is the floor needed before the core team considers a
package handed off. Below that number, the core team remains a required
approver.

## How to become an SDK maintainer

SDK maintainers are drawn from the [`CONTRIBUTOR_LADDER.md`](CONTRIBUTOR_LADDER.md)
Reviewer rung — specifically, Reviewers who have demonstrated sustained
contribution to the SDK package itself (not just the main repo).

Criteria:

- At least 5 merged PRs to the SDK package (fixes, features, or tests).
- At least 3 reviews of other contributors' SDK PRs with substantive feedback.
- Nominated by an existing SDK maintainer or core-team member.
- No blocking objections from existing SDK maintainers within 7 days.

Nominations are opened as GitHub Discussions tagged `governance/sdk-maintainer`.

## Review and merge process

### Routine changes (bug fixes, docs, test improvements)

- Any SDK maintainer may approve and merge without core-team involvement.
- One approval from any maintainer of that SDK is sufficient.
- CI (typecheck, lint, tests) must be green.

### Feature additions

- Two approvals required: one from any SDK maintainer, one from any other
  maintainer or core-team member.
- A 48-hour comment window is observed before merging.

### Breaking changes (semver major)

- Opened as a GitHub Discussion first for community input (72-hour window).
- Two SDK maintainer approvals plus one core-team approval required.
- Core team has veto rights on breaking changes that affect the public API
  contract or the signing/verification semantics.

### Security fixes

- Coordinated via private GitHub Security Advisory (same as the main repo).
- Core team and SDK maintainers are both notified immediately.
- Patch is prepared in a private fork, reviewed by at least one core-team
  member, and released under a coordinated disclosure timeline.

## Release process

SDK releases follow semver. SDK maintainers may cut patch and minor releases
independently. Major releases require the core-team approval described above.

Release steps:

1. Bump version in the package manifest.
2. Update `CHANGELOG.md` in the SDK package.
3. Open a PR tagged `release` — CI must be fully green.
4. One maintainer merges; the merge commit is tagged `sdk-ts/v{semver}`,
   `sdk-py/v{semver}`, or `sdk-rs/v{semver}` respectively.
5. A GitHub Release is created from the tag; the package is published to the
   relevant registry (npm / PyPI / crates.io) via the release CI workflow.

## Maintainer responsibilities

SDK maintainers are expected to:

- Review incoming PRs within 5 business days.
- Keep CI green (fix flakes, update pinned deps promptly).
- Respond to security disclosures within 24 hours.
- Step down (or be replaced) if inactive for 90 days.

Inactivity removal follows the same process as the contributor ladder:
any existing SDK maintainer may open a Discussion to remove an inactive
maintainer; the change takes effect after 7 days with no objection.

## Current status

No community SDK maintainers have been appointed yet. The core team will
begin accepting nominations once the SDKs reach their v4 alpha milestones.
Interested contributors should start by opening PRs against the SDK packages
and building a track record as described above.

## Related

- [`docs/SDK.md`](SDK.md) - planned SDK surface and current HTTP workarounds
- [`docs/ROADMAP.md`](ROADMAP.md) - SDK milestone (v4 Universal)
- [`docs/CONTRIBUTOR_LADDER.md`](CONTRIBUTOR_LADDER.md) - path from contributor
  to maintainer
- [`docs/GOVERNANCE.md`](GOVERNANCE.md) - contract admin multisig governance
