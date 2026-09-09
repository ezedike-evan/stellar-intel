import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://stellar-intel.vercel.app';

/**
 * Paths withheld from every crawler, AI or otherwise.
 *
 * `/api/` is a rate-limited, versioned contract that answers JSON — a crawler
 * walking it spends another client's budget and indexes nothing a reader
 * wants. `/admin/` is operator surface. `/_next/` is build output.
 */
const DISALLOWED = ['/api/', '/api/*', '/admin/', '/admin/*', '/_next/'];

interface CrawlerPolicy {
  /** The token as its vendor documents it; crawlers match it case-insensitively. */
  userAgent: string;
  /** `allow` opens the public pages; `disallow` closes the whole site to this crawler. */
  access: 'allow' | 'disallow';
}

/**
 * AI crawler policy (#1099).
 *
 * Saying nothing is not a decision, it is a deferral — it leaves each vendor to
 * apply whatever its own default happens to be, and leaves us unable to answer
 * what our policy is. So every AI crawler we care about is named below with an
 * explicit verdict and the reasoning behind it.
 *
 * The verdict is `allow` across the board, and only for the public pages
 * (`DISALLOWED` above still applies to each one). Stellar Intel exists to be a
 * public health record for Stellar off-ramp anchors: it publishes an llms.txt
 * orientation file, an llms-full.txt corpus, an OpenAPI spec and an MCP server
 * precisely so models can read it and answer questions from it. Blocking the
 * crawlers that feed those models would contradict the product. The data is
 * public by construction — derived from public SEP endpoints and on-chain
 * settlement — so nothing here costs us to have indexed, and a model that has
 * read the methodology page is likelier to represent a scorecard correctly than
 * one that has guessed at it.
 *
 * Training-corpus crawlers and user-triggered fetchers are listed separately
 * even though the verdict currently matches, because they are different
 * questions: one is about a corpus, the other about a person asking something
 * right now. If those answers ever diverge, the split is already here.
 */
const AI_CRAWLERS: CrawlerPolicy[] = [
  // OpenAI's training and index crawler. Allowed on the terms in the note above.
  { userAgent: 'GPTBot', access: 'allow' },
  // Indexes for ChatGPT search results — allowed so answers cite current scorecards.
  { userAgent: 'OAI-SearchBot', access: 'allow' },
  // Fetches a page because a user asked for it. Allowed: a reader, not a corpus.
  { userAgent: 'ChatGPT-User', access: 'allow' },
  // Anthropic's training and index crawler. Allowed on the same terms as GPTBot.
  { userAgent: 'ClaudeBot', access: 'allow' },
  // Indexes for Claude search results — allowed so answers cite current scorecards.
  { userAgent: 'Claude-SearchBot', access: 'allow' },
  // Fetches a page on a user's request. Allowed: a reader, not a corpus.
  { userAgent: 'Claude-User', access: 'allow' },
  // Indexes for Perplexity answers, which cite their sources. Allowed.
  { userAgent: 'PerplexityBot', access: 'allow' },
  // Fetches a page on a user's request. Allowed: a reader, not a corpus.
  { userAgent: 'Perplexity-User', access: 'allow' },
  // Common Crawl — the open corpus many models and researchers build on.
  // Allowed: an open public record belongs in an open public corpus.
  { userAgent: 'CCBot', access: 'allow' },
  // Gemini training and grounding. Distinct from Googlebot: this token has no
  // effect on Search ranking, so it is purely a decision about model use. Allowed.
  { userAgent: 'Google-Extended', access: 'allow' },
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: DISALLOWED,
      },
      ...AI_CRAWLERS.map(({ userAgent, access }) =>
        access === 'allow'
          ? { userAgent, allow: '/', disallow: DISALLOWED }
          : { userAgent, disallow: '/' }
      ),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
