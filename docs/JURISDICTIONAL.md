# Jurisdictional Memo

> **Not legal advice.** This memo records the architectural basis for Stellar
> Intel's regulatory posture for reviewers and contributors. Operators must obtain
> their own counsel for their jurisdiction.

**Last reviewed:** 2026-08-26

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

---

## Credit Layer — Regulatory Feasibility Memo

> **Not legal advice.** This memo records exploratory research into the
> regulatory landscape surrounding a potential future credit layer. No lending
> implementation is in scope. Any future lending feature is blocked by
> regulatory approval and by sufficient capital availability.
> See [`docs/ROADMAP.md`](ROADMAP.md) and
> [`docs/PROPOSAL.md`](PROPOSAL.md) for the strategic thesis.

> **Scope.** This is a Year 2+ roadmap initiative (post-v5 Institutional).
> The discussion below is intended to frame the conversation for contributors
> and reviewers — it does not commit to building anything.

### Background: Lending Against Observed On-Chain Remittance History

Stellar Intel's core thesis is that the execution layer — rate comparison,
reputation-ranked routing, intent submission, and outcome recording — solves
an immediate problem: getting a dollar from a wallet to a bank account in an
emerging market with the certainty of a tracked parcel.

A long-observed extension of this thesis is: _if we can observe a user
successfully remit $200 every two weeks for twelve months through reputable
anchors, can that history serve as an underwriting signal for a small-dollar
loan?_ The loan itself would not be fiat-denominated — it would be a USDC
advance against a future inbound remittance, settled automatically when the
next remittance lands, creating a closed loop.

In this model:

1. **The reputation oracle** (see [`docs/ORACLE_SPEC.md`](ORACLE_SPEC.md))
   already records every terminal outcome: intent hash, anchor, quoted rate,
   delivered rate, settle time, and outcome status. Over time, the oracle
   accumulates a per-user remittance history that is user-signed,
   replayable, and permissionless to read.
2. **The intent primitive** (see [`docs/INTENT_API.md`](INTENT_API.md))
   already expresses a user's commitment to a future action. A credit-layer
   extension might express a commitment to repay.
3. **Non-custody remains.** A lending facility would still not hold user
   keys or fiat — the user would sign the loan agreement as an intent, and
   repayment would be automatic at the next remittance.

None of this is implemented. None of this is scoped. This memo exists so that
when the roadmap reaches a point where credit becomes feasible, the
regulatory landscape has already been surveyed.

### Proposed Definition: "Proven Remittance History"

> **Research proposal — not a finalized lending policy.**
> The thresholds below are informed by the project's existing reputation and
> actuarial concepts (see [`docs/ANCHOR_REPUTATION.md`](ANCHOR_REPUTATION.md)
> and [`lib/reputation/thresholds.ts`](../lib/reputation/thresholds.ts)).
> They are offered as a starting point for discussion, not as underwriting
> criteria.

For the purpose of credit-layer research, "proven remittance history" is
proposed to mean the following objective, measurable criteria, ALL of which
must be satisfied:

| Criterion                                   | Proposed Threshold                 | Rationale                                                                                                                              |
| ------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Account age**                             | ≥ 12 months                        | A full year of observable behaviour filters out ephemeral accounts and provides at least one cycle of seasonal variance.               |
| **Remittance history duration**             | ≥ 6 months of consecutive data     | The outcome log must extend back at least six months. Aligns with the existing 90-day rolling scorecard window multiplied by 2.        |
| **Successful remittance transactions**      | ≥ 24 completed intents             | Two per month over twelve months. Comparably sized to the `MIN_OUTCOMES_THRESHOLD` (30) used for anchor scorecard graduation.          |
| **Transaction consistency**                 | ≤ 2 gaps > 60 days between intents | Demonstrates recurring need rather than one-off usage. Consistent with the behavioural stability signal.                               |
| **Volume threshold (total)**                | ≥ $2,400 USDC cumulative           | Average $200/mo over twelve months — below this, the economics of a loan (origination cost, monitoring, recovery) are likely negative. |
| **Volume threshold (per intent)**           | ≥ $50 USDC per intent              | Below this, the fixed-cost of underwriting exceeds any reasonable advance.                                                             |
| **Fill rate**                               | ≥ 0.9 (90 %) across all intents    | Borrows from the reputation composite score `fillRate` factor. High fill rate signals delivery reliability.                            |
| **Slippage tolerance**                      | ≤ 5 % p95 slippage                 | Borrows from the reputation composite score `slippage` factor. Low slippage signals predictable delivery value.                        |
| **Settlement time**                         | p95 settle ≤ 24 hours              | Borrows from the reputation composite score `settleSeconds` factor. Fast settlement reduces counterparty risk window.                  |
| **Anchor diversity**                        | ≥ 2 distinct anchors used          | Using multiple anchors reduces anchor-specific failure correlation and indicates the user is not locked to a single provider.          |
| **Dispute-free history**                    | 0 open or upheld disputes          | An active dispute undermines the reliability of the recorded outcome history.                                                          |
| **Reputation score of preferred anchor(s)** | Score band ≥ "amber" (≥ 80)        | The anchors the user transacts through must themselves have a track record (see [`docs/ANCHOR_REPUTATION.md`](ANCHOR_REPUTATION.md)).  |

**Measurement sources.** All proposed criteria use data already recorded in
the outcome log ([`types/reputation.ts`](../types/reputation.ts)):

- Account age: derived from the first observed `intentHash` timestamp for a
  given Stellar public key.
- Remittance history duration: the span between the earliest and latest
  outcome timestamps per key.
- Transaction count, fill rate, slippage, settle time: direct fields on the
  `OutcomeLogRow` and computed by the rolling scorecard in
  [`lib/reputation/aggregate.ts`](../lib/reputation/aggregate.ts).
- Anchor diversity, disputes: queryable from the outcome log.
- Volume: `deliveredAmount` summed across completed intents.

**Open questions for the proposed criteria:**

1. Should synthetic probe transactions (nightly $1 off-ramps — see Wave 2.3
   in [`docs/ROADMAP.md`](ROADMAP.md)) count toward proven history? Probes
   are user-witnessed but may not reflect genuine remittance behaviour.
2. Does a single corridor user have a materially different risk profile from
   a multi-corridor user?
3. Should the threshold adjust for the destination country's remittance
   volume? A $200/mo user in Nigeria may have different repayment
   characteristics from a $200/mo user in Argentina.
4. What happens when the user switches Stellar accounts? Should history be
   portable via a signed attestation?

### Regulatory Landscape

> This section summarises the regulatory posture of each jurisdiction
> Stellar Intel currently serves, as it might apply to a credit layer.
> It is not a legal opinion. Operators must obtain their own counsel for
> each jurisdiction.

#### United States

| Factor                 | Assessment                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Lending licence**    | State-by-state. Lending to consumers requires a licence in most states; rates are usury-capped per state.                             |
| **MSB classification** | If the system advances USDC, it may be classified as a money transmitter in addition to a lender.                                     |
| **Federal oversight**  | Consumer Financial Protection Bureau (CFPB) for small-dollar lending; FinCEN for MSB transmission.                                    |
| **Key consideration**  | A non-custodial lending facility that never takes fiat may not fit neatly into existing state lending regimes.                        |
| **Open question**      | Does advancing USDC against a future inbound USDC transfer constitute a "loan" under state usury laws, or a prepaid forward contract? |

#### European Union (MiCA)

| Factor                         | Assessment                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Lending licence**            | e-money institution (EMI) or credit institution licence may be required depending on duration.                                                   |
| **MiCA stablecoin regulation** | USDC is a significant stablecoin under MiCA; any system using it for credit-like products falls under the MiCA framework.                        |
| **Consumer credit directive**  | The Consumer Credit Directive (CCD) applies to loans up to €100,000; requires standardised information, right of withdrawal, and APR disclosure. |
| **Key consideration**          | The closed-loop nature (advance against next remittance) may shorten the duration enough to argue it is not "credit" — uncertain.                |
| **Open question**              | Would auto-repayment from an inbound remittance constitute a "payment service" under PSD2, requiring a separate licence?                         |

#### Nigeria

| Factor                      | Assessment                                                                                                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CBN digital lending**     | The Central Bank of Nigeria (CBN) has restricted digital lending; lenders must be registered with the CBN and comply with the CBN's 2021 framework for digital lending. |
| **Money transmission**      | CBN's regulations on International Money Transfer Operators (IMTOs) apply to inbound cross-border transfers.                                                            |
| **USDC / crypto treatment** | Nigeria has taken a cautious approach to crypto; USDC-denominated lending may face regulatory uncertainty.                                                              |
| **Key consideration**       | Nigeria is the largest corridor by volume. The regulatory cost of compliance must be weighed against potential user impact.                                             |
| **Open question**           | Could a non-custodial, oracle-based lending mechanism avoid classification as a "digital lender" under CBN rules?                                                       |

#### Other Key Corridors

| Jurisdiction  | Primary Regulator       | Key Instruments                                                                       | Likely Classification        | Risk Level  |
| ------------- | ----------------------- | ------------------------------------------------------------------------------------- | ---------------------------- | ----------- |
| **Kenya**     | Central Bank of Kenya   | CBK Digital Credit Guidelines; Data Protection Act                                    | Digital credit provider      | Medium      |
| **Ghana**     | Bank of Ghana           | Payment Systems and Services Act; E-Money Issuers Guidelines                          | E-money / payment service    | Medium      |
| **Mexico**    | CNBV / CONDUSEF         | Ley de Instituciones de Crédito; Fintech Law (Ley Fintech) for crowdfunding / e-money | Payment institution (IFPE)   | Medium      |
| **Brazil**    | Banco Central do Brasil | Payment Arrangement Law; the new legal framework for virtual assets                   | Payment institution / credit | Medium–High |
| **Argentina** | BCRA / CNV              | Virtual Asset Provider (PSAV) registration; Consumer credit regime                    | PSAV / credit provider       | High        |

### Licensing Implications

**Summary.** A lending facility that advances USDC against proven remittance
history would likely require some combination of the following licences,
depending on the jurisdictions served:

| Licence Type                   | Required When                                                              | Example Regimes                |
| ------------------------------ | -------------------------------------------------------------------------- | ------------------------------ |
| Money transmission / MSB       | Any jurisdiction where advancing USDC is classified as transmitting value. | US (FinCEN), most US states    |
| Consumer credit / lending      | Loan is to a natural person, attracts interest or fees, and is not exempt. | US states, EU (CCD), UK (FCA)  |
| E-money / payment institution  | System holds funds or facilitates payment settlement.                      | EU (MiCA/EMD2), Ghana, Nigeria |
| Virtual asset service provider | Any jurisdiction that treats USDC as a virtual asset.                      | Argentina (PSAV), EU (MiCA)    |

**Mitigation strategies under research:**

1. **Partnership model.** The lending facility is operated by a regulated
   third party; Stellar Intel provides the data oracle (remittance history
   attestation) but does not originate loans.
2. **Non-interest structure.** If the "loan" is structured as a fee-based
   prepaid advance (no interest), it may escape usury and lending-licence
   requirements in some jurisdictions.
3. **Jurisdictional gating.** Launch only in jurisdictions where the
   regulatory path is clear and cost-effective, excluding those where it is
   not.

### AML / KYC and Consumer Protection Considerations

**Current posture.** Today, Stellar Intel does not collect KYC. The anchor
performs KYC in its own SEP-24 or SEP-6 flow. The project stores only public
outcome data (fill rate, slippage, settle time). See
[`docs/NON_CUSTODY.md`](NON_CUSTODY.md).

**Credit layer implications.** A lending facility would introduce new
AML/KYC and consumer protection obligations:

| Consideration                     | Impact                                                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Customer due diligence**        | A lender must verify borrower identity. The anchor's KYC is not shared with Stellar Intel. A separate CDD process would be required.                           |
| **Beneficial ownership**          | For non-natural-person borrowers, beneficial ownership must be identified — currently out of scope.                                                            |
| **Credit reporting**              | Loan performance data (repayment history, defaults) must be reported to credit bureaus. Stellar Intel currently does not register with any credit bureau.      |
| **Fair lending / discrimination** | Using on-chain behaviour as an underwriting signal may introduce disparate impact. Historical transaction patterns may correlate with demographics.            |
| **Debt collection**               | If a loan defaults, collection processes are regulated. Auto-repayment from an inbound remittance may constitute an unauthorised collection practice.          |
| **Right of withdrawal**           | EU CCD and many US state laws give consumers a right to withdraw from a credit agreement within a cooling-off period. Automatic execution conflicts with this. |
| **Data privacy**                  | Using the outcome log for credit scoring may constitute a new data use not consented to by users. GDPR / CCPA / Data Protection Act considerations apply.      |

**Key privacy question.** The outcome log is public. If a lender reads a
user's public remittance history to make an underwriting decision, has the
user consented to that use? The permissionless-read design of the oracle
(see [`docs/ORACLE_SPEC.md`](ORACLE_SPEC.md)) is intentional — but it was
designed for anchor reputation, not consumer credit scoring. A credit layer
may need an explicit consent layer on top.

### Risks and Assumptions

| Risk                                 | Description                                                                                                                                                | Likelihood | Impact     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------- |
| **Regulatory classification error**  | The system is classified as a lender or MSB in a jurisdiction unexpectedly, triggering retroactive liability.                                              | Low        | High       |
| **Credit risk (default)**            | The user does not remit again, leaving an unrecoverable advance. No collateral is posted (non-custodial design).                                           | Medium     | High       |
| **Oracle data quality**              | The outcome log is incomplete, gapped, or manipulable, leading to incorrect underwriting decisions.                                                        | Low        | High       |
| **Adverse selection**                | Users with proven remittance history are the least likely to need credit, making the lending pool unrepresentative and risky.                              | Medium     | Medium     |
| **Regulatory fragmentation**         | Each corridor jurisdiction has different lending and AML requirements; blanket compliance may be cost-prohibitive.                                         | High       | Medium     |
| **User consent / privacy challenge** | Using outcome data for credit scoring without explicit consent creates legal risk under data protection regimes.                                           | Medium     | Medium     |
| **Currency / FX risk**               | The advance is in USDC; the repayment is in USDC — but the user's actual income (remittance) is in local fiat. FX volatility affects willingness to repay. | Medium     | Low–Medium |

**Key assumptions underlying this research:**

1. **Remittance history is predictive of repayment.** The core underwriting
   hypothesis — that a reliable remitter is a reliable borrower — is
   plausible but untested. Microlending research (CGAP, 2019–2024) has
   found mixed results on the predictive power of transaction history
   alone.
2. **The oracle data is sufficient.** The outcome log records only Stellar
   Intel-sourced transactions. If a user also remits through other channels
   (other wallets, direct SEP-24, bank transfer), that history is invisible
   to the oracle.
3. **Interest rate / fee economics work.** At small dollar amounts ($50–200
   per advance), the cost of data verification, disbursement, monitoring,
   and collection must be covered. It is not yet known whether the margins
   support a sustainable product.
4. **The legal entity can hold capital.** The project currently operates as
   an open-source repository. A lending facility requires a regulated legal
   entity with capital reserves. This is a separate undertaking requiring
   its own capital raise.

### Open Questions and Compliance Challenges

1. **Closed-loop repayment.** If the loan is repaid automatically from the
   next remittance, does the user retain control of their funds? The
   non-custodial design means Stellar Intel never controls funds — but an
   intent that commits the next remittance to repayment is legally
   different from a signed intent to withdraw.
2. **Oracle-based underwriting regulation.** No regulator has yet issued
   guidance on using on-chain reputation oracles for consumer credit
   decisions. This may change, and any lending feature must be designed to
   accommodate future regulation.
3. **Cross-border lending.** Lending to a borrower in Nigeria from a legal
   entity in the United States may trigger cross-border lending
   restrictions in both jurisdictions.
4. **Insolvency remoteness.** If Stellar Intel were to become insolvent,
   user outcome data is on-chain (permissionless) but any off-chain systems
   (the publisher, the API) may fail. A lending facility must be structured
   to survive the failure of its data provider.
5. **Securitisation / capital markets.** At scale, the loan book would need
   funding beyond equity — either debt or securitisation. Each adds
   regulatory complexity.

### Why This Remains a Future Roadmap Item

The v1–v5 roadmap (see [`docs/ROADMAP.md`](ROADMAP.md)) is scoped to
building, hardening, and scaling the **execution layer** — rate aggregation,
reputation, oracle, MCP surface, and institutional compliance. A credit
layer is not part of any current wave.

Credit is blocked by four independent gates that must ALL be cleared:

| Gate                       | Current Status      | Path to Clear                                                                                           |
| -------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------- |
| **Regulatory approval**    | Not engaged         | Engage counsel in at least one pilot jurisdiction; determine licensing path; apply or partner.          |
| **Sufficient capital**     | Not available       | Separate capital raise for a regulated lending entity. Project funds are for execution-layer dev.       |
| **Proven data quality**    | Early (v2 underway) | The oracle must accumulate enough outcomes across enough corridors to validate the underwriting thesis. |
| **User consent / privacy** | Not designed        | Design a consent layer on top of the permissionless oracle for credit-specific data use.                |

**These gates place any lending feature in the Year 2+ window** — after v5
Institutional has shipped, the jurisdiction compliance matrix is published,
and a separate legal entity with capital reserves has been established.

### Explicit Scope Statement

To avoid any ambiguity:

- **No lending implementation is in scope** for the current roadmap or any
  planned wave. No contracts, APIs, database schemas, underwriting models,
  or credit-related business logic exist in the repository.
- **This issue is research only.** The analysis above is a survey of the
  regulatory landscape — it is not a product specification.
- **Any lending feature is blocked by regulatory approval.** No work on a
  credit layer will proceed until counsel has confirmed a licensing path for
  at least one pilot jurisdiction.
- **Any lending feature is blocked by sufficient capital availability.** The
  project has no capital allocated to lending, and a lending facility would
  require a separate raise on top of whatever funds the rest of the roadmap.
- **This is a Year 2+ roadmap initiative.** The current roadmap (v1
  Executable → v5 Institutional) must ship before credit feasibility is
  re-evaluated.

### Related Documentation

- [`docs/ROADMAP.md`](ROADMAP.md) — the current wave plan; no credit layer in any wave.
- [`docs/ORACLE_SPEC.md`](ORACLE_SPEC.md) — the on-chain reputation oracle that would
  provide the underwriting data.
- [`docs/ANCHOR_REPUTATION.md`](ANCHOR_REPUTATION.md) — the scoring methodology that
  informs the proposed threshold criteria.
- [`docs/NON_CUSTODY.md`](NON_CUSTODY.md) — why the product cannot be a lender without
  a fundamental architectural change (or a separate legal entity).
- [`docs/PROPOSAL.md`](PROPOSAL.md) — the project thesis; the scope is an observation
  record plus a non-custodial execution path, not lending.
- [`types/reputation.ts`](../types/reputation.ts) — the outcome log schema that would
  feed any future credit scoring.
- [`lib/reputation/thresholds.ts`](../lib/reputation/thresholds.ts) — the existing
  threshold logic that informed the proposed quantitative criteria.

**Cross-document consistency note.** The analysis in this memo is exploratory
and has **not yet** been reflected in [`docs/NON_CUSTODY.md`](NON_CUSTODY.md),
[`docs/SECURITY.md`](SECURITY.md), or [`docs/THREAT_MODEL.md`](THREAT_MODEL.md).
If credit-layer research advances beyond the exploratory stage, those four
documents must be updated together to remain internally consistent — per the
maintenance policy stated at the top of this document.
