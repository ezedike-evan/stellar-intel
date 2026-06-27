# Jurisdictional Memo

> **Not legal advice.** This memo records the architectural basis for Stellar
> Intel's regulatory posture for reviewers and contributors. Operators must obtain
> their own counsel for their jurisdiction.

## Thesis: not money transmission

Money-transmitter / MSB / VASP classification generally attaches to a party that
**takes control of customer funds**. Stellar Intel is architected so that it never
does — see [`docs/NON_CUSTODY.md`](NON_CUSTODY.md). The classification-relevant
facts, all enforced in code:

1. **Every leg is signed by the user.** Value moves only on a transaction the user
   signs in their own wallet (Freighter). We submit nothing on a user's behalf with
   a held key. Intents are user-signed envelopes
   ([`docs/INTENT_API.md`](INTENT_API.md)).
2. **The anchor takes custody.** Fiat settlement and KYC are between the user and a
   regulated anchor under SEP-24 / SEP-6. We are not in the settlement path.
3. **Stellar enforces atomicity.** The ledger, not Stellar Intel, guarantees the
   transfer semantics.

Stellar Intel therefore functions as an **information and routing layer** (rate
comparison + a public reputation oracle + an agent surface), not a transmitter of
value.

## Risk register (architecture-level)

| Concern                  | Posture                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| MSB / money transmission | No custody, no held keys, no settlement path — see facts above.                                                    |
| VASP / data              | We store public anchor outcomes, not user funds or KYC; KYC stays with the anchor.                                 |
| Sanctions / AML          | KYC/AML is performed by the regulated anchor in its SEP flow; we do not onboard users to a financial product.      |
| Per-country variance     | Reviewed per jurisdiction with counsel; this memo is the architectural baseline, not a country-by-country opinion. |

## Maintenance

Reviewed annually and whenever a new write path or custody-adjacent surface is
proposed. Must stay internally consistent with
[`docs/NON_CUSTODY.md`](NON_CUSTODY.md), [`docs/SECURITY.md`](SECURITY.md), and
[`docs/THREAT_MODEL.md`](THREAT_MODEL.md) — a PR that breaks one should update all.
