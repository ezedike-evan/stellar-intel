/**
 * lib/seo/llms-full.ts
 *
 * The builder behind `/llms-full.txt` (#1064) — the long-form companion to
 * `llms.txt`. It concatenates the public documentation corpus into a single
 * plain-text file so a model can ingest the whole of it in one fetch instead of
 * crawling the seven pages under `/docs`.
 *
 * Three properties matter here, and each one is load-bearing:
 *
 * 1. **Generated, never hand-maintained.** Every section is the verbatim
 *    Markdown of a file in `docs/`. Editing a doc and rebuilding changes the
 *    output; nothing has to be restated in a second place and left to rot.
 * 2. **Deterministic.** No timestamps, no git sha, no environment lookups. The
 *    same `docs/` tree always produces byte-identical output, which is what
 *    lets CI regenerate the committed artifact and diff it (see the
 *    "llms-full.txt is in sync" step in .github/workflows/ci.yml). A build
 *    stamp here would make that gate fail on every run.
 * 3. **Curated, and provably so.** Not everything in `docs/` belongs in front
 *    of a model answering integration questions — point-in-time audits, the
 *    roadmap, and contributor runbooks are noise at best and stale claims at
 *    worst. So every top-level doc must appear in either LLMS_FULL_SECTIONS or
 *    EXCLUDED_DOCS, and `tests/llms-full.spec.ts` fails on any that appears in
 *    neither. Adding a doc forces a decision instead of silently dropping it.
 *
 * Only the top level of `docs/` is classified. The subdirectories
 * (`docs/anchors`, `docs/grants`, `docs/research`) hold working material —
 * survey exclusions, a grant application, competitor notes — addressed to
 * contributors rather than to API consumers.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Documentation source directory, relative to the repo root. */
export const DOCS_DIR = 'docs';

/** The committed artifact this builder produces, relative to the repo root. */
export const LLMS_FULL_FILE = join('lib', 'seo', 'llms-full.generated.txt');

/**
 * Hard-coded rather than read from NEXT_PUBLIC_SITE_URL: the output is a
 * committed file guarded by a CI diff, so it must not vary with the environment
 * that happens to run the generator.
 */
export const SITE_URL = 'https://stellar-intel.vercel.app';

export interface LlmsFullSection {
  /** Section banner, also used in the table of contents. */
  title: string;
  /** One line telling a model what this group of documents is for. */
  blurb: string;
  /** Bare file names inside `docs/`, in reading order. */
  files: string[];
}

/**
 * The corpus, grouped the way a reader should meet it: what the product is,
 * then how to call it, then how the numbers are produced, then the trust
 * surface. Order inside a section is reading order, not alphabetical.
 */
export const LLMS_FULL_SECTIONS: LlmsFullSection[] = [
  {
    title: 'Overview',
    blurb: 'What Stellar Intel is, what it does not do, and how it is put together.',
    files: ['FAQ.md', 'NON_CUSTODY.md', 'ARCHITECTURE.md'],
  },
  {
    title: 'API reference',
    blurb: 'The HTTP and GraphQL surfaces, their version guarantees, and their wire formats.',
    files: ['INTENT_API.md', 'GRAPHQL_API.md', 'VERSIONING.md', 'CANONICAL_JSON.md'],
  },
  {
    title: 'Integration guides',
    blurb: 'Worked examples, client libraries, the MCP server, and webhook delivery.',
    files: ['COOKBOOK.md', 'SDK.md', 'MCP.md', 'WEBHOOKS.md'],
  },
  {
    title: 'Data and methodology',
    blurb: 'How scores, rates, benchmarks, and on-chain published metrics are computed.',
    files: [
      'ANCHOR_REPUTATION.md',
      'BENCHMARKS.md',
      'SETTLEMENT_SLA.md',
      'ORACLE_SPEC.md',
      'VOLUME_SAVINGS.md',
      'SEP_COMPLIANCE.md',
    ],
  },
  {
    title: 'Anchors',
    blurb: 'How an anchor joins the registry and how the public directory is kept honest.',
    files: ['ANCHOR_ONBOARDING.md', 'ANCHOR_DIRECTORY_CONTRIBUTION.md'],
  },
  {
    title: 'Trust, security, and legal',
    blurb: 'The security posture, the threat model, the regulatory basis, and the terms.',
    files: [
      'SECURITY.md',
      'THREAT_MODEL.md',
      'JURISDICTIONAL.md',
      'GOVERNANCE.md',
      'TERMS_OF_SERVICE.md',
    ],
  },
];

/**
 * Top-level docs deliberately kept out of the corpus, each with the reason.
 *
 * Keep the reasons concrete. "Internal" on its own is not a reason — the test
 * only checks that a decision was recorded, so the reason is the only thing
 * telling the next person whether the decision still holds.
 */
export const EXCLUDED_DOCS: Record<string, string> = {
  'ROADMAP.md':
    'Forward-looking plan. Describes what does not exist yet, which is exactly what a model must not report as behaviour.',
  'PROPOSAL.md': 'Grant proposal narrative, not product documentation.',
  'POSITIONING.md':
    'Internal messaging guidance — how to talk about the product, not how it works.',
  'AGENT_POSITIONING.md': 'Comparison memo against another product; opinion rather than reference.',
  'ANALYTICS.md': 'Team-facing event taxonomy and dashboard access model.',
  'PRODUCTION_AUDIT.md':
    'Point-in-time readiness audit; its findings are historical the day after it is written.',
  'RATE_LIMIT_AUDIT.md':
    'Point-in-time audit. The limits a caller actually needs are in VERSIONING.md and the OpenAPI spec.',
  'ANCHOR_FLEET_RECHECK.md':
    'Point-in-time survey record, superseded by scripts/anchor-survey.snapshot.json.',
  'SEP38_USDC_NGN_VERIFICATION.md': 'Point-in-time verification record for a single corridor.',
  'MAINNET_LAUNCH.md': 'Launch runbook for operators, not a description of the running system.',
  'ORACLE_MIGRATION.md': 'Operator runbook for a one-off contract migration.',
  'SDK_HANDOFF.md': 'Contributor handoff notes for unfinished SDK work.',
  'CONTRIBUTOR_LADDER.md': 'Repository process, not product behaviour.',
  'STRICT_LINTING.md': 'Repository process, not product behaviour.',
};

/** Every Markdown file at the top level of `docs/`, sorted for determinism. */
export function listTopLevelDocs(root: string = process.cwd()): string[] {
  return readdirSync(join(root, DOCS_DIR), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();
}

/** Files named by LLMS_FULL_SECTIONS, flattened in section order. */
export function includedDocs(): string[] {
  return LLMS_FULL_SECTIONS.flatMap((section) => section.files);
}

/**
 * Top-level docs that are neither included nor explicitly excluded. A non-empty
 * result means someone added a doc without deciding whether models should see
 * it; `tests/llms-full.spec.ts` turns that into a failure.
 */
export function unclassifiedDocs(root: string = process.cwd()): string[] {
  const decided = new Set([...includedDocs(), ...Object.keys(EXCLUDED_DOCS)]);
  return listTopLevelDocs(root).filter((name) => !decided.has(name));
}

/** Strip a byte-order mark, normalise line endings, drop trailing whitespace. */
function normalise(source: string): string {
  return source.replace(/^﻿/, '').replace(/\r\n/g, '\n').trimEnd();
}

/** A document's own H1, used for the table of contents. */
function titleOf(markdown: string, fileName: string): string {
  const heading = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim();
  return heading && heading.length > 0 ? heading : fileName.replace(/\.md$/, '');
}

const RULE = '='.repeat(78);

/**
 * Build the full text of `/llms-full.txt`.
 *
 * Document bodies are copied verbatim. Rewriting them — demoting headings,
 * resolving relative links — would make this file say something its sources do
 * not, and every transformation is one more way to silently corrupt a document
 * nobody re-reads after generation.
 */
export function buildLlmsFullText(root: string = process.cwd()): string {
  const documents = LLMS_FULL_SECTIONS.map((section) => ({
    section,
    docs: section.files.map((file) => {
      const body = normalise(readFileSync(join(root, DOCS_DIR, file), 'utf-8'));
      return { file, body, title: titleOf(body, file) };
    }),
  }));

  const out: string[] = [
    '# Stellar Intel — full documentation',
    '',
    '> Neutral routing and reputation data for Stellar anchors: live off-ramp rates,',
    '> anchor reliability scores, and a non-custodial intent API.',
    '',
    'This file is generated from the Markdown sources under `docs/` in',
    'https://github.com/ezedike-evan/stellar-intel — do not edit it by hand. Each',
    'section below is one source file, reproduced verbatim and introduced by an',
    'HTML comment naming its path. Relative links inside a document are relative',
    'to `docs/`, so most of them resolve to another section of this file.',
    '',
    `Docs site: ${SITE_URL}/docs`,
    `OpenAPI spec: ${SITE_URL}/openapi.json`,
    '',
    '## Contents',
    '',
  ];

  for (const { section, docs } of documents) {
    out.push(`### ${section.title}`, '', section.blurb, '');
    for (const doc of docs) {
      out.push(`- ${doc.title} (${DOCS_DIR}/${doc.file})`);
    }
    out.push('');
  }

  for (const { section, docs } of documents) {
    out.push(RULE, `SECTION: ${section.title.toUpperCase()}`, RULE, '');
    for (const doc of docs) {
      out.push(`<!-- source: ${DOCS_DIR}/${doc.file} -->`, '', doc.body, '');
    }
  }

  return out.join('\n').replace(/\n+$/, '') + '\n';
}

/**
 * Read the committed artifact. The route serves this rather than re-running the
 * builder, so the bytes shipped are the bytes reviewed in the pull request.
 */
export function readLlmsFullText(root: string = process.cwd()): string {
  return readFileSync(join(root, LLMS_FULL_FILE), 'utf-8');
}
