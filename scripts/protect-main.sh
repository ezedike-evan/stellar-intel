#!/usr/bin/env bash
# scripts/protect-main.sh
#
# Apply the Stellar Intel branch-protection policy to `main`.
# Idempotent: re-running updates the existing ruleset.
#
# Required status checks match the job names in .github/workflows/ci.yml and
# peer workflows. Update this list whenever a new required check is added.

set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI is required." >&2
  exit 2
fi

REPO="${REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
BRANCH="${BRANCH:-main}"

echo "Applying branch protection to ${REPO}@${BRANCH}"

gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  "repos/${REPO}/branches/${BRANCH}/protection" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "check (node 20)",
      "check (node 22)",
      "build (node 20)",
      "Analyze (javascript-typescript)",
      "lint-pr-title",
      "commitlint",
      "dependency-review"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "require_code_owner_reviews": true,
    "dismiss_stale_reviews": true
  },
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true,
  "restrictions": null
}
JSON

echo "Done. Verify: gh api repos/${REPO}/branches/${BRANCH}/protection"
