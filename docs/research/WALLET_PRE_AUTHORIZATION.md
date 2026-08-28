# Wallet Pre-Authorization Standards for Recurring Intents

**Last reviewed:** 2026-08-26

**Status:** Research / recommendation  
**Context:** Primitive IV — Recurring intents (epic [#807](https://github.com/ezedike-evan/stellar-intel/issues/807))  
**Date:** 2026-07-28

---

## 1. Problem

Recurring intents require a user to authorise a repeating off-ramp (e.g. "$100 USDC → NGN every month") without re-signing each execution. Today every intent requires an interactive Freighter Ed25519 signature. To support recurring execution the wallet must offer a pre-authorisation mechanism — a way to grant a one-time permission that covers future signed intents within a policy window.

---

## 2. Survey of existing mechanisms

### 2.1 Stellar Core — pre-authorized transactions (`timeBounds` + `minLedger` / `maxLedger`)

The Stellar network itself supports a limited pre-authorisation concept via:

- **`timeBounds`** on a `Transaction` — the transaction is only valid within a window (`minTime` / `maxTime`). The user signs once; the signed blob can be submitted any time within the window.
- **`minLedger` / `maxLedger`** — ledger-based bounds.

**Limitation for recurring intents:** This works for a _single_ future execution, not an open-ended recurring series. The user must pre-compute and sign every occurrence, which defeats the purpose.

### 2.2 Soroban smart-wallet signer policies

Soroban smart contracts enable custom account contracts (smart wallets) that can enforce arbitrary signer policies:

- **Threshold-based multi-sig** — require M-of-N signatures.
- **Time-locked signers** — a signer whose weight only counts during a specified ledger range.
- **Hash-preimage signers** — reveal a secret to authorise.
- **Sponsored transactions / fee-bumping** — a third party can pay fees for a pre-authorised transaction.

**Relevant standard:** [SEP-41](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md) (Soroban Smart Wallet Standard) defines a baseline interface for smart wallets, including `__check_auth` and signer introspection.

**Limitation:** SEP-41 is still a draft. No mainstream wallet (Freighter, Lobstr) exposes a UI for configuring custom signer policies today. Adoption requires:

1. The ecosystem to converge on SEP-41 (or an equivalent).
2. Wallets to implement a policy-configuration UI.
3. A relayer / keeper network to submit the recurring intents on schedule.

### 2.3 SEP-10 (Stellar Web Auth) + JWT session tokens

SEP-10 provides a challenge–response authentication flow that yields a time-limited JWT. This is already used by Stellar Intel for anchor sessions.

**Relevance:** A recurring intent could piggyback on SEP-10:

- The user authenticates once via Freighter (SEP-10 challenge).
- The server issues a long-lived JWT (or a refresh token) scoped to a specific recurring intent policy.
- The server can then sign repeat intents on the user's behalf within the JWT's scope.

**Limitation:** This deviates from the non-custodial principle — the server holds a token that authorises recurring actions. The JWT must be carefully scoped (specific corridor, max amount, expiry) and stored encrypted. This is _pragmatic_ but not _pure_ self-custody.

### 2.4 Off-chain signature delegation (EIP-2612 / permit style)

In EVM land, ERC-2612 (permit) allows a user to sign a structured message off-chain that grants a spender allowance. The analogue in Stellar/Soroban would be:

- A Soroban contract that accepts a signed "permit" message.
- The permit encodes the spender, amount, deadline, and a nonce.
- The contract verifies the Ed25519 signature and updates internal allowance state.

This is not standardised for Stellar today but is _buildable_ as a custom Soroban contract.

---

## 3. Wallet support matrix

| Wallet           | SEP-10 support | Smart wallet (SEP-41) | Pre-auth txn UI | Recurring / policy UI | Notes                                                                                 |
| ---------------- | -------------- | --------------------- | --------------- | --------------------- | ------------------------------------------------------------------------------------- |
| **Freighter**    | ✅ Full        | ❌ Not exposed        | ❌ No UI        | ❌ No UI              | Active development on Soroban support; policy UI is on their roadmap but unscheduled. |
| **Lobstr**       | ✅ Full        | ❌ Not exposed        | ❌ No UI        | ❌ No UI              | Vault feature supports time-locked transactions but not recurring policies.           |
| **xBull**        | ✅ Full        | ❌ Not exposed        | ❌ No UI        | ❌ No UI              | Similar to Freighter; Soroban support is experimental.                                |
| **Albedo**       | ❌ (uses own)  | ❌                    | ❌              | ❌                    | No Soroban wallet support yet.                                                        |
| **Rabet**        | ✅ Full        | ❌ Not exposed        | ❌ No UI        | ❌ No UI              | Minimal Soroban support.                                                              |
| **Solar Wallet** | ❌             | ❌                    | ❌              | ❌                    | Desktop-only; no Soroban wallet support.                                              |

**Key takeaway:** No wallet today offers a recurring pre-authorisation UI. SEP-10 JWTs are the only production-ready mechanism.

---

## 4. Recommendation

### Buildable now (recommended path)

**Approach: SEP-10 scoped JWT delegation** (described in §2.3)

1. User authenticates via SEP-10 once.
2. Server issues a JWT with scoped claims:
   ```json
   {
     "sub": "GABC…",
     "scope": "recurring:intent",
     "corridors": ["usdc-ngn"],
     "max_amount": "500",
     "interval": "monthly",
     "exp": 1893456000
   }
   ```
3. Server stores the JWT encrypted at rest.
4. On each recurring trigger, the server signs and submits the intent using the JWT as proof of pre-authorisation.

**Trade-off:** Custodial-ish for the recurring window. Mitigated by narrow scoping, user-revokable JWT, and optional on-chain settlement verification.

### Wait on ecosystem

**Approach: Soroban smart-wallet signer policy** (§2.2)

- Wait for SEP-41 to mature and wallets to ship a policy-configuration UI.
- Once available, deploy a "recurring intent signer" Soroban contract that accepts an off-chain signed intent only within the policy parameters (corridor, max amount, interval, total cap).
- A relayer (operated by Stellar Intel or a third-party keeper) submits the intent each period; the contract checks the policy before authorising.

**Estimated timeline:** 6–18 months before this is usable with mainstream wallets.

---

## 5. Impact on the sign-once execution engine

The sign-once execution engine (the follow-up implementation issue) should:

1. **Phase 1 (now):** Build the SEP-10 JWT delegation path — add a `recurring_intents` table to the database, a JWT scope claim validator, and a cron-like scheduler.
2. **Phase 2 (future):** When SEP-41 wallet support lands, add an optional Soroban-based signer policy backend and let the user choose between the two.

This separation lets the product ship recurring intents _now_ while keeping the door open to a fully non-custodial path later.
