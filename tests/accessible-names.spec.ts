import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Alt text and accessible name guard (#1069).
 *
 * Nothing in the suite noticed when an icon-only button shipped without a
 * label: it renders, it clicks, and the only reader who cannot use it is the
 * one who cannot see the icon. The two failures this scans for are the two
 * that actually recur here:
 *
 *   1. An image with no `alt` at all — a screen reader falls back to reading
 *      the file name. A decorative image needs `alt=""` *written down*, so the
 *      emptiness is a decision rather than an omission.
 *   2. A `<button>` or link whose entire content is an icon, with no
 *      `aria-label`, `title` or visually hidden text to name it.
 *
 * It works on the source rather than a rendered tree because the rendered
 * alternative is a Playwright pass over the handful of routes that happen to be
 * in the smoke list, which is exactly how these regressions got in.
 */

const SOURCE_DIRS = ['components', 'app'];

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...tsxFiles(path));
    else if (entry.endsWith('.tsx')) out.push(path);
  }
  return out;
}

const files = SOURCE_DIRS.flatMap(tsxFiles).filter((f) => !f.endsWith('.test.tsx'));

/** Attribute list of a JSX opening tag, from `<name` to the closing `>`. */
function openingTag(source: string, start: number): { attrs: string; end: number } | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i]!;
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    else if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    else if (char === '>' && depth === 0) return { attrs: source.slice(start, i), end: i };
  }
  return null;
}

/** Children of `<tag …>` at `openEnd`, or `null` when the tag self-closes. */
function children(source: string, tag: string, attrs: string, openEnd: number): string | null {
  if (attrs.trimEnd().endsWith('/')) return null;
  const open = new RegExp(`<${tag}[\\s/>]`, 'g');
  const close = new RegExp(`</${tag}\\s*>`, 'g');
  let depth = 1;
  let cursor = openEnd + 1;
  while (cursor < source.length) {
    open.lastIndex = cursor;
    close.lastIndex = cursor;
    const nextOpen = open.exec(source);
    const nextClose = close.exec(source);
    if (!nextClose) return source.slice(openEnd + 1);
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      cursor = nextOpen.index + 1;
      continue;
    }
    depth -= 1;
    if (depth === 0) return source.slice(openEnd + 1, nextClose.index);
    cursor = nextClose.index + 1;
  }
  return source.slice(openEnd + 1);
}

/**
 * What is left of an element's children once every nested tag is removed:
 * literal text and JSX expressions. An icon-only control reduces to nothing,
 * which is the whole test.
 */
function textContent(inner: string): string {
  return inner
    .replace(/<[^>]*>/g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .trim();
}

function hasAttr(attrs: string, name: string): boolean {
  return new RegExp(`(?:^|\\s)${name}\\s*=`).test(attrs);
}

function line(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

/**
 * Elements that carry an accessible name from a prop rather than from their
 * own children. Each spreads or forwards a label its callers supply, and the
 * callers are scanned like anything else.
 */
const NAMED_BY_PROP = /(?:^|\s)(?:aria-label|aria-labelledby|title)\s*=|\{\s*\.\.\./;

describe('images carry alt text', () => {
  it('scans a non-trivial number of files', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('every img and next/image has an explicit alt', () => {
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/<(img|Image)[\s/>]/g)) {
        const tag = openingTag(source, match.index + 1 + match[1]!.length);
        if (!tag) continue;
        if (!hasAttr(tag.attrs, 'alt') && !/\{\s*\.\.\./.test(tag.attrs)) {
          violations.push(`${file}:${line(source, match.index)} — <${match[1]}> without alt`);
        }
      }
    }
    expect(
      violations,
      `Every image needs an alt attribute. Decorative images take alt="" so the\n` +
        `emptiness is explicit:\n\n${violations.join('\n')}`
    ).toEqual([]);
  });
});

describe('interactive elements have an accessible name', () => {
  const INTERACTIVE = ['button', 'a', 'Link'] as const;

  /**
   * Every control the scan actually parsed, so a walker that silently stops
   * matching cannot turn this suite green by checking nothing.
   */
  let scanned = 0;

  it('no icon-only button or link is unlabelled', () => {
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const tag of INTERACTIVE) {
        for (const match of source.matchAll(new RegExp(`<${tag}[\\s/>]`, 'g'))) {
          const open = openingTag(source, match.index + 1 + tag.length);
          if (!open) continue;
          scanned += 1;
          if (NAMED_BY_PROP.test(open.attrs)) continue;
          const inner = children(source, tag, open.attrs, open.end);
          if (inner === null || textContent(inner) !== '') continue;
          violations.push(
            `${file}:${line(source, match.index)} — <${tag}> has no text content and no ` +
              `aria-label, aria-labelledby or title`
          );
        }
      }
    }
    expect(
      violations,
      `An icon is not a name. Give the control an aria-label, or put visually\n` +
        `hidden text inside it:\n\n${violations.join('\n')}`
    ).toEqual([]);
  });

  it('parsed a non-trivial number of controls', () => {
    expect(scanned).toBeGreaterThan(100);
  });
});

describe('decorative graphics are hidden from assistive technology', () => {
  it('every inline svg is either aria-hidden or a labelled role="img"', () => {
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/<svg[\s/>]/g)) {
        const open = openingTag(source, match.index + 4);
        if (!open) continue;
        const hidden = /(?:^|\s)aria-hidden(?:\s|=|$)/.test(open.attrs);
        const labelled =
          /role\s*=\s*["']img["']/.test(open.attrs) &&
          (hasAttr(open.attrs, 'aria-label') || hasAttr(open.attrs, 'aria-labelledby'));
        const titled = (children(source, 'svg', open.attrs, open.end) ?? '').includes('<title>');
        if (!hidden && !labelled && !titled) {
          violations.push(
            `${file}:${line(source, match.index)} — <svg> is neither hidden nor named`
          );
        }
      }
    }
    expect(
      violations,
      `An inline <svg> is exposed to a screen reader by default and reads as an\n` +
        `unnamed graphic. Decorative icons take aria-hidden="true"; a meaningful\n` +
        `one takes role="img" with a label:\n\n${violations.join('\n')}`
    ).toEqual([]);
  });
});
