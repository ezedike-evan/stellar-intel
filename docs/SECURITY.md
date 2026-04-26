# Security

> How Stellar Intel is designed to be secure, what we promise, what we
> will never do, and how to report a vulnerability.

---

## Table of contents

- [Non-custodial guarantee](#non-custodial-guarantee)
- [What we never hold](#what-we-never-hold)
- [Key-handling policy](#key-handling-policy)
- [Intent-signing scope](#intent-signing-scope)
- [Supply-chain policy](#supply-chain-policy)
- [Disclosure](#disclosure)
- [Scope](#scope)
- [Hall of fame](#hall-of-fame)

---

## Non-custodial guarantee

Stellar Intel **never takes custody** of user funds, at any point, in any
flow. Custody is held by the anchor under SEP-24 for the duration the
anchor is executing the off-ramp leg — not by us.

Every leg of every intent is signed by the user from their own wallet.
We route, we rank, we observe, we score. We do not move money.

If at any point you find a code path that could take custody, that is a
P0 vulnerability. Report privately (below); do not open a public issue.

---

## What we never hold

- **User secret keys.** Never touched by any Stellar Intel process, server,
  or worker. All signing happens in the user's wallet (Freighter,
  hardware wallet, CLI keypair).
- **KYC documents.** KYC occurs between the user and the anchor via
  SEP-24's interactive URL. We do not proxy, cache, or log this data.
- **User funds.** See above.
- **Settlement instructions beyond what SEP-24 already embeds.** We do
  not forward, store, or replay bank-side settlement data.

If the product's data flow diagram shows one of the above passing
through us, the diagram is wrong. Correct the diagram.

---

## Key-handling policy

**Publisher keys.** The oracle's write path uses a publisher keypair
owned by the router. It is held in an HSM in production; dev uses an
env-var keypair. Rotation plan lives in
[`docs/KEY_ROTATION.md`](KEY_ROTATION.md).

**Deploy keys.** CI deploys use scoped tokens stored in GitHub Actions
secrets. Tokens have the minimum required scope:

- Vercel token: deploy to one project.
- npm token: publish to the `@stellarintel` scope.
- Codecov token: upload coverage.

**No long-lived user tokens in environment.** SEP-10 auth tokens live in
the user's session (localStorage with strict same-origin reads) and
expire in 24h.

**Contributor signing key.** Maintainers sign commits with GPG/SSH
keys registered with GitHub. See
[`docs/SIGNED_COMMITS.md`](SIGNED_COMMITS.md).

---

## Intent-signing scope

A signature is scoped to exactly one intent. It cannot be replayed,
broadened, or combined with another signature.

Mechanism:

1. **Domain separator.** Every signature covers `domain_separator || hash(canonicalIntent)`
   where the domain separator is `b"STELLAR_INTEL_INTENT_V1\0"`. This
   prevents any signature from being valid in another protocol, or
   another version of this protocol.
2. **Deadline ceiling.** Intents expire at most 10 minutes after
   `createdAt`. The server enforces this on submit.
3. **Nonce.** 128-bit CSPRNG nonce per intent. Replayed nonces are
   rejected even if the intent hash differs.
4. **Canonicalisation.** See
   [`docs/CANONICAL_JSON.md`](CANONICAL_JSON.md). The digest is stable
   across clients. A signature binds to the exact canonical form.

The signature is **not** a blanket authorisation. It authorises the
specific `{user, nonce, asset, amount, beneficiary, deadline}` tuple.

---

## Supply-chain policy

- **Dependency review on every PR.** `.github/workflows/dependency-review.yml`
  fails the build on: moderate-or-higher CVEs, new GPL/AGPL dependencies,
  or new dependencies with unknown licences.
- **Dependabot** raises weekly PRs for npm, GitHub Actions, and (eventual)
  Cargo updates. See [`.github/dependabot.yml`](../.github/dependabot.yml).
- **CodeQL** runs security-extended + security-and-quality queries on
  every push and nightly. See
  [`.github/workflows/codeql.yml`](../.github/workflows/codeql.yml).
- **SBOM**: every release ships a CycloneDX SBOM attached to the GitHub
  release artefacts. See [`docs/SBOM.md`](SBOM.md) (v2).
- **No transitive upgrade without review.** We pin direct dependencies;
  Dependabot PRs still require a human review.
- **No postinstall scripts** in published packages. The SDK and MCP
  server both build with `"scripts":{}` on publish.
- **Provenance.** Published npm packages carry `npm publish --provenance`
  so consumers can verify the artefact came from this repo's CI.

---

## Disclosure

**Do not open a public issue for a suspected vulnerability.**

Preferred channel: **GitHub Security Advisory** (private).

→ [Report via a private advisory](https://github.com/Ezedike-Evan/stellar-intel/security/advisories/new)

Alternative channel: `security@stellarintel.xyz`. PGP key fingerprint:

```
(placeholder — rotate before v1.3; publish fingerprint in .github/SECURITY.md)
```

What to include in a report:

- Affected component (web, API, MCP, SDK, contract, CI).
- Version or commit SHA.
- Proof-of-concept (minimum exploitable path).
- Expected vs. observed behaviour.
- Your disclosure timeline — we default to 90 days, negotiable.

We commit to:

- **Acknowledge within 48 hours.** Within 24 for P0.
- **Triage within 7 days** with a severity assignment and a target fix
  date.
- **Credit you publicly** in the hall of fame and in the release notes,
  unless you request anonymity.

We honor **responsible disclosure**. If you act in good faith within
this policy, we will not pursue legal action.

---

## Scope

**In scope**

- All code in this repository, including CI workflows.
- The deployed app at `stellar-intel.vercel.app`.
- The Soroban reputation oracle contract (once deployed, contract IDs
  listed in [`docs/DEPLOYMENTS.md`](DEPLOYMENTS.md)).
- Published packages: `@stellarintel/sdk`, `@stellarintel/mcp`.

**Out of scope**

- Third-party anchor implementations. Report to the anchor directly.
- Stellar Core / Horizon. Report to the Stellar Development Foundation.
- Denial-of-service via traffic floods.
- Issues requiring physical access to the user's device.
- Phishing unrelated to our brand assets.

---

## Hall of fame

Researchers who have reported valid vulnerabilities:

| Date                     | Researcher | Severity | Summary |
| ------------------------ | ---------- | -------- | ------- |
| _(empty — be the first)_ |

If you would like to help without finding a vulnerability, see the
[good-first-issue board](../.github/OSS_WEEK_CONTRIBUTOR_BOARD.md).
