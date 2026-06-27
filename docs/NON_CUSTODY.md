# Non-Custody Manifesto

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

## What we do hold

- Public, non-sensitive data: anchor outcomes (fill rate, slippage, settle latency)
  and their public reputation scores.
- Server-side config (`ADMIN_SECRET_KEY` for admin routes; see
  [`docs/SECURITY.md`](SECURITY.md)).

## Related

- [`docs/SECURITY.md`](SECURITY.md) — disclosure + key handling.
- [`docs/JURISDICTIONAL.md`](JURISDICTIONAL.md) — why this is not money transmission.
