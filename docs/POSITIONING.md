# Positioning

Where this project sits relative to the things it is most often confused with.
Each section states a claim and then says how to check it, because a positioning
document that cannot be falsified is marketing.

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
   set** — currently seven anchors — against a directory that lists many more.
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
