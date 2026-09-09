import { describe, it, expect } from 'vitest';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DOCS_DIR,
  EXCLUDED_DOCS,
  LLMS_FULL_FILE,
  LLMS_FULL_SECTIONS,
  buildLlmsFullText,
  includedDocs,
  listTopLevelDocs,
  readLlmsFullText,
  unclassifiedDocs,
} from '@/lib/seo/llms-full';

// #1064 — /llms-full.txt is generated from docs/ and committed, so the two can
// drift. CI regenerates and diffs the artifact; these tests cover the
// properties that make that gate meaningful in the first place.

const root = process.cwd();

describe('llms-full.txt corpus (#1064)', () => {
  it('names only documents that exist', () => {
    for (const file of includedDocs()) {
      const path = join(root, DOCS_DIR, file);
      expect(existsSync(path), `${file} is in LLMS_FULL_SECTIONS but ${path} does not exist`).toBe(
        true
      );
    }

    for (const file of Object.keys(EXCLUDED_DOCS)) {
      const path = join(root, DOCS_DIR, file);
      expect(existsSync(path), `${file} is in EXCLUDED_DOCS but ${path} does not exist`).toBe(true);
    }
  });

  it('lists no document twice', () => {
    const included = includedDocs();
    expect(new Set(included).size, `duplicate entries in LLMS_FULL_SECTIONS: ${included}`).toBe(
      included.length
    );

    const overlap = included.filter((file) => file in EXCLUDED_DOCS);
    expect(overlap, 'a document cannot be both included and excluded').toEqual([]);
  });

  it('classifies every top-level doc as included or excluded', () => {
    // A new docs/*.md must be a deliberate decision: either it is part of the
    // corpus models read, or the reason it is not is written down.
    expect(
      unclassifiedDocs(root),
      'add these to LLMS_FULL_SECTIONS, or to EXCLUDED_DOCS with a reason, in lib/seo/llms-full.ts'
    ).toEqual([]);
  });

  it('records a non-empty reason for every exclusion', () => {
    for (const [file, reason] of Object.entries(EXCLUDED_DOCS)) {
      expect(reason.trim().length, `${file} is excluded without a reason`).toBeGreaterThan(20);
    }
  });

  it('covers the docs corpus rather than a token slice of it', () => {
    // Guards against someone trimming the manifest until the file is cheap to
    // generate and useless to read.
    expect(includedDocs().length).toBeGreaterThan(listTopLevelDocs(root).length / 2);
  });
});

describe('llms-full.txt output', () => {
  const text = buildLlmsFullText(root);

  it('is deterministic — a build stamp here would break the CI diff', () => {
    // Path-independence is covered by the scratch-copy test below, which builds
    // the same bytes from a temp directory.
    expect(buildLlmsFullText(root)).toBe(text);

    const header = text.slice(0, text.indexOf('## Contents'));
    expect(header, 'the generated header must not carry a date or version').not.toMatch(
      /\d{4}-\d{2}-\d{2}/
    );
  });

  it('carries every included document in full', () => {
    for (const file of includedDocs()) {
      const source = readFileSync(join(root, DOCS_DIR, file), 'utf-8')
        .replace(/\r\n/g, '\n')
        .trimEnd();

      expect(text).toContain(`<!-- source: ${DOCS_DIR}/${file} -->`);
      expect(text.includes(source), `${file} is not reproduced in full`).toBe(true);
    }
  });

  it('opens with a header and a table of contents', () => {
    expect(text.startsWith('# Stellar Intel')).toBe(true);
    expect(text).toContain('## Contents');
    for (const section of LLMS_FULL_SECTIONS) {
      expect(text).toContain(`### ${section.title}`);
      expect(text).toContain(`SECTION: ${section.title.toUpperCase()}`);
    }
  });

  it('ends with exactly one newline', () => {
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });

  it('changes when a doc is edited — the acceptance criterion, on a scratch copy', () => {
    // The generator reads from a root, so the edit happens in a temporary copy
    // of docs/ rather than in the working tree.
    const scratch = mkdtempSync(join(tmpdir(), 'llms-full-'));
    try {
      mkdirSync(join(scratch, DOCS_DIR), { recursive: true });
      for (const file of includedDocs()) {
        copyFileSync(join(root, DOCS_DIR, file), join(scratch, DOCS_DIR, file));
      }

      const before = buildLlmsFullText(scratch);
      expect(before).toBe(text);

      const edited = join(scratch, DOCS_DIR, 'FAQ.md');
      writeFileSync(edited, readFileSync(edited, 'utf-8') + '\n\n### Sentinel heading\n', 'utf-8');

      const after = buildLlmsFullText(scratch);
      expect(after).not.toBe(before);
      expect(after).toContain('### Sentinel heading');
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe('GET /llms-full.txt', () => {
  it('serves the artifact as plain text', async () => {
    const { GET } = await import('@/app/llms-full.txt/route');
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await response.text()).toBe(readLlmsFullText(root));
  });
});

describe('llms-full.txt committed artifact', () => {
  it('is in sync with docs/ (run `npm run emit-llms-full` if this fails)', () => {
    expect(existsSync(join(root, LLMS_FULL_FILE)), `${LLMS_FULL_FILE} has not been generated`).toBe(
      true
    );
    expect(readLlmsFullText(root)).toBe(buildLlmsFullText(root));
  });
});
