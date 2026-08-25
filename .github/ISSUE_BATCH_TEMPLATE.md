# Issue batch — <name>

> Copy this file to author a batch of issues, file it with
> `node scripts/create-issues.mjs <this-file>`, then delete your copy.
> The catalog is scaffolding, not a record: once the issues exist on GitHub,
> GitHub is the record.

## Why this exists

The issue forms in `.github/ISSUE_TEMPLATE/` are for someone filing **one**
issue through the GitHub UI. They are the wrong tool for a maintainer planning
thirty at once, which is why `issues-ui.md`, `issues-batch-2.md` and `issue.md`
grew as one-off documents, each with its own bespoke filing script.

This is the shared format those files should have used. One template, one
filer, and the working copy is disposable.

## Format

Blocks are separated by a line containing only `---`. Everything between the
header line and `Labels:` becomes the issue body verbatim, so write it as you
want it to read on GitHub.

```
#B001 [FEAT] [UI] Short imperative title
Description
One or two sentences on the problem. Lead with what is wrong or missing,
not with the solution.
Requirements

- The specific, checkable things that must be true.
- Name real files and symbols so a contributor can start without asking.

Acceptance Criteria

- How a reviewer knows it is done.

Estimated File Changes: 2 (app/sitemap.ts, tests/sitemap.spec.ts)
Labels: feature, module/ui, size/s, difficulty/good-first-issue
Milestone: v1.3
```

### Header line

`#<ID> [TYPE] [SCOPE] <title>`

- **ID** — any prefix plus digits, unique within the batch: `B001`, `C042`, `SEO7`.
  It is used for `--only` selection and is recorded in the filed issue's footer.
- **TYPE** — `FEAT`, `BUG`, `CHORE`, `DOCS`, `TEST`, `REFACTOR`, `GOOD-FIRST-ISSUE`.
  Matches the `title:` prefixes in `.github/ISSUE_TEMPLATE/*.yml`.
- **SCOPE** — the Conventional-Commits scope the eventual PR will use. Must be
  in the `scope-enum` in `commitlint.config.mjs`, or `commitlint` rejects the PR.

### Required and optional lines

| Line                      | Required | Notes                                                                                                              |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `Labels:`                 | yes      | Comma-separated. Every label must already exist — the filer refuses unknown labels rather than creating grey ones. |
| `Milestone:`              | no       | Omit the line entirely if the batch is not milestoned.                                                             |
| `Estimated File Changes:` | no       | Free text. Kept in the body; helps sizing during triage.                                                           |

### Labels worth using

Pick one from each axis where it applies. `.github/labels.yml` is the source of
truth; `label-sync.yml` applies it.

- **kind** — `bug`, `feature`, `chore`, `docs`, `test`, `refactor`, `security`
- **module** — `module/ui`, `module/api`, `module/mcp`, `module/ops`,
  `module/e2e`, `module/reputation`, `module/router`, `module/anchors`,
  `module/offramp`, `module/onramp`, `module/seo`, and the `module/sepNN` family
- **size** — `size/xs`, `size/s`, `size/m`, `size/l`, `size/xl`
- **difficulty** — `difficulty/good-first-issue`, `difficulty/intermediate`, `difficulty/hard`
- **epic** — `epic/ui`, `epic/agents`, `epic/reputation`, `epic/docs-community`, …

## Filing

```bash
node scripts/create-issues.mjs my-batch.md              # dry run, prints what it would do
node scripts/create-issues.mjs my-batch.md --apply
node scripts/create-issues.mjs my-batch.md --apply --only B001,B004
node scripts/create-issues.mjs my-batch.md --apply --repo owner/name
```

Filing is idempotent: a block whose exact title already exists is skipped, so
re-running after a partial failure is safe.

## Writing issues people actually pick up

- **One issue, one PR.** `one-issue-per-pr.yml` enforces a single closing
  keyword, so a block that needs two PRs should be two blocks.
- **Name the files.** "Update the sitemap" gets questions;
  "`app/sitemap.ts` is missing ten URLs, listed below" gets a PR.
- **Say what done looks like.** A contributor cannot self-review against taste.
- **Say what is out of scope**, especially on anything touching the offramp
  path or the oracle, where scope creep is expensive to review.
- **If the tests come before the feature, say so in the body** — otherwise the
  first PR asks where the endpoint went.
