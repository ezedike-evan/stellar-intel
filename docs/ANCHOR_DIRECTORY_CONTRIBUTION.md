# Contributing to SDF's Anchor Directory

**Last reviewed:** 2026-08-26

Tracks issue [#796](https://github.com/ezedike-evan/stellar-intel/issues/796),
part of epic #794. Goal: contribute our live anchor health data (uptime, TOML
integrity, quote latency) back to SDF's public [Anchor
Directory](https://anchors.stellar.org/) — cheap legitimacy and an SDF
relationship builder.

## Research: does SDF accept third-party contributions?

**Short answer: not yet, and there is no published format.** As of this
writing:

- The Anchor Directory has no documented public ingestion API or submission
  schema. Its own [launch post](https://stellar.org/blog/developers/anchor-directory-guide-finding-interoperable-asset-issuers-on-off-ramps-stellar)
  does not describe one, and the directory explicitly disclaims completeness
  ("this directory is not comprehensive... we recommend checking block
  explorers like stellar.expert").
- **Attestation of Reserves** — the feature this issue is aimed at — has been
  listed as "coming soon" on the directory since its relaunch and, per our
  research, still has no public spec or ingestion channel.
- Getting listed or updating a listing today is a manual, contact-based
  process: each anchor tile links to an email contact, and prospective
  anchors are directed to reach out to SDF directly rather than submit
  through an API. There is no evidence SDF (or the directory) currently
  accepts unsolicited third-party health/uptime data from a project like
  ours.

This means step 1 of the issue's scope ("identify SDF's accepted contribution
format") has a real answer: **no such format exists yet.** The rest of this
doc treats that as the current state, not a blocker — we ship the export path
now so it's a non-event whenever SDF opens a channel.

## What we export today

`GET /api/reputation/sdf-export` (implementation:
[`lib/reputation/sdfExport.ts`](../lib/reputation/sdfExport.ts)) turns our
existing signals into a self-describing JSON document:

- **Health status** (`healthy` / `degraded` / `unknown`) and failure detail
  from the nightly validator's ledger (`constants/anchor-health.json`, see
  [`scripts/validate-anchors.mjs`](../scripts/validate-anchors.mjs) and
  [`lib/stellar/anchors.ts`](../lib/stellar/anchors.ts)) — this already covers
  TOML-reachability integrity and auto-clears once an anchor recovers.
- **Uptime and average latency**, derived from `uptime`-kind probe samples in
  the reputation store (`lib/reputation/probe.ts`), once the probe pipeline
  from #785/#786 is publishing real samples.
- **Per-corridor quote-latency percentiles** (p50/p95), derived from
  `quote`-kind probe samples the same way.

Each response carries a `schemaVersion` (currently `0.1.0-candidate`) and a
`note` field stating plainly that this is our own candidate shape, not an
SDF-endorsed one — so nobody downstream mistakes it for an official format.

### Example response shape

```json
{
  "schemaVersion": "0.1.0-candidate",
  "generatedAt": "2026-07-29T00:00:00.000Z",
  "source": "https://github.com/ezedike-evan/stellar-intel",
  "note": "SDF has not published an Anchor Directory ingestion API — ...",
  "anchors": [
    {
      "anchorId": "cowrie",
      "name": "Cowrie Exchange",
      "homeDomain": "cowrie.exchange",
      "serviceDomain": null,
      "seps": ["sep6", "sep10"],
      "corridors": ["usdc-ngn"],
      "health": {
        "status": "healthy",
        "lastCheckedAt": "2026-07-28T02:00:00.000Z",
        "lastError": null,
        "consecutiveFailures": 0,
        "uptime": 0.997,
        "avgLatencyMs": 184,
        "quoteLatencyByCorridor": {
          "usdc-ngn": { "p50Ms": 210, "p95Ms": 340, "sampleCount": 20 }
        }
      }
    }
  ]
}
```

## Known limitation: depends on #785

Until [#785](https://github.com/ezedike-evan/stellar-intel/issues/785) (the
publisher that writes probe-derived data on-chain) lands, uptime and
quote-latency fields will mostly read `null`/empty for anchors with no
accumulated probe samples yet — the export degrades honestly rather than
fabricating a number. Health `status` still reflects the nightly validator's
ledger regardless, since that pipeline is already live.

## How to actually contribute this today

Since there is no submission API to call, the current path is manual:

1. Fetch `GET /api/reputation/sdf-export` (or run it against production once
   deployed) to produce the current JSON snapshot.
2. Reach out via the contact link on each of our anchors' tiles in the
   [Anchor Directory](https://anchors.stellar.org/), or through SDF's general
   developer contact channels, and offer the export as supporting data for
   listing/attestation purposes.
3. If/when SDF publishes a real ingestion format, adapt
   `buildSdfAnchorDirectoryExport` in
   [`lib/reputation/sdfExport.ts`](../lib/reputation/sdfExport.ts) to emit
   that shape directly — the field mapping above should carry over with
   little change, since it's already built from the same uptime/latency/TOML
   signals SDF's "coming soon" attestation feature targets.
