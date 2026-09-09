# Positioning

**Last reviewed:** 2026-08-26

Where this project sits relative to the things it is most often confused with.
Each section states a claim and then says how to check it, because a positioning
document that cannot be falsified is marketing.

---

## What this is

**An anchor health and reputation record for Stellar off-ramps, with an
execution path built on top of it.**

Monitoring is the load-bearing half and it comes first, because it is the half
that works without anyone's cooperation. A probe needs no partnership, no
listing, and no permission: it asks an anchor's public endpoints what they do
and writes down the answer. Execution is real and is in the repository, but it
depends on anchors, corridors and liquidity that this project does not control.

Stating it in that order is not modesty. Getting it backwards is how a project
ends up claiming an execution capability whose quality is set by third parties
who never agreed to anything.

### What this is not

The earlier framing was "the execution layer for stablecoin value on Stellar"
and a "universal intent layer". Both are retired, for two separate reasons.

**"Universal" was never true of the scope.** This is a Stellar project about
fiat off-ramps through SEP anchors. It is not chain-agnostic, not a general
payments product, and not a routing layer for value in general. The vocabulary
also now belongs to other projects in the ecosystem — see the ROZO section
below — so using it invited a comparison on ground this project does not
occupy.

**"Execution layer" led with the dependent half.** Compare what each half needs
to be true:

|                     | needs                                 | status                       |
| ------------------- | ------------------------------------- | ---------------------------- |
| Health + reputation | public endpoints, a clock             | works today                  |
| Execution           | anchors, corridors, liquidity, quotes | constrained by third parties |

### The claims this replaces, and why

Three statements in earlier copy do not survive contact with the live network.
They are listed rather than quietly deleted, because the point of narrowing is
to stop making them.

1. **"Live SEP-38 quotes across every integrated anchor."** On 2026-08-05,
   **one of six registered anchors advertises `ANCHOR_QUOTE_SERVER` at all**,
   and that one does not quote the corridor it is registered for. Comparing
   firm quotes across anchors is not a thing that can be done today, because
   the quotes do not exist. The worked evidence is in the Anchor Directory
   section below.
2. **"Every quote, fill, failure and settlement is written to a public
   reputation oracle."** The publisher and the Soroban contract exist. Whether
   a given deployment has published anything is a question about data, not
   code, and `GET /api/reputation/probe-coverage` is the honest answer to it.
3. **"Ranked by net landed value."** The ranking code is real, but a fill-rate
   penalty computed from an empty sample ranks on priors. It becomes true when
   the probe window is non-empty, and not before.

None of those is a hard problem to fix. Two of the three are fixed by the clock
running for long enough. The narrowing exists so the copy stops running ahead
of the data.

### What is actually true today

- Seven registered anchors, probed every five minutes across four signals:
  uptime, quote availability, issuer mismatch, TOML integrity.
- A published methodology for turning those samples into a score, with small
  samples labelled as small.
- A non-custodial execution path: every leg is signed by the user, the anchor
  takes custody under SEP-24, and this project never holds funds.
- An MCP surface exposing the same primitives the web UI uses.

The distinguishing claim is narrow and checkable: **this project writes down
what anchors did, on a clock, and publishes both the record and the method.**

---

## The live-data complement to SDF's Anchor Directory

[SDF's Anchor Directory](https://anchors.stellar.org/) is the canonical answer to
**"which anchors exist, and what do they say they do?"** This project answers a
different question: **"what did they actually do this week?"**

Those are complements. The directory is the register; this is the observation
record. Neither substitutes for the other, and the useful framing is not that the
directory is deficient — it is that a register and a monitor are different
artifacts with different refresh semantics.

### What the directory publishes

Per its [launch post](https://stellar.org/blog/tools-solutions/anchor-directory-guide-finding-interoperable-asset-issuers-on-off-ramps-stellar),
a directory entry carries:

- anchor name
- country of operation
- supported assets
- supported standards (SEP-6, SEP-24, SEP-31)
- anchor type and key services
- contact details and web links

Every one of those is a **declaration**. It describes what an anchor has told the
directory about itself, and it is correct until the anchor's deployment changes
without the listing changing with it.

Two properties follow, and both are stated by SDF rather than inferred here:

- **Attestation of Reserves is listed but not yet live.** The launch post
  describes an icon that "will enable you to review attestation reports produced
  by certain issuing anchors on Stellar" — future tense. As of 2026-08-05 there
  is still no public spec or ingestion channel for it (see
  [`ANCHOR_DIRECTORY_CONTRIBUTION.md`](ANCHOR_DIRECTORY_CONTRIBUTION.md)).
- **The directory disclaims completeness.** Its own guidance is that it "is not
  comprehensive" and recommends block explorers like stellar.expert for a fuller
  issuer list.

There is also no documented public ingestion API, so a listing is updated through
a manual, contact-based process. That is a reasonable design for a register. It
is simply not a design that tracks week-to-week behaviour.

### What a declaration cannot tell you

A supported-standards field says an anchor implements SEP-24. It cannot say
whether the endpoint answered this morning, how long it took, whether the
`stellar.toml` still parses, whether the advertised corridor is actually
quotable, or whether the issuer in the TOML still matches the asset on-chain.

Those are the questions that decide whether a payment succeeds, and none of them
is answerable from a listing — not because the listing is wrong, but because it
is a different kind of statement. A register records intent; only a probe records
outcome.

### What this project adds

A clock. Every five minutes, four sinks record what each registered anchor did:
uptime, quote availability, issuer-mismatch, and TOML integrity. Those samples
accumulate into the reputation surface described in
[`ANCHOR_REPUTATION.md`](ANCHOR_REPUTATION.md).

The distinction in one line:

|                | Anchor Directory      | Stellar Intel                |
| -------------- | --------------------- | ---------------------------- |
| Question       | who exists            | who is working               |
| Source of data | anchor self-report    | direct observation           |
| Refresh        | manual, contact-based | every 5 minutes              |
| Unit           | a listing             | a time series                |
| Fails when     | an anchor changes     | an anchor's endpoint changes |

### The honest limits of this claim

Three things this section deliberately does not say:

1. **Not "the directory is stale."** It is a register, refreshed when anchors ask
   for it. Judging it by a monitor's refresh rate would be judging it against a
   purpose it never claimed.
2. **Not "we are more complete."** This project tracks a **small registered
   set** — currently six anchors — against a directory that lists many more.
   On coverage the directory wins outright.
3. **Not "reserve attestation is a gap we fill."** It is not implemented here
   either. It is noted as pending on SDF's side because
   [`ANCHOR_DIRECTORY_CONTRIBUTION.md`](ANCHOR_DIRECTORY_CONTRIBUTION.md) tracks
   contributing to it, not because this project has it.

### How to check any of this

The directory's fields and the "coming soon" attestation language are in the
launch post linked above. The observation side is checkable directly:
`GET /api/reputation/probe-coverage` reports the window actually covered, and
`GET /api/reputation/sdf-export` shows exactly what this project would contribute
if SDF opened a channel.

If `probe-coverage` reports an empty window, the claim in this section is not
true yet, and the honest reading is that the clock has not been running. That is
the falsification test.

### Worked examples

**Captured 2026-08-05.** Anchor listings and TOML files both change, so treat
every row below as a dated observation rather than a standing fact — and re-run
the commands before reusing any of it.

Two different things get conflated as "gaps", and they deserve separating:

- **Type A — the listing disagrees with the file it links to.** A real
  discrepancy, checkable by anyone in one command.
- **Type B — the directory does not carry that kind of data at all.** Not an
  error. A register is not supposed to.

#### A1. Zeam's listing both over- and under-states its standards

The directory lists Zeam's `supported_standards` as **SEP-6, SEP-31, SEP-24**,
and gives `toml_file` as `https://mint.zeam.money/.well-known/stellar.toml`.

That TOML — the file the directory itself points at — contains:

```
WEB_AUTH_ENDPOINT       = "https://anchor.zeam.money/auth"
ANCHOR_QUOTE_SERVER     = "https://anchor.zeam.money/sep38"
DIRECT_PAYMENT_SERVER   = "https://anchor.zeam.money/sep31"
TRANSFER_SERVER_SEP0024 = "https://anchor.zeam.money/sep24"
```

There is **no `TRANSFER_SERVER`**, so SEP-6 is listed but not advertised. And
`ANCHOR_QUOTE_SERVER` is present, so **SEP-38 is advertised but not listed**.
The listing is wrong in both directions against its own cited source.

The SEP-38 omission is the more consequential one: Zeam is the only anchor in
our registry that advertises a quote server at all, and the directory is the
place a reader would look to discover that.

```bash
curl -s https://mint.zeam.money/.well-known/stellar.toml | grep -E 'TRANSFER_SERVER|ANCHOR_QUOTE_SERVER|DIRECT_PAYMENT'
```

#### A2. Anclap is listed with SEP-31 and no TOML link

The directory lists `supported_standards` as **SEP-6, SEP-24, SEP-31** with
`toml_file: null`. The live file at `anclap.com` advertises `TRANSFER_SERVER`
(SEP-6) and `TRANSFER_SERVER_SEP0024` (SEP-24), and has **no
`DIRECT_PAYMENT_SERVER`** — SEP-31 is listed but not advertised.

Because `toml_file` is null, the listing carries nothing to check itself
against. The discrepancy is only visible if you already know where to look.

```bash
curl -s https://anclap.com/.well-known/stellar.toml | grep -E 'TRANSFER_SERVER|DIRECT_PAYMENT_SERVER'
```

#### A3. The control case — MoneyGram is correct

The directory lists MoneyGram as **SEP-24 only**. Its TOML advertises
`TRANSFER_SERVER_SEP0024` and nothing else. **The listing is exactly right.**

Recorded deliberately: a check that only ever reports discrepancies is not a
check. Two of the three listings we could verify were wrong; the third was
right.

#### B1. Two anchors we track are not listed at all

`cowrie.exchange` and `ngnc.online` both serve a valid `stellar.toml` and both
serve the USDC→NGN corridor. Neither appears in the directory. This is the
directory's documented incompleteness rather than a defect — but it means the
NGN corridor cannot be researched from the directory alone.

#### B2. "Supported" does not mean "quotable in your corridor"

Zeam is registered here for `usdc-zar`. Its live SEP-38 `/info` at
`https://anchor.zeam.money/sep38/info` returns exactly three assets:

```
stellar:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
stellar:BRL:GDVKY2GU2DRXWTBEYJJWSFXIGBZV6AZNBVVSUHEPZI54LIS6BA7DVVSP
iso4217:BRL
```

**No ZAR.** The anchor supports SEP-38; it just does not quote the corridor it
is registered for. No `supported_standards` field can express that, because the
answer is per-corridor and changes without the listing changing.

Relatedly, none of the three anchors serving USDC→NGN advertises an
`ANCHOR_QUOTE_SERVER` at all, so **no firm quote exists for that corridor from
any registered anchor** — the finding behind #720, re-confirmed on this date.

#### B3. Attestation of Reserves is present but empty

The field exists on every entry and currently carries `"N/A"` for Zeam and
MoneyGram and `"No"` for Anclap. Consistent with the launch post's future tense.
Nothing here fills that gap either — see the third caveat above.

#### Reproducing the listing side

The directory is a client-rendered app with no public API, so the listings above
were read out of the server-rendered payload:

```bash
curl -s https://anchors.stellar.org/ > directory.html
grep -o 'supported_standards[^}]*' directory.html
```

One caveat on method, since it changes how much weight A1–A3 carry: this was a
one-shot read of five listings, not a systematic diff of the whole directory. It
establishes that listing-vs-TOML drift is real and easy to find. It does **not**
establish a rate, and this document should not be read as claiming one.

---

## ROZO — different layer, not a competitor

**ROZO moves value between chains. This project measures whether a fiat anchor
does what it says.** ROZO's own surfaces describe a settlement path that is
crypto to crypto — Stellar USDC into a ROZO account, Base USDC out to the
merchant, funded from ROZO-owned inventory — and mention neither anchors nor
SEP-6/24/31/38 anywhere. This project holds no funds and moves nothing; it
records what registered anchors did, so that whoever _is_ moving value can pick
one on evidence. The two touch at exactly one point, and it is a join rather
than an overlap: an intent that ends in fiat has to leave through an anchor, and
which anchor that is decides the price and whether it arrives at all. That makes
ROZO a plausible consumer of this data, not a rival for it.

### Do not differentiate on the rail

The obvious version of this paragraph — "ROZO bridges with CCTP, we don't" — is
one this document deliberately does not make.

CCTP appears in ROZO's marketing and in third-party coverage, but **their own
IntentPay technical documentation does not mention it**; what it describes is
prefunded ROZO-owned inventory plus an in-house Intent API for asynchronous
rebalancing, built so the user never waits for bridge finality. Differentiating
on the rail would mean arguing against a claim their engineers do not make,
about an implementation detail they can change on any Tuesday without changing
what the product is.

Scope is the durable axis. Rails are not.

|              | ROZO                       | Stellar Intel                  |
| ------------ | -------------------------- | ------------------------------ |
| Moves value  | yes, across chains         | no — non-custodial by design   |
| Touches fiat | no, crypto settlement only | yes, that is the subject       |
| Which anchor | not applicable             | the entire product             |
| Unit of work | a payment intent           | an anchor's observed behaviour |

Sources, retrieval dates and the full notes are in
[`research/ROZO_POSITIONING.md`](research/ROZO_POSITIONING.md).

### Integration conversation: not yet opened

**Status as of 2026-08-05: no contact has been made.** #711 tracks the outreach
and has not been actioned. Nothing in this section should be read as implying a
relationship, a conversation in progress, or any awareness on ROZO's part that
this project exists.

That issue should open with the complement rather than the contrast — the useful
opening question is which anchor their fiat-terminating intents exit through
today and how they choose, not a comparison neither side asked for. Update this
subsection with the outcome, including if the answer is that they were not
interested.

### When this stops being true

The "Visa layer for stablecoins" framing on their marketing site is broader than
IntentPay's documented scope. **If ROZO extends into fiat off-ramp, the scope
distinction above narrows and this whole section needs rewriting** — that is the
trigger to watch, recorded here so it is a scheduled re-check rather than
something noticed late.
