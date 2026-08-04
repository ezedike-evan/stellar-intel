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
