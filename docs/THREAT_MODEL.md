# Threat Model

Scope: the Stellar Intel web app, its API, the intent flow, the reputation store,
and the Soroban oracle. Out of scope by construction: theft of user funds or keys —
the system is [non-custodial](NON_CUSTODY.md) and never holds either.

| Threat                           | Vector                                               | Mitigation                                                                                                                                                                                    |
| -------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Anchor failure / silent drop** | Anchor accepts a withdraw then never settles         | Per-anchor outcomes feed the reputation score (fill rate); failing anchors rank down. Failed quotes render as unavailable, never as a zero/fabricated rate. Nightly `data-health` validation. |
| **MITM on anchor traffic**       | Tampered `stellar.toml` or quote in transit          | TLS to anchor domains; anchor calls run server-side; SEP-10 asserts the network passphrase before signing.                                                                                    |
| **Intent replay**                | Re-submitting a previously-signed envelope           | `lib/intent/replay.ts` treats each signed envelope as single-use; server recomputes the canonical hash and verifies the signature.                                                            |
| **Intent tampering**             | Altering amount/anchor after signing                 | Server recomputes SHA-256 over the canonical intent and verifies the Ed25519 signature; `publicKey` must match. Any change invalidates the signature.                                         |
| **Reputation poisoning**         | Forged or spam outcomes to skew scores               | Outcomes are signed and replayable; disputes resolve on evidence. On-chain writes gated by `require_admin` / publisher whitelist.                                                             |
| **Oracle tampering**             | Unauthorized contract writes                         | Soroban `require_admin` gate on `submit_outcome` / `register`; multi-signer admin + time-locked upgrade are roadmap hardening.                                                                |
| **Admin-route abuse**            | Hitting `/admin/disputes` or admin reputation routes | Gated by server-only `ADMIN_SECRET_KEY` (not a `NEXT_PUBLIC_*` var).                                                                                                                          |
| **Agent misuse**                 | An AI agent tries to drain a wallet via MCP          | MCP surface is advisory + user-signed: every executing call must be signed by the user's wallet. No held keys, no autonomous spend.                                                           |
| **Griefing / DoS on rates**      | Hammering `/api/rates` or anchors                    | Per-anchor timeouts + isolation (`server-rates.ts`); API rate limiting (`lib/api/rate-limit.ts`).                                                                                             |
| **Supply-chain compromise**      | Malicious dependency                                 | Dependabot + `dependency-review` + CodeQL; SBOM on release (roadmap).                                                                                                                         |
| **Publisher key compromise**     | Stolen Soroban publisher key                         | Server-held keys; rotation ceremony documented (roadmap).                                                                                                                                     |

## Review cadence

This model is reviewed when the architecture changes materially (new SEP, new
write path, new admin surface) and at each major release gate. An annual external
red-team exercise is a v5 roadmap item.

## Related

- [`docs/SECURITY.md`](SECURITY.md) · [`docs/NON_CUSTODY.md`](NON_CUSTODY.md) ·
  [`docs/ORACLE_SPEC.md`](ORACLE_SPEC.md)
