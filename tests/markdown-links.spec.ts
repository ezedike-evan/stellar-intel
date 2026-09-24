import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';

/**
 * Directories to ignore when traversing the repo for Markdown files.
 */
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'target',
  '.claude',
  '.gemini',
  '.turbo',
  'dist',
  'build',
]);

/**
 * Links that are currently known to be broken on main pending dedicated docs
 * issues (DOC007, DOC051) or GitHub web-relative links in issue/PR templates.
 * Format: `${relFilePath}:${rawTarget}` or `${relFilePath}:${normalizedPath}`.
 */
export const KNOWN_BROKEN = [
  // DOC007 / DOC051: references to unmerged batch / maintainer docs
  'docs/SEP_COMPLIANCE.md:../issues-batch-2.md',
  'docs/SEP_COMPLIANCE.md:../maintainer.md',
  'docs/ANCHOR_FLEET_RECHECK.md:../maintainer.md',
  'docs/ROADMAP.md:../maintainer.md',
  'docs/MAINTAINER_RUNBOOK.md:maintainer.md',
  'docs/MAINTAINER_RUNBOOK.md:../maintainer.md',
  'docs/CONTRIBUTING.md:maintainer.md',
  'docs/CONTRIBUTING.md:../maintainer.md',
  // GitHub web-relative branch URL in PR template
  '.github/PULL_REQUEST_TEMPLATE.md:../blob/main/CONTRIBUTING.md#per-surface-checks',
  '.github/PULL_REQUEST_TEMPLATE.md:../blob/main/CONTRIBUTING.md',
];

export interface ExtractedLink {
  line: number;
  rawTarget: string;
  normalizedPath: string;
}

/**
 * Extracts relative file links from Markdown content, ignoring fenced code blocks,
 * anchor-only fragments, external URLs, and mailto links.
 */
export function extractMarkdownLinks(content: string): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  const lines = content.split('\n');
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // Toggle fenced code blocks (``` or ~~~)
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      continue;
    }

    // Match Markdown link patterns: [text](target) or ![alt](target)
    const linkRegex = /!?\[(?:[^\]\\]|\\.)*\]\(([^)]+)\)/g;
    let match: RegExpExecArray | null;

    while ((match = linkRegex.exec(line)) !== null) {
      const raw = match[1]!.trim();
      // Remove any trailing title e.g. "title" or 'title'
      const target = raw.split(/\s+['"(]/)[0]!.trim();

      // Ignore anchor-only (#heading), external URLs (http:, https:, ftp:, mailto:, tel:, //)
      if (
        !target ||
        target.startsWith('#') ||
        /^(?:https?:|mailto:|ftp:|tel:|irc:|data:|\/\/)/i.test(target)
      ) {
        continue;
      }

      // Strip anchor fragment (#...) and query string (?...)
      const cleaned = target.split('#')[0]!.split('?')[0]!;
      if (!cleaned) {
        continue;
      }

      let decoded = cleaned;
      try {
        decoded = decodeURIComponent(cleaned);
      } catch {
        // Use raw if decode fails
      }

      links.push({
        line: i + 1,
        rawTarget: target,
        normalizedPath: decoded,
      });
    }
  }

  return links;
}

/**
 * Recursively discovers all .md files in the repository.
 */
export function findMarkdownFiles(dir: string): string[] {
  const mdFiles: string[] = [];

  function walk(current: string) {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          walk(join(current, entry.name));
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        mdFiles.push(join(current, entry.name));
      }
    }
  }

  walk(dir);
  return mdFiles;
}

describe('offline markdown relative link checker (#1582)', () => {
  it('unit test: link extractor correctly ignores code blocks and anchors', () => {
    const fixture = [
      '# Test Document',
      '',
      'Here is a [valid link](./valid.md) and an [anchor link](#section).',
      'Here is an [external link](https://example.com/docs).',
      'Here is a [mailto link](mailto:test@example.com).',
      '',
      '```markdown',
      'Inside code block: [ignored link](./ignored.md)',
      '```',
      '',
      '~~~ts',
      'const x = "[also ignored](./also-ignored.md)";',
      '~~~',
      '',
      'Back outside: [another link](../another.md#anchor "With Title")',
    ].join('\n');

    const extracted = extractMarkdownLinks(fixture);
    expect(extracted).toEqual([
      { line: 3, rawTarget: './valid.md', normalizedPath: './valid.md' },
      { line: 15, rawTarget: '../another.md#anchor', normalizedPath: '../another.md' },
    ]);
  });

  it('all relative markdown links in the repository resolve to existing files or directories', () => {
    const repoRoot = resolve(__dirname, '..');
    const mdFiles = findMarkdownFiles(repoRoot);
    const brokenLinks: string[] = [];

    const isKnownBroken = (relFile: string, target: string, rawTarget: string) => {
      const key1 = `${relFile}:${target}`;
      const key2 = `${relFile}:${rawTarget}`;
      return (
        KNOWN_BROKEN.includes(key1) ||
        KNOWN_BROKEN.includes(key2) ||
        KNOWN_BROKEN.includes(target) ||
        KNOWN_BROKEN.includes(rawTarget)
      );
    };

    for (const file of mdFiles) {
      const content = readFileSync(file, 'utf-8');
      const relFile = relative(repoRoot, file).replace(/\\/g, '/');
      const fileDir = dirname(file);
      const links = extractMarkdownLinks(content);

      for (const link of links) {
        if (isKnownBroken(relFile, link.normalizedPath, link.rawTarget)) {
          continue;
        }

        // Target starting with '/' is relative to repo root; otherwise relative to file dir
        const resolvedPath = link.normalizedPath.startsWith('/')
          ? join(repoRoot, link.normalizedPath.slice(1))
          : resolve(fileDir, link.normalizedPath);

        if (!existsSync(resolvedPath)) {
          brokenLinks.push(`${relFile}:${link.line} -> ${link.rawTarget}`);
        }
      }
    }

    expect(
      brokenLinks,
      `Broken relative Markdown links detected:\n${brokenLinks.join('\n')}`
    ).toEqual([]);
  });
});
