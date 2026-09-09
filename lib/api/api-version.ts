/**
 * The public API's version, kept in sync with `info.version` in
 * lib/api/openapi.ts / public/openapi.json.
 *
 * Its own module, with no imports, because `lib/logger.ts` stamps it on every
 * response. Reading it from `lib/api/response.ts` would drag that module's
 * dependency chain — rate-limit, shared-state, `pg` — into the logger, which
 * almost every file in the app imports.
 */
export const API_VERSION = '1.3.0';

/**
 * The support window docs/VERSIONING.md's "Version support window" table
 * promises: an outgoing version keeps working for this many days after a new
 * one supersedes it.
 */
export const SUPPORT_WINDOW_DAYS = 180;

/**
 * One entry per version this build has ever shipped, in the order shipped.
 * `supersededAt` is null for whichever entry is current; every other entry
 * must have one, recording the moment it stopped being current — not the
 * moment it was announced deprecated, which per docs/VERSIONING.md's
 * four-phase lifecycle can be much earlier.
 *
 * This is real history, not a fixture: only one version has ever shipped, so
 * there is exactly one entry, permanently current, until a second version is
 * actually cut. Bumping `API_VERSION` without adding the outgoing value here
 * (`supersededAt` set to the cutover date) breaks pinned clients immediately
 * instead of over the documented 180 days — that is the "mechanical change"
 * this file used to describe as the missing piece.
 */
export interface ApiVersionRecord {
  version: string;
  /** ISO 8601 timestamp this version stopped being current, or null while it still is. */
  supersededAt: string | null;
}

export const API_VERSION_HISTORY: readonly ApiVersionRecord[] = [
  { version: API_VERSION, supersededAt: null },
];

/**
 * Versions still inside the support window, in `history` order (current
 * first). A superseded version drops out once `now` passes
 * `supersededAt + SUPPORT_WINDOW_DAYS`, per docs/VERSIONING.md's "Version
 * support window" table.
 *
 * `history`/`now` are overridable so the 180-day boundary itself can be
 * tested (tests/api-version-negotiation.spec.ts) without waiting on real
 * production history to contain a second, retired version.
 */
export function computeSupportedApiVersions(
  history: readonly ApiVersionRecord[] = API_VERSION_HISTORY,
  now: Date = new Date()
): string[] {
  const cutoff = SUPPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return history
    .filter((record) => {
      if (record.supersededAt === null) return true;
      return now.getTime() - new Date(record.supersededAt).getTime() < cutoff;
    })
    .map((record) => record.version);
}

/**
 * Versions this build can serve right now. Computed from
 * {@link API_VERSION_HISTORY}, not hardcoded — see {@link computeSupportedApiVersions}.
 * Has exactly one element today because exactly one version has ever shipped,
 * not because the window is unimplemented; see docs/VERSIONING.md's "Version
 * support window" section.
 */
export const SUPPORTED_API_VERSIONS: readonly string[] = computeSupportedApiVersions();

export interface VersionNegotiation {
  ok: boolean;
  /** The version the client asked for, or null when it did not ask. */
  requested: string | null;
}

/**
 * Resolves the request's `API-Version` header against what this build serves.
 *
 * Omitting the header means "latest", per the documented contract — pinning is
 * opt-in, so an existing client is never broken by this becoming enforced.
 *
 * `supportedVersions` defaults to the real computed window and is overridable
 * purely for testing the deprecated-but-still-supported case end to end,
 * without waiting on real production history to contain a retired version.
 */
export function negotiateApiVersion(
  headers: Headers,
  supportedVersions: readonly string[] = SUPPORTED_API_VERSIONS
): VersionNegotiation {
  const raw = headers.get('API-Version');
  const requested = raw?.trim() ? raw.trim() : null;

  if (requested === null) return { ok: true, requested: null };
  return { ok: supportedVersions.includes(requested), requested };
}
