# Non-Custody Manifesto

**Last reviewed:** 2026-08-26

Stellar Intel is **non-custodial by construction**. This is an architectural
property, not a policy promise — the system has no code path that could take
custody.

## What Stellar Intel never holds

- **User funds.** USDC never passes through our accounts. The user signs a Stellar
  transaction in their own wallet (Freighter); the asset moves from the user
  directly to the anchor.
- **User keys.** We never see, request, or store a private key. Signing happens in
  the wallet extension. Intents are signed client-side (Ed25519 via Freighter) and
  we only ever receive the signed envelope (see [`docs/INTENT_API.md`](INTENT_API.md)).
- **Fiat / settlement.** The anchor settles fiat to the beneficiary under its own
  SEP-24 / SEP-6 flow. We are not in the settlement path.
- **KYC data.** KYC is collected by the anchor (anchor-hosted SEP-24 interactive
  flow, or the anchor's SEP-12 customer API). We do not store KYC fields.

## How the boundary is enforced

1. Every leg of an off-ramp is **signed by the user**.
2. The **anchor takes custody** under the relevant SEP.
3. **Stellar enforces atomicity** at the ledger level.

There is no wallet we control in the value path, no held key, and no autonomous
spend — including from the [MCP agent surface](MCP.md), where every executing call
must be signed by the user's wallet.

`tests/custody-boundary.spec.ts` gates this in CI: it fails if anything under
`lib/` or `app/` ever constructs a Stellar signer from a raw secret, or if the
client-facing env schema ever declares a variable that looks like one.
`packages/publisher`'s own signing key (`PUBLISHER_SECRET`, below) is the one
named exemption.

One API route produces a signature: `POST /api/sep10/client-domain` co-signs the
`client_domain` operation of a SEP-10 challenge with the server's own
`client_domain` key (`CLIENT_DOMAIN_SIGNING_SECRET`). This is not custody: the
key is never a user's, and the envelope is a sequence-0 authentication challenge
that can never be submitted to the ledger, so no funds can move. The route
re-runs full SEP-10 validation and signs only when the challenge carries exactly
one `client_domain` operation naming our domain and sourced by our key, so it can
never act as a general-purpose signing oracle. It is the single named exemption
in the "no API route handler signs a transaction" guard.

## What we do hold

- Public, non-sensitive data: anchor outcomes (fill rate, slippage, settle latency)
  and their public reputation scores.
- Server-side config (`ADMIN_SECRET_KEY` for admin routes; see
  [`docs/SECURITY.md`](SECURITY.md)).

## Related

- [`docs/SECURITY.md`](SECURITY.md) — disclosure + key handling.
- [`docs/JURISDICTIONAL.md`](JURISDICTIONAL.md) — why this is not money transmission.
