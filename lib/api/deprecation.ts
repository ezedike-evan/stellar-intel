/**
 * Deprecation headers for a pinned, superseded-but-still-supported API
 * version — the "Soft deprecation" / "Hard deprecation" phases
 * docs/VERSIONING.md's four-phase lifecycle describes.
 *
 * Kept alongside lib/api/api-version.ts rather than folded into it: this
 * module is imported wherever a route or wrapper needs to *react* to a
 * deprecated pin (lib/logger.ts, app/api/status/route.ts), while
 * api-version.ts stays the minimal, import-free source of truth every
 * response reads `API-Version` from.
 */
import {
  API_VERSION,
  API_VERSION_HISTORY,
  SUPPORT_WINDOW_DAYS,
  type ApiVersionRecord,
} from './api-version';

export interface DeprecationHeaders {
  /** RFC 7231 HTTP-date the pinned version stops being served, or null if it isn't deprecated. */
  sunset: string | null;
  /** RFC 7234 `Warning: 299` value, or null if the pinned version isn't deprecated. */
  warning: string | null;
}

const NOT_DEPRECATED: DeprecationHeaders = { sunset: null, warning: null };

/**
 * Sunset/Warning headers for `requestedVersion`, or nulls when it isn't a
 * deprecated-but-still-supported version — the current version, an unknown
 * one (negotiation already rejects those before this runs), or no pin at all.
 *
 * `history`/`now` are overridable for the same reason
 * {@link import('./api-version').computeSupportedApiVersions} takes them: the
 * 180-day boundary needs to be testable without a real retired version.
 */
export function computeDeprecationHeaders(
  requestedVersion: string | null,
  history: readonly ApiVersionRecord[] = API_VERSION_HISTORY,
  now: Date = new Date()
): DeprecationHeaders {
  if (!requestedVersion || requestedVersion === API_VERSION) return NOT_DEPRECATED;

  const record = history.find((r) => r.version === requestedVersion);
  if (!record || record.supersededAt === null) return NOT_DEPRECATED;

  const sunsetAt = new Date(
    new Date(record.supersededAt).getTime() + SUPPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );
  // Already past the window — negotiateApiVersion would have rejected this
  // pin before deprecation headers were ever computed for it, but a caller
  // passing a stale `now` (e.g. a test) shouldn't get a header claiming a
  // sunset date that has already passed.
  if (now.getTime() >= sunsetAt.getTime()) return NOT_DEPRECATED;

  return {
    sunset: sunsetAt.toUTCString(),
    warning: `299 - "Deprecated API version ${requestedVersion}; sunsets ${sunsetAt.toISOString().slice(0, 10)}"`,
  };
}

/** Deprecated versions currently announced, for `/api/status`'s `announced_deprecations`. */
export interface AnnouncedDeprecation {
  version: string;
  supersededAt: string;
  sunsetAt: string;
}

export function getAnnouncedDeprecations(
  history: readonly ApiVersionRecord[] = API_VERSION_HISTORY,
  now: Date = new Date()
): AnnouncedDeprecation[] {
  return history
    .filter((record): record is ApiVersionRecord & { supersededAt: string } => {
      if (record.supersededAt === null) return false;
      const headers = computeDeprecationHeaders(record.version, history, now);
      return headers.sunset !== null;
    })
    .map((record) => ({
      version: record.version,
      supersededAt: record.supersededAt,
      sunsetAt: new Date(
        new Date(record.supersededAt).getTime() + SUPPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000
      ).toISOString(),
    }));
}
