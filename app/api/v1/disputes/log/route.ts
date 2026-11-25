import { NextRequest, NextResponse } from 'next/server';
import { withV1 } from '@/lib/api/v1';
import { getAdjudicationLog, verifyChain, summarizeLog } from '@/lib/reputation/adjudication-log';

export const runtime = 'nodejs';

/**
 * `GET /api/v1/disputes/log[?afterSeq=N&limit=N]` (#2133)
 *
 * Serves the public, append-only, hash-chained dispute adjudication log.
 * Anyone — users, anchors, auditors — can inspect all filings and adjudications,
 * check summary stats, and independently verify the hash chain integrity.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return withV1(
    request,
    { bucket: 'v1.disputes.log', maxRequests: 60, scope: 'quotes:read' },
    async (ctx) => {
      const searchParams = request.nextUrl.searchParams;

      const afterSeqParam = searchParams.get('afterSeq');
      let afterSeq = 0;
      if (afterSeqParam !== null) {
        if (!/^\d+$/.test(afterSeqParam)) {
          return ctx.error('VALIDATION_ERROR', 'afterSeq must be an integer >= 0', 400);
        }
        afterSeq = parseInt(afterSeqParam, 10);
        if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) {
          return ctx.error('VALIDATION_ERROR', 'afterSeq must be an integer >= 0', 400);
        }
      }

      const limitParam = searchParams.get('limit');
      let limit = 200;
      if (limitParam !== null) {
        if (!/^\d+$/.test(limitParam)) {
          return ctx.error('VALIDATION_ERROR', 'limit must be an integer between 1 and 500', 400);
        }
        limit = parseInt(limitParam, 10);
        if (limit < 1 || limit > 500) {
          return ctx.error('VALIDATION_ERROR', 'limit must be an integer between 1 and 500', 400);
        }
      }

      const all = await getAdjudicationLog().list();
      const entries = all.filter((e) => e.seq > afterSeq).slice(0, limit);
      const last = all[all.length - 1];
      const head = last ? { seq: last.seq, entryHash: last.entryHash } : null;
      const verification = verifyChain(all);
      const summary = summarizeLog(all);

      return {
        status: 200,
        body: {
          entries,
          head,
          verification,
          summary,
          hashFormat: 'stellar-intel/adjudication/v1',
        },
        headers: {
          'Cache-Control': 'public, max-age=60',
        },
      };
    }
  );
}
