# API Versioning & Deprecation Policy

> What `API-Version` guarantees, how breaking changes are announced, and how
> long old versions are supported. Every consumer of the Stellar Intel API —
> whether a web app, an MCP agent, or a third-party integration — should read
> this document once.

**Last reviewed:** 2026-08-26

---

## Table of contents

- [Versioning scheme](#versioning-scheme)
- [What constitutes a breaking change](#what-constitutes-a-breaking-change)
- [Deprecation process](#deprecation-process)
- [Version support window](#version-support-window)
- [Announcement channels](#announcement-channels)
- [API-Version header](#api-version-header)
- [Experimental endpoints](#experimental-endpoints)
- [Related](#related)

---

## Versioning scheme

The public API uses a **date-based versioning** scheme: `vYYYY-MM-DD` (e.g.
`v2026-07-01`). This allows asynchronous, semantic releases without the
overhead of a monotonically incrementing integer major version. Each date
version is a stable snapshot of the API surface.

| Component      | Version identifier           | Where it lives                  |
| -------------- | ---------------------------- | ------------------------------- |
| HTTP API       | `v2026-07-01`                | `Accept` / `API-Version` header |
| Soroban oracle | Contract address (immutable) | `.deployments/{network}.json`   |
| MCP tools      | `@stellarintel/mcp` npm      | `package.json` version          |
| TypeScript SDK | `@stellarintel/sdk` npm      | `package.json` version          |
| OpenAPI spec   | `v1` (snapshot)              | `public/openapi.json`           |

The HTTP API and the Soroban oracle are versioned independently. The REST API
may ship `v2026-10-01` while the oracle contract remains at its initial
deployment address.

---

## What constitutes a breaking change

A change is **breaking** if it requires a consumer to modify their code to
avoid a silent behaviour change or a runtime error:

- Removing or renaming a REST endpoint, query parameter, or request body field
- Changing the type, format, or nullability of a response field
- Adding a new required request header or authentication scheme
- Changing a Soroban contract entrypoint signature or renaming it
- Changing the MCP tool name, input schema, or output shape
- Removing an env var that operators rely on

The following are **not** breaking:

- Adding a new endpoint, field, or optional query parameter
- Extending the OpenAPI spec with new schemas
- Adding a new MCP tool
- Enlarging a response with an optional field (consumers that forward
  unknown keys are safe; consumers that deserialise into a closed type
  may break — use open-ended deserialisation)
- Bug fixes that align behaviour with documented contracts

---

## Deprecation process

> **Not yet implemented.** The lifecycle below is the intended policy, not a
> description of running code. Grepping `lib/` and `app/` for `sunset`,
> `Deprecation:` or `Warning: 299` returns nothing — there is no helper, no
> middleware, and no route emitting these headers. `lib/logger.ts` stamps
> `API-Version` on every response and nothing else. Treat this section as the
> contract a future implementation must satisfy; see the tracking issue in
> [`CHANGELOG.md`](../CHANGELOG.md).

Every breaking change follows a four-phase lifecycle:

| Phase                | Duration    | What happens                                                                                                           |
| -------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Announce**         | Day 0       | Deprecation notice posted on announcement channels (see below). The old endpoint or field continues to work unchanged. |
| **Soft deprecation** | Days 0–90   | The old path still works. Responses include a `Warning: 299 - "deprecated"` header. Logs may warn on server side.      |
| **Hard deprecation** | Days 90–180 | The old path returns `200` + a `Sunset` header with the removal date. Instrumentation counts usage.                    |
| **Removal**          | Day 180+    | The old path returns `410 Gone` or a Soroban contract error. Consumers must have migrated.                             |

Phase durations are minimums. A deprecated endpoint may be kept longer if
usage remains high, announced via an extended sunset notice.

**Expedited removal** (30-day minimum) is reserved for:

- Security vulnerabilities that cannot be fixed while preserving the old
  contract
- Data-corruption bugs in a Soroban contract entrypoint
- Legal or regulatory requirements

Expedited removals are announced on all channels with the reason.

---

## Version support window

| Surface                          | Supported versions       | Window                                            |
| -------------------------------- | ------------------------ | ------------------------------------------------- |
| HTTP REST API                    | Current + 1 previous¹            | Intended: current + 1 previous, 180 days          |
| Soroban oracle contract          | Current deployed address | Until a migration is announced and executed       |
| MCP tools                        | Latest npm release only  | Semver within `@stellarintel/mcp`                 |
| TypeScript SDK                   | Latest npm release only  | Semver within `@stellarintel/sdk`                 |
| Web UI (`app.stellar-intel.com`) | Latest only              | No version guarantee — always use the current URL |

¹ **The stated window is not yet what the code enforces.**
`SUPPORTED_API_VERSIONS` in `lib/api/api-version.ts` contains exactly one
element, and `negotiateApiVersion` rejects anything else with a 400. So there is
no "previous" version to fall back to, and the 180-day window has never been
exercised. It becomes true the first time a version ships and the outgoing one
is appended to that array — which is the mechanical change required, not a
rewrite. `tests/api-version-negotiation.spec.ts` asserts this row against the
array so the two cannot drift apart again.

REST API consumers should specify an `API-Version` header to lock their
integration to a known surface. Unsigned requests default to the latest
version, which may change without notice.

---

## Announcement channels

Deprecations and breaking changes are announced on:

1. **GitHub releases** — every versioned API release is a GitHub Release with
   a changelog entry. Subscribe at
   `https://github.com/ezedike-evan/stellar-intel/releases`.
2. **CHANGELOG.md** — the `[Unreleased]` section lists pending deprecations;
   dated sections record shipped ones.
3. **API response headers** _(not yet implemented)_ — deprecated endpoints will
   return `Sunset` and `Warning` headers (see deprecation process above).
4. **Status page** _(not yet implemented)_ — there is no `app/api/status/route.ts`,
   and `announced_deprecations` appears nowhere in `lib/` or `app/`. The intent
   is that `https://stellar-intel.vercel.app/api/status` returns it as a JSON
   array.
5. **Mailing list** — subscribe at
   `https://stellar-intel.vercel.app/updates` (planned).

---

## API-Version header

```http
Accept: application/json
API-Version: 1.3.0
```

The `API-Version` request header selects the API version for the request.
Omit it to receive the latest version (subject to change).

| Behaviour                             | Version sent         | Response                                         |
| ------------------------------------- | -------------------- | ------------------------------------------------ |
| Consumer targets a known version      | `API-Version: 1.3.0` | That version's surface                           |
| Consumer omits the header             | (none)               | Latest version — may change                      |
| Consumer sends an unsupported version | `API-Version: 0.9.0` | `400 Bad Request` with supported versions listed |

**Migration.** To move from one version to the next, update the `API-Version`
header and adjust for any breaking changes listed in the changelog.

**Current status.** Implemented in both directions (#888).

Responses are stamped with `API-Version` by the request wrappers in
`lib/logger.ts`, so it is present on every response — including error responses
— rather than on the handful of routes that used to set it by hand. The value
comes from `lib/api/api-version.ts`, and a test asserts it matches
`info.version` in `public/openapi.json`.

Requests may pin a version with the same header. An unsupported value returns
`400` with a `supportedVersions` list; omitting the header still means "latest",
so pinning is opt-in and no existing client is broken by the check.

**Known mismatch with the scheme above.** The _Versioning scheme_ section
declares date-based versions (`vYYYY-MM-DD`), but nothing has ever emitted one.
`API-Version` carries the semver spec version (`1.3.0`), kept in step with
`info.version` in `public/openapi.json`, and that is what the negotiation
accepts. Adopting date versions is a live decision, not an oversight in the
implementation: it means changing `API_VERSION` in `lib/api/api-version.ts` and
adding the old value to `SUPPORTED_API_VERSIONS` so pinned clients keep working
across the switch. Documented here rather than resolved silently in either
direction.

---

## Experimental endpoints

> **Not yet implemented.** No route lives under `/api/v1/experimental/` and
> nothing emits `X-Experimental`. The convention is reserved here so that the
> first experimental endpoint has a stated contract rather than inventing one.

Endpoints under `/api/v1/experimental/` or marked with `X-Experimental: true`
in their response header are **not covered** by this deprecation policy. They
may change or disappear at any time without notice. Do not depend on them in
production.

An experimental endpoint graduates to stable after:

1. At least one release cycle (180 days) of field use
2. A documented contract in `public/openapi.json`
3. A `CHANGELOG.md` entry marking it stable

---

## Related

- [`docs/ROADMAP.md`](ROADMAP.md) — when breaking changes are planned relative
  to waves.
- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — how the API and oracle fit into
  the system.
- [`CHANGELOG.md`](../CHANGELOG.md) — per-release changelog with deprecation
  notices.
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — conventions for PRs that introduce
  or remove API surface.
