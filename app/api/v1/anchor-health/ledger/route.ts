import { NextRequest, NextResponse } from 'next/server';
import { withV1 } from '@/lib/api/v1';
import {
  latestLedgerArtifact,
  ledgerArtifactForDate,
  LedgerLookupError,
} from '@/lib/stellar/health-ledger';

export const runtime = 'nodejs';

/**
 * `GET /api/v1/anchor-health/ledger[?date=YYYY-MM-DD]` (#1098)
 *
 * Publishes the nightly anchor health ledger as a dated artifact.
 * `constants/anchor-health.json` stays the source of truth — this route reads
 * it, and reads its own git history for past dates, rather than keeping a
 * second copy that could drift from it. Without this, a consumer who wanted the
 * series had to clone the repository and walk commits.
 *
 * Every response names the `version` it is serving (the `YYYY-MM-DD` the ledger
 * describes, from its own `updatedAt`), so two fetches that return the same
 * version returned the same ledger.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return withV1(request, { bucket: 'v1.anchor-health.ledger', maxRequests: 60 }, async (ctx) => {
    const date = request.nextUrl.searchParams.get('date');

    try {
      const artifact = date ? await ledgerArtifactForDate(date) : latestLedgerArtifact();

      return {
        status: 200,
        body: artifact,
        headers: {
          // A past date can never change, so it is cacheable indefinitely. The
          // latest is rewritten nightly, so it is not.
          'Cache-Control':
            artifact.source === 'git-history'
              ? 'public, max-age=86400, immutable'
              : 'public, max-age=300, stale-while-revalidate=3600',
          // The version is the artifact's identity; exposing it as an ETag lets
          // a poller skip the body once the ledger stops changing.
          ETag: `"anchor-health-${artifact.version}"`,
        },
      };
    } catch (error) {
      if (error instanceof LedgerLookupError) {
        switch (error.code) {
          case 'INVALID_DATE':
            return ctx.error('validation_error', error.message, 400);
          case 'NOT_FOUND':
            return ctx.error('not_found', error.message, 404);
          case 'UPSTREAM_UNAVAILABLE':
            // The archive is a different dependency from this app: say so,
            // rather than reporting our own failure for GitHub being down.
            return ctx.error('upstream_unavailable', error.message, 502);
        }
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      return ctx.error(
        'internal_error',
        `Failed to read the anchor health ledger: ${message}`,
        500
      );
    }
  });
}
