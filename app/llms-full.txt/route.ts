import { readLlmsFullText } from '@/lib/seo/llms-full';

export const runtime = 'nodejs';

/**
 * Prerendered at build time. The artifact is read off disk once, during the
 * build, so no request ever touches the filesystem — and because `prebuild`
 * regenerates it from docs/, a deploy always serves the corpus that shipped
 * with it.
 */
export const dynamic = 'force-static';

/**
 * GET /llms-full.txt — the whole documentation corpus as one plain-text file
 * (#1064), so an agent can ingest it in a single fetch instead of crawling the
 * seven pages under /docs.
 *
 * Served from lib/seo/llms-full.generated.txt rather than rebuilt here: the CI
 * gate diffs that committed file, so serving it directly is what makes the gate
 * a guarantee about the response rather than about a file nothing reads.
 */
export function GET(): Response {
  return new Response(readLlmsFullText(), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      'X-Robots-Tag': 'all',
    },
  });
}
