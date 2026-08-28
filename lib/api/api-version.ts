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
 * Versions this build can serve.
 *
 * Semver, matching what responses actually advertise and what `info.version` in
 * the OpenAPI spec carries. docs/VERSIONING.md previously illustrated the
 * contract with date-style versions (`v2026-07-01`) that nothing has ever
 * emitted; the doc is corrected alongside this rather than a second, fictional
 * scheme being implemented to match it.
 */
export const SUPPORTED_API_VERSIONS: readonly string[] = [API_VERSION];

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
 */
export function negotiateApiVersion(headers: Headers): VersionNegotiation {
  const raw = headers.get('API-Version');
  const requested = raw?.trim() ? raw.trim() : null;

  if (requested === null) return { ok: true, requested: null };
  return { ok: SUPPORTED_API_VERSIONS.includes(requested), requested };
}
