<!--
Thanks for opening a PR!

Before you submit:
  • Conventional Commits title — the PR title is linted (feat / fix / docs /
    refactor / test / chore / ci / perf / build / style / revert, with an
    optional scope and a short description). See .github/workflows/pr-title.yml.
  • One logical change per PR. If you have an unrelated cleanup, split it.
  • Fill in every section below. Delete none of them — leave "N/A" if a
    section genuinely doesn't apply and say *why*.
-->

## Summary

<!--
One or two sentences on **what changed and why**. Lead with the why.
Well-named identifiers already explain the what — don't restate the diff.
-->

## Linked issue

<!--
Every PR must link an issue. Use a closing keyword (Closes / Fixes /
Resolves) so the issue auto-closes on merge. If the work spans multiple
issues, close the primary and reference the others.

If there is genuinely no issue (e.g. typo fix, chore), say so here and
name the reason.
-->

Closes #

## Changes

<!--
A tight bullet list of the material changes. Not a diff summary — a
reader-oriented explanation. Reference files with backticks, reference
symbols with file_path:line_number when it helps.

Example:
  - `lib/stellar/sep10.ts:54` — assert mainnet network passphrase at parse time
  - `components/offramp/ExecuteDrawer.tsx` — propagate `{ transactionId, jwt }`
    to the page on success so `StatusTracker` mounts (fixes #002)
-->

-
-
-

## Testing notes

<!--
What you ran locally, what you added, and what a reviewer should run to
reproduce. At minimum:

  - The name of the new test(s), with file path.
  - The command(s) you ran (`npm run test -- stellar/sep10`, etc).
  - Any manual verification steps — especially if this touches a real
    anchor, a real Stellar transaction, or Freighter.

If you did not add a test, justify it. "Trivial refactor" or "doc-only" are
valid. "Hard to test" is not.
-->

**Automated**
- `npm run typecheck` · ⏳ not run / ✅ green / ❌ failing
- `npm run lint` · ⏳ not run / ✅ green / ❌ failing
- `npm run test` · ⏳ not run / ✅ green / ❌ failing
- `npm run build` · ⏳ not run / ✅ green / ❌ failing

**New / modified tests**
-

**Manual verification** (if applicable)
<!-- e.g. "Connected Freighter on mainnet, executed USDC→NGN for $5 via
MoneyGram testnet deployment, observed StatusTracker reach `completed` in
3m12s. Stellar Expert link: …" -->
-

## Screenshots / recordings

<!--
REQUIRED for any user-visible change. Drop in:
  - Before + After screenshots for UI diffs.
  - A short Loom or a <30s GIF for flow changes (drawer, tracker, drawer-
    to-tracker hoist, split routing visualisation).
  - Relevant terminal output for CLI / API changes.

For pure backend / doc / CI PRs, write "N/A — no user-visible change".
-->

| Before | After |
| --- | --- |
|  |  |

## Checklist

<!--
Every box must be ticked or explicitly "N/A — why". A reviewer will not
merge a PR with an unaddressed box.
-->

**Correctness**
- [ ] The PR title follows Conventional Commits (auto-linted)
- [ ] One logical change; unrelated cleanup was split into a separate PR
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes with **zero new warnings** (we run `--max-warnings 0` in CI)
- [ ] `npm run test` passes; new behaviour has a test
- [ ] `npm run build` passes

**Data integrity**
- [ ] No fabricated rates, stub prices, or placeholder exchange rates (see [`issue.md #005`](../issue.md))
- [ ] No `isMock`, `// MOCK`, `// TODO: replace with real data`, or commented-out real code
- [ ] If touching an anchor: the anchor's `stellar.toml` is publicly resolvable at `https://{domain}/.well-known/stellar.toml` and contains `TRANSFER_SERVER_SEP0024`
- [ ] If touching SEP-10: network passphrase assertion is intact (mainnet only)
- [ ] If touching SEP-24: the 10s `AbortController` timeout is intact on anchor fetches
- [ ] If touching the status poll: terminal states (`completed | refunded | error`) still stop the SWR loop

**Security & non-custody** (see [`docs/NON_CUSTODY.md`](../docs/NON_CUSTODY.md) once it lands)
- [ ] No new code path holds user keys, user funds, or long-lived anchor JWTs
- [ ] Every signing action is performed by the user's wallet (Freighter today)
- [ ] No secrets committed; `.env.local` is unchanged; new env vars are added to `.env.example`

**Docs**
- [ ] User-facing behaviour change → `CHANGELOG.md` entry under `[Unreleased]`
- [ ] API / schema change → relevant `docs/*.md` updated in the same PR
- [ ] Architecture change → [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) updated (file map, diagram, or invariants as applicable)
- [ ] Public-facing feature → screenshot added to `docs/showcase/images/` when relevant
- [ ] New env var → `.env.example` + README env table updated

**Release hygiene**
- [ ] If this touches a wave deliverable, the matching `[ ]` in [`docs/ROADMAP.md`](../docs/ROADMAP.md) is updated
- [ ] No dependency added without justification in the PR description
- [ ] No breaking change hidden inside a non-breaking commit

## Breaking changes

<!--
If this PR breaks a public API, the MCP surface, an env var contract,
or a shipped UI URL, say so here with:
  - What breaks.
  - Who is affected.
  - The migration path (code snippet or doc link).

Also prefix the PR title with "!" (e.g. `feat!: remove legacy rate endpoint`)
to make the break visible to release tooling.

If none: write "None."
-->

None.

## For reviewers

<!--
Optional. Use this to call out:
  - Areas where you want a careful read ("look at the quote-expiry math").
  - Tradeoffs you considered and rejected ("chose SWR over a manual poll
    because …").
  - Things you explicitly did NOT do in this PR and are leaving for a
    follow-up (link the follow-up issue).
-->

<!--
One last thing: this PR template is part of the product. If any section
above feels wrong or missing, open a PR against `.github/PULL_REQUEST_TEMPLATE.md`
itself — meta-PRs are welcome.
-->
