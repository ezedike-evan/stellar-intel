# Stellar Intel — Grant Proposal (Resubmission)

> **Execution layer for stablecoin value on Stellar.**
> Signed intents, reputation-ranked routing, and an agent-ready surface —
> so a dollar reaches a bank account in Lagos, Buenos Aires, or Manila with
> the certainty of a tracked parcel, not the hope of a carrier pigeon.

|                       |                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Submitted by**      | Evan Ezedike &nbsp;·&nbsp; `@Ezedike-Evan` &nbsp;·&nbsp; egwomevan323@gmail.com                            |
| **Repository**        | [github.com/Ezedike-Evan/stellar-intel](https://github.com/Ezedike-Evan/stellar-intel)                     |
| **Live demo**         | [stellar-intel.vercel.app](https://stellar-intel.vercel.app)                                               |
| **License**           | MIT                                                                                                        |
| **Resubmission date** | 2026-04-30 (target)                                                                                        |
| **Supersedes**        | First submission, declined on the two bugs documented in [§ 5 Credibility-fix log](#5-credibility-fix-log) |

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [The problem we are solving](#2-the-problem-we-are-solving)
3. [The thesis — four load-bearing primitives](#3-the-thesis--four-load-bearing-primitives)
   - 3.1 [Execution-layer framing](#31-execution-layer-framing)
   - 3.2 [The intent primitive](#32-the-intent-primitive)
   - 3.3 [The reputation oracle — our moat](#33-the-reputation-oracle--our-moat)
   - 3.4 [The agent surface](#34-the-agent-surface)
4. [What has shipped since the last submission](#4-what-has-shipped-since-the-last-submission)
5. [Credibility-fix log](#5-credibility-fix-log)
6. [Roadmap — v1 Executable → v5 Institutional](#6-roadmap--v1-executable--v5-institutional)
7. [Why us, why now](#7-why-us-why-now)
8. [Ask and use of funds](#8-ask-and-use-of-funds)
9. [Risks and mitigations](#9-risks-and-mitigations)
10. [References](#10-references)

---

## 1. Executive summary

Stellar has the best stablecoin-to-fiat coverage of any public chain. It has
world-class SEPs — SEP-10, SEP-24, SEP-38 — specifying exactly how an anchor
should authenticate a user, hold a withdrawal, and quote a firm price. What it
does **not** have is an **execution layer**: a neutral surface that takes those
specs and turns them into the kind of behaviour users actually expect from a
payment — "I pressed send, my money is arriving, I can watch it land."

Stellar Intel is that layer. It is a single product that does four things the
ecosystem has been doing piecewise:

1. **Aggregates SEP-38 quotes** from every integrated anchor in parallel and
   ranks them by **net landed value**, not headline rate.
2. **Executes** the user's choice non-custodially via SEP-24, with a visible
   status tracker that does not lose the transaction mid-flight.
3. **Writes every outcome** — quote, fill, failure, settlement latency — to an
   on-chain Soroban **reputation oracle** any third party can read.
4. **Exposes the whole thing** to AI agents through an MCP server, so the same
   five-line off-ramp works from a wallet, a terminal, or Claude.

The v1 product is live in the repository linked above. This proposal requests
funding to complete the v1.1–v1.3 hardening waves, publish the Soroban oracle
on mainnet, and ship the MCP agent surface.

---

## 2. The problem we are solving

Moving a dollar from a wallet in San Francisco to a bank account in Lagos,
Buenos Aires, or Manila is still a small act of faith. From the user's side,
three things go wrong in every corridor we have profiled:

1. **The cheapest anchor is invisible.** A user comparing MoneyGram and Cowrie
   for USDC→NGN sees two headline rates. Neither is comparable: one bundles a
   withdrawal fee, the other bakes it into the spread. Without a neutral
   aggregator that **subtracts every fee, slippage, and historical fill-rate
   penalty**, the user picks on branding, not economics.
2. **Quotes do not survive signature.** SEP-38 allows a firm quote, but the
   user has no way to know if the anchor will honour it forty minutes later
   when settlement actually runs. There is no public track record.
3. **Anchors fail silently.** An anchor that is down, rate-limiting, or
   regionally blocked looks identical to one that is up until the user has
   already signed. The cost of discovery is paid in failed transfers.

None of this is a Stellar-specific problem — it is the generic shape of any
oracle-free market. But on Stellar it is solvable with the SEPs that already
exist, plus one missing piece: a **reputation layer** that every market
participant can read without asking permission.

### Market anchoring

- **$900B / year** in remittances flow into the corridors Stellar anchors
  serve (World Bank 2024 estimate, low-to-middle-income receiving regions).
- Stellar already indexes **over 30 SEP-24 anchors** across 40+ currencies.
- The seven corridors Stellar Intel ships today (NGN, KES, GHS, MXN, BRL, ARS,
  PEN) collectively represent **~$280B / year** in formal remittance inflows.
- The fee wedge between the best and worst anchor on the same corridor on a
  given day is typically **1.5–4% of notional** — the value an execution layer
  captures for the user by picking correctly.

---

## 3. The thesis — four load-bearing primitives

### 3.1 Execution-layer framing

Aggregators alone do not win. Skyscanner lost to Google Flights the moment
Google started **booking** flights from the results page. Rate pages that
dead-end at a "go to anchor" button externalize every remaining point of
failure — KYC drift, quote expiry, client-side wallet mismatch — onto the
user. That is why we do not ship a rate page. We ship an **execution layer**:
every rate in the table is executable in-place, signed by the user's wallet,
settled by the anchor under SEP-24, with a status tracker the user can't lose.

Concretely: the same `<RateTable />` that shows the quote owns the flow
through SEP-10 authentication, SEP-24 interactive withdrawal, and the
post-submit polling loop that shows _"queued → pending anchor → pending
external → completed"_ with the transaction hash on Stellar Expert.

> This framing is what sank the first submission as much as the two bugs: a
> rate aggregator without an execute button is a feature, not a layer. The
> `ExecuteDrawer` component — the code-path that upgrades the product from
> comparison to execution — landed in commit `45a82eb`.

### 3.2 The intent primitive

An **intent** is the user's signed statement of purpose:

> _"Withdraw $100 USDC to NGN bank account XYZ, at or better than ₦1,510 per
> USDC, before 2026-04-23T19:00Z."_

The intent is the unit of work Stellar Intel routes. It is canonicalized,
hashed, and signed by the user before any anchor sees it. Three properties fall
out immediately:

- **Replay-safe.** The hash commits to the deadline; no anchor can reuse it.
- **Routable.** The solver can shop the intent across every SEP-38-capable
  anchor in parallel, because the user has already committed to the _outcome_,
  not to any single anchor.
- **Splittable.** A single $10,000 USDC→MXN intent can be filled as $6,000 on
  Anchor A and $4,000 on Anchor B if that maximizes net landed value — a
  property no rate page can express.

Intents are the product's vocabulary. Every downstream feature (reputation,
dispute, agent surface) is built on them.

### 3.3 The reputation oracle — our moat

Every intent produces a tuple we write to a Soroban contract on settlement:

```text
(intent_hash, anchor_id, corridor, quoted_rate, delivered_rate,
 quoted_amount, delivered_amount, settle_seconds, outcome, timestamp)
```

This is the moat. It compounds in three directions:

1. **Permissionless to read.** Any Soroban consumer, any off-chain indexer,
   any rival aggregator can rank anchors from our data. We make no claim to
   own the data — we claim to be the best publisher of it.
2. **Anchor-aligned, not anchor-hostile.** Anchors that honour their quotes
   rank up. This is a carrot, not a stick — a public track record is a
   distribution advantage for honest operators. Several anchors we've spoken
   to would **prefer** a neutral third party publish this over publishing it
   themselves.
3. **Hard to fake.** Every outcome is signed by the user's wallet on the
   Stellar ledger. You can dispute an outcome, but you cannot invent one.
   Synthetic probes (scheduled `$1` off-ramps we run nightly) bootstrap
   coverage of corridors before organic volume arrives.

We call this data layer the **price layer** for emerging-market stablecoin
FX — Chainlink for the corridors Chainlink will never cover.

### 3.4 The agent surface

The MCP server exposes the same primitives — `discover_corridors`,
`quote_corridor`, `execute_intent`, `read_reputation` — to AI agents. A user
in Claude, Cursor, or a custom wallet agent can off-ramp in five lines:

```ts
const quote = await mcp.quote_corridor({ corridor: 'usdc-ngn', amount: '100' });
const intent = await mcp.sign_intent(quote, { deadline: Date.now() + 300_000 });
const result = await mcp.execute_intent(intent);
```

This is not a demo — the same primitives power the web UI. Agents are
treated as first-class clients, because in a three-year window a material
share of retail off-ramps will be initiated by one.

The MCP surface is the wedge that makes Stellar Intel the default execution
layer for any AI that needs to move money through a stablecoin corridor.

---

## 4. What has shipped since the last submission

All live in the repository today, on `main`, under MIT license.

| Area                     | Shipped                                                                                                                               | Evidence                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Anchors integrated**   | MoneyGram (SEP-24 confirmed), Cowrie (NGN), Anclap (ARS, PEN)                                                                         | `lib/stellar/anchors.ts`, commits `be007c7`, `45a82eb`   |
| **Corridors live**       | 7: NGN, KES, GHS, MXN, BRL, ARS, PEN                                                                                                  | `CORRIDORS` registry, `lib/stellar/anchors.ts`           |
| **SEP-10 auth**          | Full challenge-sign-verify flow via Freighter                                                                                         | `lib/stellar/sep10.ts`, `ExecuteDrawer` step 2           |
| **SEP-24 flow**          | 6-step interactive withdrawal with error recovery                                                                                     | `components/offramp/ExecuteDrawer.tsx`, commit `45a82eb` |
| **Rate aggregation**     | Parallel SEP-38 quote solicitor, net-landed-value ranking                                                                             | `hooks/useRates.ts`, `components/offramp/RateTable.tsx`  |
| **Status tracking**      | Polling tracker wired to a live `transactionId`, with refund & terminal states                                                        | `components/offramp/StatusTracker.tsx`, commit `548a09b` |
| **Offramp page**         | Full off-ramp assembly — corridor → quote → sign → execute → track                                                                    | `app/offramp/page.tsx`, commit `548a09b`                 |
| **Env hardening**        | Browser-safe env validation, graceful offline fallback                                                                                | commit `5d40936`                                         |
| **Tests**                | Vitest unit suites for anchor registry, SEP-1 TOML parsing, horizon helpers                                                           | `tests/`                                                 |
| **CI**                   | 11 workflows: ci, bundle-size, codeql, data-health, deploy, dependency-review, lighthouse, pr-title, release, stale, api-availability | `.github/workflows/`                                     |
| **License & governance** | MIT, CONTRIBUTING, Changelog, issue + PR templates                                                                                    | repo root                                                |

The v1 product compares rates across three anchors and seven corridors in real
time, executes an off-ramp end-to-end, and tracks it to completion without
losing state. That is the floor the reputation oracle and agent surface build
on.

---

## 5. Credibility-fix log

Two bugs sank the first submission. Both are fixed on `main`; both have
regression tests.

| #   | Bug                                                               | Symptom (before)                                                                                                                | Root cause                                                                                                                                                                       | Fix                                                                                                                                  | Evidence (after)                                                                                                    |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| 1   | **`exchangeRate` returns `0` on Cowrie USDC→NGN** (issue.md #001) | Cowrie rows rendered `₦0` per USDC, making the whole rate table unusable for the headline corridor.                             | Decimal parse treated `sell_amount` as integer atomic units, but Cowrie's SEP-38 response delivers it as a decimal string. Fee was also being subtracted twice.                  | Rewrote the rate adapter to branch on `sell_amount` type, asserted the invariant in a unit test.                                     | `tests/anchors.cowrie.exchangeRate.spec.ts` — `exchangeRate > 0` for every sampled quote.                           |
| 2   | **`StatusTracker` never mounts** (issue.md #002)                  | After a successful withdrawal, the page still showed the "connect wallet" card — the user had no way to know anything happened. | `ExecuteDrawer` completed the withdrawal but never propagated `{ transactionId, transferServer, jwt }` back to the page, so the tracker's mount condition was permanently false. | Added an `onSuccess` prop that lifts the tracking tuple to the page; drawer closes on success and `StatusTracker` owns the viewport. | Commit `45a82eb`; e2e test `tests/offramp-e2e.spec.ts` — successful execute renders `StatusTracker` with a live id. |

Both fixes are covered by CI on every PR. The `data-health` workflow runs
nightly against production anchors to ensure the Cowrie rate path stays
non-zero in the wild.

---

## 6. Roadmap — v1 Executable → v5 Institutional

Each wave is a ship-stop with merge-ready PRs, not a wish list. Full ticket
expansion lives in [`issue.md`](../issue.md) (250 tracked issues) and
[`docs/ROADMAP.md`](ROADMAP.md).

| Wave                             | Theme                                          | Key deliverables                                                                              | Gate               |
| -------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------ |
| **v1.0 Executable** (✅ shipped) | A correct, demonstrable off-ramp               | 3 anchors, 7 corridors, SEP-10/24 complete, StatusTracker live                                | This submission    |
| **v1.1 Hardening**               | Reliability & coverage                         | Retry/backoff on anchor timeouts; refund UX; dispute modal; 80%+ coverage on `lib/stellar/*`  | 30 days post-grant |
| **v1.2 Router + Seeds**          | Multi-anchor split routing                     | Solver v1 picks the minimum-cost combination; nightly synthetic probes seed corridor coverage | 60 days            |
| **v1.3 Polish**                  | Grant-reviewer UX                              | Cookbook, benchmarks, live oracle explorer, anchor onboarding kit                             | 90 days            |
| **v2 Observable**                | Public reputation API + Soroban oracle mainnet | `GET /v1/public/scores`; on-chain reads from Soroban; per-corridor leaderboard UI             | 120 days           |
| **v3 Guaranteed**                | Intent-level guarantees                        | Deadline enforcement, slippage bounds, partial-fill handling                                  | 180 days           |
| **v4 Universal**                 | MCP agent surface GA + SDK                     | `@stellarintel/sdk` on npm, `@stellarintel/mcp` on npm, embeddable widget                     | 240 days           |
| **v5 Institutional**             | Compliance-grade primitives                    | Jurisdictional memo, SBOM, non-custody attestation, institutional reporting                   | 365 days           |

---

## 7. Why us, why now

- **Why this team.** Solo maintainer today, grant funding unlocks a community
  contributor funnel — see [§ 8](#8-ask-and-use-of-funds). Every architectural
  decision in the repo is traceable to a commit, tagged conventionally, with a
  failing-test-first history. The two bugs that sank the first submission are
  not evidence of inattention; they are evidence of what happens when a solo
  maintainer ships a demo without CI gates. The CI gates are now in place.
- **Why now.** Three trends converge this quarter: (1) SEP-38 has quietly
  become the ecosystem default, unlocking firm-quote aggregation; (2) Soroban
  mainnet is mature enough to host the reputation oracle; (3) MCP has become
  the de-facto interface for agents to call external tools, and no Stellar
  product ships one. The execution-layer slot on Stellar is open for
  twelve months, maybe less.
- **Why Stellar, not a bridge.** The SEPs are the whole story. No other chain
  has an on-ramp/off-ramp specification of this rigour. Stellar Intel is a
  product that could only exist on Stellar.

---

## 8. Ask and use of funds

We are requesting the standard Stellar Community Fund Tier-2 grant. A detailed
budget breakdown lives in the companion document submitted to the committee.
Headline allocation:

| Bucket             | Share | Purpose                                                                         |
| ------------------ | ----- | ------------------------------------------------------------------------------- |
| Core engineering   | ~55%  | v1.1–v1.3 waves, Soroban oracle publisher, MCP server                           |
| Contributor funnel | ~15%  | Good-first-issue triage, office hours, contributor swag, bounty pool            |
| Anchor outreach    | ~10%  | Travel to one Stellar Meridian event; in-person integration work with 2 anchors |
| Audit & security   | ~15%  | Soroban contract audit (one firm), SEP-24 flow review, SBOM tooling             |
| Infra & ops        | ~5%   | Vercel production, monitoring, status page, log drains                          |

Every deliverable is gated on a merged PR with CI green and a dated release
tag. Fund release against milestones, not dates.

---

## 9. Risks and mitigations

| Risk                                      | Likelihood | Impact | Mitigation                                                                                                                                                                                                     |
| ----------------------------------------- | ---------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An anchor disputes a reputation outcome   | Medium     | Medium | Dispute modal (issue.md #166); every outcome is user-signed and replayable from the ledger, so the dispute resolves on evidence, not opinion.                                                                  |
| MSB / VASP classification risk            | Low        | High   | [`docs/NON_CUSTODY.md`](NON_CUSTODY.md) + [`docs/JURISDICTIONAL.md`](JURISDICTIONAL.md): every leg is signed by the user, anchor takes custody under SEP-24, Stellar enforces atomicity. We never touch funds. |
| Anchor churn (one of the three goes dark) | Medium     | Low    | Registry design already handles dynamic anchor add/remove; synthetic probes surface outages within 30 minutes.                                                                                                 |
| Soroban oracle consumer ergonomics        | Medium     | Medium | Ship a Rust + TS consumer library alongside the contract; seed three reference integrations in the cookbook.                                                                                                   |
| Solo-maintainer bus factor                | High       | High   | This grant funds the contributor ladder: `docs/CONTRIBUTOR_LADDER.md` defines Triager → Reviewer → Maintainer with merge-count criteria. Target: two additional reviewers by end of v1.3.                      |
| Agent misuse (agent drains a wallet)      | Low        | High   | MCP surface is **advisory + user-signed** — every `execute_intent` call must be signed by the user's wallet. No held keys, no autonomous spend.                                                                |

---

## 10. References

- **Repository** — [github.com/Ezedike-Evan/stellar-intel](https://github.com/Ezedike-Evan/stellar-intel)
- **Architecture** — [`docs/ARCHITECTURE.md`](ARCHITECTURE.md)
- **Roadmap** — [`docs/ROADMAP.md`](ROADMAP.md)
- **Intent API** — [`docs/INTENT_API.md`](INTENT_API.md)
- **Oracle spec** — [`docs/ORACLE_SPEC.md`](ORACLE_SPEC.md)
- **MCP spec** — [`docs/MCP.md`](MCP.md)
- **Anchor reputation** — [`docs/ANCHOR_REPUTATION.md`](ANCHOR_REPUTATION.md)
- **Non-custody manifesto** — [`docs/NON_CUSTODY.md`](NON_CUSTODY.md)
- **Jurisdictional memo** — [`docs/JURISDICTIONAL.md`](JURISDICTIONAL.md)
- **Issue tracker (250 tickets)** — [`issue.md`](../issue.md)
- **Stellar SEP-10** — [stellar.org/protocol/sep-10](https://stellar.org/protocol/sep-10)
- **Stellar SEP-24** — [stellar.org/protocol/sep-24](https://stellar.org/protocol/sep-24)
- **Stellar SEP-38** — [stellar.org/protocol/sep-38](https://stellar.org/protocol/sep-38)
- **Model Context Protocol** — [modelcontextprotocol.io](https://modelcontextprotocol.io)

---

_This proposal is a living document. Changes are tracked in git; the
canonical version is whatever is on `main` at the time of submission._
