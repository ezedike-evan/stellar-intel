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
