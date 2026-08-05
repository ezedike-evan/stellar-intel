# Stellar Intel — Project Thesis

> **A public health and reputation record for Stellar off-ramp anchors — with a
> non-custodial execution path built on it.**
>
> Monitoring comes first because it is the half that works without anyone's
> cooperation. Execution is real, it is in the repository, and its quality is
> set by anchors this project does not control.

**Last updated:** 2026-08-05

|                |                                                                                        |
| -------------- | -------------------------------------------------------------------------------------- |
| **Maintainer** | Evan Ezedike &nbsp;·&nbsp; `@ezedike-evan`                                             |
| **Repository** | [github.com/ezedike-evan/stellar-intel](https://github.com/ezedike-evan/stellar-intel) |
| **Live**       | [stellar-intel.vercel.app](https://stellar-intel.vercel.app)                           |
| **License**    | MIT                                                                                    |

This document states what the project is for and how it is sequenced. It is
**not** a funding application. An earlier revision was written as a grant
resubmission and led with "execution layer for stablecoin value on Stellar" and
a "universal intent layer" thesis; both are retired, and the reasoning is in
[`POSITIONING.md`](POSITIONING.md), which is the source of truth for every claim
made here.

---

## Table of contents

1. [What this is](#1-what-this-is)
2. [The problem](#2-the-problem)
3. [The thesis](#3-the-thesis)
   - 3.1 [The observation record](#31-the-observation-record)
   - 3.2 [The execution path](#32-the-execution-path)
   - 3.3 [The agent surface](#33-the-agent-surface)
4. [What is actually true today](#4-what-is-actually-true-today)
5. [What this project stopped claiming](#5-what-this-project-stopped-claiming)
6. [Sequencing](#6-sequencing)
7. [Why this, on Stellar](#7-why-this-on-stellar)
8. [Risks and mitigations](#8-risks-and-mitigations)
9. [References](#9-references)

---

## 1. What this is

**An anchor health and reputation record for Stellar off-ramps, with an
execution path built on top of it.**

The order matters and it is not modesty. Compare what each half needs in order
to be true:

|                     | needs                                 | status                       |
| ------------------- | ------------------------------------- | ---------------------------- |
| Health + reputation | public endpoints, a clock             | works today                  |
| Execution           | anchors, corridors, liquidity, quotes | constrained by third parties |

A probe needs no partnership, no listing, and no permission: it asks an anchor's
public endpoints what they do and writes down the answer. Leading with the
execution half means claiming a capability whose quality is set by parties who
never agreed to anything.

The distinguishing claim is narrow and checkable: **this project writes down what
anchors did, on a clock, and publishes both the record and the method.**

---

## 2. The problem

Moving a dollar from a wallet to a bank account in Lagos, Nairobi, or Manila is
still an act of faith. Three things go wrong, and all three are the same
problem wearing different clothes — **there is no public record of what anchors
actually do.**

1. **An anchor that is degraded looks identical to one that is healthy** until
   the user has already signed. The cost of discovery is paid in failed
   transfers, by the user.
2. **Quotes have no track record.** Whether an anchor honours a price at
   settlement forty minutes later is unknowable, because nobody is writing down
   whether it did last time.
3. **Comparison is not possible on declared data alone.** A directory entry says
   what an anchor supports. It cannot say whether the endpoint answered this
   morning.

None of this is Stellar-specific — it is the generic shape of a market without
an observation record. But on Stellar it is tractable, because the SEPs already
specify exactly which public endpoints an anchor must expose. That makes an
honest monitor possible without anyone's cooperation.

### What this deliberately is not

**Not "universal".** This is a Stellar project about fiat off-ramps through SEP
anchors. Not chain-agnostic, not a general payments product, not a routing layer
for value in general.

**Not a replacement for [SDF's Anchor Directory](https://anchors.stellar.org/).**
The directory is the register — which anchors exist and what they say they do.
This is the observation record — what they actually did this week. A register
and a monitor are different artifacts with different refresh semantics, and
neither substitutes for the other. The worked comparison is in
[`POSITIONING.md`](POSITIONING.md).

---

## 3. The thesis

### 3.1 The observation record

Seven registered anchors, probed every five minutes across four signals:
**uptime, quote availability, issuer mismatch, TOML integrity**. Samples land in
a durable store, age out on a retention policy, and roll up into a per-anchor
score by a **published method** — [`ANCHOR_REPUTATION.md`](ANCHOR_REPUTATION.md),
rendered at [`/methodology`](https://stellar-intel.vercel.app/methodology).

Two properties are load-bearing:

- **Small samples are labelled as small.** A score computed from four
  observations is reported with `n`, not laundered into a confident number.
- **The method is published before the score is used.** A reputation system
  whose scoring rule is private is an opinion with a number attached.

The record is written on-chain to a Soroban contract so a third party can read
it without trusting this project's backend. That is the point of the oracle: not
that it is on a blockchain, but that the claim becomes checkable by someone who
does not trust the claimant.

### 3.2 The execution path

A non-custodial off-ramp: corridor → compare → sign → execute → track. SEP-10 for
authentication, SEP-24 for the interactive withdrawal, SEP-38 where an anchor
actually offers firm quotes.

**Every leg is signed by the user.** The anchor takes custody under SEP-24;
this project never holds funds and has no code path that could. That is an
architectural property, not a policy promise — see
[`NON_CUSTODY.md`](NON_CUSTODY.md).

This half is real and it works. It is second in this document because its
quality is bounded by anchor behaviour, and the honest version of that sentence
is in §5.

### 3.3 The agent surface

An MCP server exposing the same primitives the web UI uses, plus a versioned
REST API with an error envelope, rate-limit headers, and idempotency keys.

The surface is **advisory and user-signed**. There is no held key and no
autonomous spend: an agent can compare, quote, and prepare, but a human wallet
signs. An agent surface over a custodial product would be a different risk
posture entirely; this one inherits §3.2's.

---

## 4. What is actually true today

- **Seven registered anchors**, probed every five minutes across four signals.
- **A published scoring methodology**, with small samples labelled as small.
- **A non-custodial execution path**: every leg user-signed, anchor custody
  under SEP-24, no funds held at any point.
- **An MCP surface** exposing the same primitives as the web UI.
- **A Soroban reputation contract**, deployed to testnet.
- **CI that gates on it**: formatting, lint at zero warnings, typecheck, unit
  suite with coverage, an OpenAPI drift gate, a WCAG AA contrast guard, a
  registry guard, and both Rust jobs.

Anything not in that list should be read as not yet true.

---

## 5. What this project stopped claiming

Three statements in earlier copy do not survive contact with the live network.
They are listed rather than quietly deleted, because the whole point of
narrowing is to stop making them. The full evidence is in
[`POSITIONING.md`](POSITIONING.md).

1. **"Live SEP-38 quotes across every integrated anchor."** On 2026-08-05, **one
   of seven** registered anchors advertises `ANCHOR_QUOTE_SERVER` at all — and
   that one does not quote the corridor it is registered for. Ranking across
   firm quotes is not something that can be done today, because the quotes do
   not exist. It becomes true as anchors adopt SEP-38, and not before.
2. **"Every quote, fill, failure and settlement is written to a public
   reputation oracle."** The publisher and the contract both exist. Whether a
   given deployment has published anything is a question about data, not code;
   `GET /api/reputation/probe-coverage` is the honest answer to it.
3. **"Ranked by net landed value."** The ranking code is real, but a fill-rate
   penalty computed from an empty sample ranks on priors. It becomes true when
   the probe window is non-empty.

Two of the three are fixed by the clock running long enough. That is precisely
why the roadmap gates a mainnet oracle publish on 90 days of accumulated probe
coverage rather than on a date — see §6.

---

## 6. Sequencing

Waves, not dates. Full ticket-level expansion is in
[`ROADMAP.md`](ROADMAP.md), which is the authoritative version; this table is
the shape of it.

The axis is the one from §1 — what works without anyone's cooperation, versus
what is third-party constrained.

| Wave                    | Theme                              | Depends on                            |
| ----------------------- | ---------------------------------- | ------------------------------------- |
| **v1 Executable** ✅    | A correct, demonstrable off-ramp   | nothing external                      |
| **v2 Observable** ✅    | Reputation as a product surface    | nothing external — probes and a clock |
| **v3 Guaranteed**       | Intent-level SLAs                  | settlement history to price against   |
| **v4 Universal**        | SDK + MCP GA, embeddable widget    | consumers, not anchors                |
| **v5 Institutional**    | Compliance-grade primitives        | counterparties who ask for them       |
| **v6 Ecosystem Infra.** | Multi-language SDKs, decentralized | third-party readers of the oracle     |

The first two waves needed nobody's permission, which is why they are done. The
later ones are gated on parties outside this repository, which is why they are
sequenced behind rather than promised alongside.

**The gate that matters most is not on this table.** A mainnet oracle publish is
blocked in code on **90 days of continuous probe coverage** — never launch an
empty credit bureau. The enforcement is a refusal in the publish path, not a
convention.

---

## 7. Why this, on Stellar

**Why this is possible here.** The SEPs are the whole story. SEP-1 pins a
discoverable manifest at a known path, SEP-10 specifies authentication, SEP-24
specifies interactive withdrawal, SEP-38 specifies firm quotes. That is enough
public surface to build an honest monitor without asking a single anchor for
access. No other ecosystem has an on/off-ramp specification of this rigour, so
this project could not be ported — it is not that it would be hard, it is that
there would be nothing to probe.

**Why the monitoring half is the durable one.** Anchors come and go; the
observation record accumulates regardless. Its value is a function of how long
it has been running, which is the one property a competitor cannot acquire by
writing code faster.

**Why it stays open.** MIT, with the methodology published and the on-chain
record readable by anyone. A reputation system that only its author can audit is
not a reputation system.

---

## 8. Risks and mitigations

| Risk                                      | Likelihood | Impact | Mitigation                                                                                                                                                                   |
| ----------------------------------------- | ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scoring on too few samples                | High       | High   | Sample counts are reported alongside every score; the mainnet oracle publish is gated in code on 90 days of continuous coverage.                                             |
| An anchor disputes a reputation outcome   | Medium     | Medium | Every outcome is user-signed and replayable from the ledger, so a dispute resolves on evidence. Escalation ladder in [`GOVERNANCE.md`](GOVERNANCE.md).                       |
| MSB / VASP classification                 | Low        | High   | [`NON_CUSTODY.md`](NON_CUSTODY.md) + [`JURISDICTIONAL.md`](JURISDICTIONAL.md): every leg user-signed, anchor custody under SEP-24. There is no code path that takes custody. |
| Anchor churn                              | Medium     | Low    | The registry handles dynamic add/remove; nightly validation flags degraded anchors and opens a tracking issue automatically.                                                 |
| SEP-38 adoption stays thin                | Medium     | Medium | Stated plainly rather than papered over (§5). The monitoring half does not depend on it; only firm-quote ranking does.                                                       |
| Single-key control of the oracle contract | High       | High   | Two-step admin transfer is implemented and tested; migration to an M-of-N multisig is a tracked operational task, not a code change.                                         |
| Solo-maintainer bus factor                | High       | High   | [`CONTRIBUTOR_LADDER.md`](CONTRIBUTOR_LADDER.md) defines Triager → Reviewer → Maintainer; [`SDK_HANDOFF.md`](SDK_HANDOFF.md) defines community SDK maintainership.           |
| Agent misuse                              | Low        | High   | The MCP surface is advisory and user-signed. No held keys, no autonomous spend.                                                                                              |

---

## 9. References

- **Positioning** (source of truth for claims) — [`POSITIONING.md`](POSITIONING.md)
- **Roadmap** — [`ROADMAP.md`](ROADMAP.md)
- **Architecture** — [`ARCHITECTURE.md`](ARCHITECTURE.md)
- **Anchor reputation methodology** — [`ANCHOR_REPUTATION.md`](ANCHOR_REPUTATION.md)
- **Oracle spec** — [`ORACLE_SPEC.md`](ORACLE_SPEC.md)
- **Non-custody manifesto** — [`NON_CUSTODY.md`](NON_CUSTODY.md)
- **Jurisdictional memo** — [`JURISDICTIONAL.md`](JURISDICTIONAL.md)
- **Intent API** — [`INTENT_API.md`](INTENT_API.md)
- **MCP spec** — [`MCP.md`](MCP.md)
- **Agent positioning vs. ROZO** — [`AGENT_POSITIONING.md`](AGENT_POSITIONING.md)
- **Issue tracker** — [GitHub Issues](https://github.com/ezedike-evan/stellar-intel/issues)
- **Stellar SEP-1** — [stellar.org/protocol/sep-1](https://stellar.org/protocol/sep-1)
- **Stellar SEP-10** — [stellar.org/protocol/sep-10](https://stellar.org/protocol/sep-10)
- **Stellar SEP-24** — [stellar.org/protocol/sep-24](https://stellar.org/protocol/sep-24)
- **Stellar SEP-38** — [stellar.org/protocol/sep-38](https://stellar.org/protocol/sep-38)
- **Model Context Protocol** — [modelcontextprotocol.io](https://modelcontextprotocol.io)

---

_This document is a living document. Changes are tracked in git; the version on
`main` is the current one._
