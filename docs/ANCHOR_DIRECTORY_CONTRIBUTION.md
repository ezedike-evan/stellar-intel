# Contributing to SDF's Anchor Directory

**Last reviewed:** 2026-08-29

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

- **Identity and coverage** — anchor id, name, domains, declared SEPs and
  corridors, read straight from the registry in
  [`constants/anchors.ts`](../constants/anchors.ts).
- **Health status** (`healthy` / `degraded` / `unknown`) and failure detail
  from the nightly validator's anchor health ledger
  (`constants/anchor-health.json`, see
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

### Field provenance

Every field in an `anchors[]` entry, and where it comes from. The two sources
behind `health` are different ledgers with different keys and lifetimes — see
[the two health ledgers](ANCHOR_ONBOARDING.md#the-two-health-ledgers).

| Export field                    | Source                                                                      |
| ------------------------------- | --------------------------------------------------------------------------- |
| `anchorId`, `name`, `corridors` | Registry (`Anchor.id`, `.name`, `.corridors`)                               |
| `homeDomain`, `serviceDomain`   | Registry. `serviceDomain` is `null` when the entry omits it                 |
| `seps`                          | Registry `Anchor.seps`, or `[]` when the entry declares none                |
| `health.status`                 | Derived from the anchor ledger — see the rule below                         |
| `health.lastStatus`             | Anchor ledger `lastStatus` (`ok` / `fail` / `unknown`), `null` if untracked |
| `health.lastCheckedAt`          | Anchor ledger `lastCheckedAt`, `null` if never probed                       |
| `health.lastError`              | Anchor ledger `lastError`                                                   |
| `health.consecutiveFailures`    | Anchor ledger `consecutiveFailures`, `0` if untracked                       |
| `health.uptime`                 | Probe ledger — fraction of reachable `uptime` rows; `null` with no samples  |
| `health.avgLatencyMs`           | Probe ledger — mean latency over reachable `uptime` rows; `null` with none  |
| `health.quoteLatencyByCorridor` | Probe ledger — p50/p95 over the last 20 reachable `quote` rows per corridor |

Two derivations are worth stating outright, because both are easy to misread:

- **`status` tracks `degraded`, not `lastStatus`.** It is `unknown` when the
  anchor has no ledger entry or has never been checked
  (`lastCheckedAt === null`), `degraded` when the ledger's `degraded` flag is
  set, and `healthy` otherwise. An anchor that failed last night but has not yet
  reached `thresholdNights` therefore exports as `healthy` with
  `lastStatus: "fail"` and a non-zero `consecutiveFailures` — which is the
  intended debounce, not a bug. Read `lastStatus` and `consecutiveFailures`
  alongside `status`, never `status` alone.
- **Probe rows are keyed by resolved domain, the ledger by anchor id.** Uptime
  and quote figures are looked up under `serviceDomain ?? homeDomain`, so an
  anchor whose SEP endpoints moved to a new service domain starts from an empty
  probe history under the new one even though its ledger entry, keyed by id,
  carries straight over.

A newly registered anchor has no ledger entry until the next nightly run, so it
exports as `status: "unknown"` with `consecutiveFailures: 0` rather than being
omitted.

### Example response shape

```json
{
  "schemaVersion": "0.1.0-candidate",
  "generatedAt": "2026-08-29T00:00:00.000Z",
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
        "lastStatus": "fail",
        "lastCheckedAt": "2026-08-26T04:57:02.450Z",
        "lastError": "missing TRANSFER_SERVER_SEP0024 (SEP-24)",
        "consecutiveFailures": 2,
        "uptime": 0.997,
        "avgLatencyMs": 184,
        "quoteLatencyByCorridor": {}
      }
    }
  ]
}
```

Cowrie is a deliberate example rather than a tidy one — it is what the registry
and the committed ledger actually say today, and it shows three of the
derivations above at once:

- `status: "healthy"` beside `lastStatus: "fail"` — two failures, below the
  three-night `thresholdNights`, so the debounce has not latched `degraded` yet.
- The `lastError` is the SEP-6-only case: Cowrie advertises `TRANSFER_SERVER`
  but no `TRANSFER_SERVER_SEP0024`, and the nightly validator's success
  condition is SEP-24 specifically. See
  [`docs/ANCHOR_ONBOARDING.md`](ANCHOR_ONBOARDING.md#what-the-probes-require).
- `quoteLatencyByCorridor` is empty because Cowrie advertises no
  `ANCHOR_QUOTE_SERVER`, so the SEP-38 quote probe has nothing to call. Absence
  here means "no quote server", not "slow".

### Known drift: the `note` field's doc path

The `note` string in every export, and the module comments in
[`lib/reputation/sdfExport.ts`](../lib/reputation/sdfExport.ts) and
[`app/api/reputation/sdf-export/route.ts`](../app/api/reputation/sdf-export/route.ts),
point readers at `docs/anchor-directory-contribution.md`. This file is
`docs/ANCHOR_DIRECTORY_CONTRIBUTION.md`, so that path resolves nowhere — and
because it ships inside the payload, a recipient of the export follows it too.
Worth correcting alongside the next change to that module.

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
