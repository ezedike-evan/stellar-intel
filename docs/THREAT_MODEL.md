# Threat Model

> Adversaries, assets, and mitigations for Stellar Intel. A practical
> walk-through rather than a checkbox exercise — each scenario describes
> the failure mode, the mitigation in our codebase, and the detection
> signal.
>
> If a scenario below is not defended, it is a bug. Open an issue with
> the `security` label.

---

## Table of contents

- [Threat actors](#threat-actors)
- [Assets](#assets)
- [Scenarios](#scenarios)
  - [Anchor failure](#anchor-failure)
  - [MITM on rate fetch](#mitm-on-rate-fetch)
  - [Replay](#replay)
  - [Griefing](#griefing)
  - [Oracle tampering](#oracle-tampering)
  - [Publisher key compromise](#publisher-key-compromise)
  - [Canonicalisation drift](#canonicalisation-drift)
  - [Agent-acting-without-user](#agent-acting-without-user)
  - [Supply-chain compromise](#supply-chain-compromise)
  - [Phishing / clickjacking](#phishing--clickjacking)
- [Not in scope](#not-in-scope)

---

## Threat actors

| Actor                         | Capabilities                                            | Motivation                                |
| ----------------------------- | ------------------------------------------------------- | ----------------------------------------- |
| **Anchor (honest but buggy)** | Operates SEP-24 / 38 endpoints.                         | Normal business.                          |
| **Anchor (adversarial)**      | As above, plus incentive to mis-quote or silently fail. | Preserve margin, avoid disclosure.        |
| **Network attacker**          | Can MITM plaintext, but not TLS-validated endpoints.    | Skim funds, grief users.                  |
| **User-local malware**        | Read browser memory, replace env vars, exfiltrate keys. | Steal funds.                              |
| **Compromised publisher key** | Mint on-chain observations.                             | Inflate / deflate anchor scores.          |
| **Hostile agent**             | Speaks MCP, has a signer.                               | Automate exfiltration, abuse rate limits. |
| **Supply-chain attacker**     | Publish malicious dependency.                           | Persistent foothold.                      |

We assume actors above, **but not** a nation-state with TLS root CA
compromise. If TLS is broken, everyone's threat model is broken.

---

## Assets

Ranked by blast radius:

1. **User funds.** Worst case. Protected by: user key never leaves the
   wallet; intents are scoped by deadline, nonce, and amount ceiling.
2. **Publisher key.** Worst case: mass-forged observations. Protected by:
   HSM in prod; rotation plan; every observation is replayable off-chain
   and can be audited for internal consistency.
3. **Aggregated TrustScore values.** A skewed score mis-routes intents.
   Protected by: on-chain Merkle commitment to input observations;
   deterministic formula; public recomputation from parquet replica.
4. **User KYC data.** We do not hold this. Protected by: architecture;
   the SEP-24 interactive URL is the user→anchor channel, we do not
   proxy it.
5. **Maintainer credentials.** Deploy tokens, npm tokens. Protected by:
   GitHub Actions secrets, least-privilege scoping, rotation checklist
   in `docs/KEY_ROTATION.md`.

---

## Scenarios

### Anchor failure

**Failure.** An anchor mid-flow goes dark — ingests a submitted SEP-24
intent and never reports terminal state.

**Mitigation.**

- `deadline` bounds the wait: after expiry the router writes a
  `failed:deadline` observation and the UI marks the intent failed.
- `fill_rate` component in TrustScore captures the pattern; chronically
  failing anchors rank lower.
- No custody ever held by us means a failed anchor cannot create a stuck
  balance on our side.

**Detection.** Nightly integrity workflow + real-time failed-intent rate
alert (>20% over 1h).

### MITM on rate fetch

**Failure.** Network attacker rewrites a SEP-38 quote to show a worse rate
than the anchor offered, getting the user to sign for less.

**Mitigation.**

- All anchor endpoints are TLS. Our HTTP client rejects non-HTTPS TOML
  entries.
- SEP-38 response inclusion in the signed intent: the net landed value
  **the user signs** is their minimum. A rewrite that changed what they
  sign is cryptographically detectable at submit.
- The minimum-net-landed clause (`minNetLanded`) is checked server-side
  against the live quote before relay to the anchor — the router refuses
  to forward if the live quote dropped below the floor.

**Detection.** `intent.rate_drift` refusals are logged; a sudden spike
pages the oncall.

### Replay

**Failure.** Attacker captures a signed envelope and replays it to force a
second execution.

**Mitigation.**

- `(user, nonce)` uniqueness enforced server-side with a 30-day TTL past
  the intent's `deadline`.
- Nonce is CSPRNG, not derivable. Re-using a nonce is rejected.
- Idempotency is keyed by intent hash so a **legitimate** retry works
  without side effect; a malicious replay with a different signature but
  the same `(user, nonce)` is rejected before reaching the anchor.

**Detection.** Rejections emit `intent.nonce_reused` with the originating
IP, flagged for review if they exceed 1% of daily traffic.

### Griefing

**Failure.** Attacker spams worthless intents or dispute issues to burn
router capacity and muddy the reputation stream.

**Mitigation.**

- Per-IP and per-user rate limits on the router.
- SEP-10 auth requirement for the sign/submit path: every submit costs
  one valid Stellar keypair and an authenticated session.
- Dispute flow requires an authenticated anchor-owned email; spam
  disputes are filtered before the public log.

**Detection.** Burst rate-limit alarms; dispute-rate-per-anchor sanity
checks.

### Oracle tampering

**Failure.** Attacker modifies on-chain observations to inflate or
deflate an anchor's score.

**Mitigation.**

- Soroban storage is tamper-evident; the only write path is via
  whitelisted publisher contracts (see [`ORACLE_SPEC.md`](ORACLE_SPEC.md)
  §publisher whitelist).
- Each aggregate stamps a Merkle root of observations; consumers can
  verify inclusion.
- Off-chain replica (parquet) enables re-computation; drift between
  on-chain aggregates and replica-derived aggregates is a nightly test.

**Detection.** Nightly drift job compares on-chain aggregates vs.
recomputed; any diff opens a tracking issue.

### Publisher key compromise

**Failure.** Publisher private key leaks; attacker mints arbitrary
observations.

**Mitigation.**

- HSM in prod reduces probability.
- `rotate_publisher(old, new)` is atomic; rotation does not lose history.
- Every observation carries `publisher: Address`; post-incident, the
  maintainer can mass-exclude all observations from the compromised
  publisher via `exclude(...)` calls, recomputing aggregates.

**Detection.** Unusual per-publisher write volume; we set a static
expectation of ≤ 3 writes/anchor/minute from each publisher.

### Canonicalisation drift

**Failure.** Two clients canonicalise the same logical intent differently,
producing different hashes. A signature made against one hash fails
against the other; or worse, a user signs a hash they do not believe
they are signing.

**Mitigation.**

- A single implementation in the SDK, imported by every client (web UI,
  MCP server, agents). Canonicalisation logic is not re-implemented
  per-client.
- Golden-vector tests in CI: a fixed corpus of intents produces a fixed
  digest set. Any drift fails CI.
- Spec in [`docs/CANONICAL_JSON.md`](CANONICAL_JSON.md) for implementers
  who cannot depend on the SDK.

**Detection.** CI catches drift at PR time. There is no production
detection because drift is a build-time concern.

### Agent-acting-without-user

**Failure.** An AI agent, given signer access, signs and submits intents
without user awareness.

**Mitigation.**

- Default `signer.kind == "readonly"` on fresh MCP installs.
- `user_attestation_required` handshake between sign and submit for
  agent runtimes signalling unattended operation.
- `deadline ≤ 10min` prevents pre-staking intents to fire later.
- All signed intents logged client-side in
  `~/.local/share/stellarintel/agent-log.ndjson`.

**Detection.** Anomalous pattern of `sign → submit` without the
attestation ACK flags the session.

### Supply-chain compromise

**Failure.** Malicious dependency lands in `package-lock.json` or a
transitive Rust crate.

**Mitigation.**

- Dependency review on PR (severity gate + licence deny list).
- CodeQL SAST on every push.
- Pinned lockfile; `npm ci` in CI.
- SBOM with every release for downstream verification.
- `npm publish --provenance` on our own packages.

**Detection.** GitHub advisory alerts; SBOM diff on release. Contributors
are encouraged to flag unfamiliar additions in reviews.

### Phishing / clickjacking

**Failure.** Attacker site mimics Stellar Intel, tricks the user into
signing an intent with a malicious beneficiary.

**Mitigation.**

- Only the official domain (`stellar-intel.vercel.app` / eventual
  canonical domain) is listed in brand materials.
- `X-Frame-Options: DENY` + `frame-ancestors 'none'` on our app.
- Wallet UIs show the signature target; users should confirm the domain
  on every sign. We surface domain and deadline in the pre-sign UI.

**Detection.** Out of scope for us; users report, we coordinate takedowns
via standard channels.

---

## Not in scope

- **Traffic-flood DoS.** Mitigated by CDN defaults, not by this model.
- **Anchor insolvency.** Not a software threat. Surface financial risk
  through the TrustScore but do not try to prevent it.
- **User-side device compromise.** If the attacker has the user's
  wallet, the user has a bigger problem than us.
- **Social engineering unrelated to our brand.** Out of scope.
