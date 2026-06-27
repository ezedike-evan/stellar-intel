# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities. Email the
maintainer privately and allow a reasonable window for a fix before disclosure:

- **Contact:** open a [GitHub security advisory](https://github.com/Ezedike-Evan/stellar-intel/security/advisories/new)
  (preferred), or email the maintainer listed on the GitHub profile.

We honour responsible disclosure and will credit reporters in the release notes
unless you prefer to remain anonymous.

## Supported versions

The `main` branch is the supported surface. There is no LTS branch yet.

## Custody boundary

Stellar Intel is non-custodial: no user funds, no user keys, no fiat, no KYC data.
See [`docs/NON_CUSTODY.md`](NON_CUSTODY.md). The largest class of "security" risk
for users — losing funds — is structurally out of scope because we never hold them.

## Key & secret handling

- **No user keys.** Signing is in the user's wallet (Freighter). Intents are
  Ed25519-signed client-side; the server only verifies signatures
  ([`docs/INTENT_API.md`](INTENT_API.md)).
- **`ADMIN_SECRET_KEY`** gates `/admin/disputes` and admin reputation routes. Keep
  it server-side only; never expose it to the client (it is **not** a
  `NEXT_PUBLIC_*` var). See `lib/config.ts` for env validation.
- **Publisher keys** (Soroban oracle) are server-held and never shipped to the
  browser. Rotation policy is a roadmap item ([`docs/ROADMAP.md`](ROADMAP.md)).

## Network & data integrity

- **SEP-10** authentication asserts the mainnet network passphrase before signing a
  challenge (`lib/stellar/sep10.ts`), preventing cross-network challenge replay.
- **Anchor calls run server-side** (e.g. `/api/rates/[corridor]`) so third-party
  anchor responses never execute with the user's origin/credentials.
- **No fabricated rates.** A failed anchor renders as unavailable; the codebase and
  PR template forbid stub/placeholder rates.
- **Replay protection** on signed intents (`lib/intent/replay.ts`).

## Supply chain

- Dependencies are watched by Dependabot (`.github/dependabot.yml`) and reviewed in
  CI (`dependency-review.yml`), with CodeQL scanning (`codeql.yml`).
- An SBOM-on-release process is a roadmap item (v5).

## Related

- [`docs/THREAT_MODEL.md`](THREAT_MODEL.md) — adversaries and mitigations.
- [`docs/NON_CUSTODY.md`](NON_CUSTODY.md) — the custody boundary in detail.
