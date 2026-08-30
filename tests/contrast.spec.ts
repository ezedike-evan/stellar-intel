import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WCAG 2.1 AA contrast guard (#755).
 *
 * Two halves, because two different things can break the contrast of this UI:
 *
 *   1. Someone changes a palette value in `app/globals.css` — caught by
 *      measuring every semantic token pair that the components actually render
 *      together, in both themes.
 *   2. Someone writes a raw `text-gray-*` class in a component — caught by
 *      scanning the JSX for the specific greys measured below as failing.
 *
 * The lighthouse workflow catches contrast on rendered pages, but only on the
 * handful of routes it visits and only after a deploy. This runs on every
 * commit and covers components no route in that list happens to render.
 */

const THRESHOLD = {
  /** WCAG 1.4.3 — normal-size text. */
  normalText: 4.5,
  /** WCAG 1.4.11 — UI components and meaningful graphics. */
  nonText: 3,
} as const;

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const value = hex.replace('#', '');
  const channel = (offset: number) => srgbToLinear(parseInt(value.slice(offset, offset + 2), 16));
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [lighter, darker] = a >= b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Reads the token values straight out of `globals.css` rather than duplicating
 * them here — a test that carries its own copy of the palette passes happily
 * while the real palette regresses.
 */
function readThemeTokens(selector: ':root' | '.dark'): Record<string, string> {
  const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
  // `:root` also matches inside `.dark`-scoped rules elsewhere in the file, so
  // anchor on the declaration at the start of a line.
  const block = new RegExp(
    `^\\${selector === ':root' ? ':root' : '.dark'} \\{([^}]*)\\}`,
    'm'
  ).exec(css);
  const body = block?.[1];
  expect(body, `no ${selector} block in app/globals.css`).toBeDefined();

  const tokens: Record<string, string> = {};
  for (const match of body!.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens[match[1]!] = match[2]!;
  }
  return tokens;
}

const THEMES = [
  { name: 'light', tokens: readThemeTokens(':root') },
  { name: 'dark', tokens: readThemeTokens('.dark') },
] as const;

/**
 * Foreground/background pairs the UI actually renders together. Every
 * combination would be misleading — `accent-subtle` is only ever a badge
 * background, never a page background for body text.
 */
const PAIRS: Array<{ fg: string; bg: string; min: number }> = [
  { fg: 'primary-text', bg: 'background', min: THRESHOLD.normalText },
  { fg: 'primary-text', bg: 'bg-subtle', min: THRESHOLD.normalText },
  { fg: 'secondary-text', bg: 'background', min: THRESHOLD.normalText },
  { fg: 'secondary-text', bg: 'bg-subtle', min: THRESHOLD.normalText },
  { fg: 'accent', bg: 'background', min: THRESHOLD.normalText },
  { fg: 'accent', bg: 'bg-subtle', min: THRESHOLD.normalText },
  { fg: 'accent', bg: 'accent-subtle', min: THRESHOLD.normalText },
];

/**
 * `--border` is deliberately absent above. It is only ever a card or section
 * divider — no form control uses it — and purely decorative boundaries carry no
 * contrast requirement. `--control-border` is the one that does: the border of
 * an input, select or checkbox is the only thing identifying it as a control,
 * so 1.4.11's 3:1 applies. It is measured against the literal backgrounds those
 * controls render on (`bg-white` / `dark:bg-gray-800`), which are raw Tailwind
 * values rather than tokens.
 */
const CONTROL_BACKGROUNDS = [
  { theme: 'light', bg: '#ffffff', label: 'bg-white' },
  { theme: 'dark', bg: '#1f2937', label: 'dark:bg-gray-800' },
] as const;

describe('semantic theme tokens meet WCAG AA', () => {
  for (const theme of THEMES) {
    for (const pair of PAIRS) {
      it(`${theme.name}: ${pair.fg} on ${pair.bg}`, () => {
        const fg = theme.tokens[pair.fg];
        const bg = theme.tokens[pair.bg];
        expect(fg, `--${pair.fg} missing from the ${theme.name} theme`).toBeDefined();
        expect(bg, `--${pair.bg} missing from the ${theme.name} theme`).toBeDefined();

        const ratio = contrastRatio(fg!, bg!);
        expect(
          ratio,
          `${pair.fg} (${fg}) on ${pair.bg} (${bg}) is ${ratio.toFixed(2)}:1, below ${pair.min}:1`
        ).toBeGreaterThanOrEqual(pair.min);
      });
    }
  }

  for (const { theme, bg, label } of CONTROL_BACKGROUNDS) {
    it(`${theme}: control-border on ${label}`, () => {
      const tokens = THEMES.find((t) => t.name === theme)!.tokens;
      const fg = tokens['control-border'];
      expect(fg, `--control-border missing from the ${theme} theme`).toBeDefined();

      const ratio = contrastRatio(fg!, bg);
      expect(
        ratio,
        `control-border (${fg}) on ${label} (${bg}) is ${ratio.toFixed(2)}:1, below ${THRESHOLD.nonText}:1`
      ).toBeGreaterThanOrEqual(THRESHOLD.nonText);
    });
  }
});

/**
 * Raw Tailwind greys measured against the theme background they land on. Only
 * the ones that actually fail are banned — `text-gray-500` on white is 4.83:1
 * and perfectly fine, so banning the whole `text-gray-*` family would be noise
 * that trains people to add allowlist entries.
 */
const BANNED = [
  { pattern: /(?<![:\w-])text-gray-300(?![\w-])/, measured: '1.47:1 on #ffffff' },
  { pattern: /(?<![:\w-])text-gray-400(?![\w-])/, measured: '2.54:1 on #ffffff' },
  { pattern: /dark:text-gray-500(?![\w-])/, measured: '4.34:1 on #000000' },
  { pattern: /dark:text-gray-600(?![\w-])/, measured: '2.78:1 on #000000' },
  { pattern: /dark:text-gray-700(?![\w-])/, measured: '2.04:1 on #000000' },
  { pattern: /placeholder:text-gray-(?:300|400)(?![\w-])/, measured: '2.54:1 or worse on #ffffff' },
  {
    pattern: /(?<![\w-])placeholder-gray-\d+(?![\w-])/,
    // Tailwind v3 syntax. In v4 this class does not exist, so it sets no
    // colour at all — the placeholder silently inherits, and the intended
    // contrast was never applied. The v4 spelling is `placeholder:text-*`.
    measured: 'dead Tailwind v3 class — sets nothing in v4',
  },
];

/**
 * Documented exemptions. Each is either exempt under the spec or measured
 * against a background other than the page background — not "we'll fix it
 * later". Anything added here needs the same kind of reason.
 */
const EXEMPT: Array<{ file: string; reason: string }> = [
  // Empty, and worth keeping empty.
  //
  // The four entries that used to live here — Sparkline, RateTable,
  // ExecuteDrawer and CodeBlock — were all resolved when the components moved
  // onto semantic theme tokens. None of them contains a raw grey any more, so
  // none of them needs excusing.
  //
  // Anything added back needs the same kind of reason the originals had: exempt
  // under the spec, or measured against a background other than the page
  // background. Not "we'll fix it later".
];

function sourceFiles(dir: string, exts: string[] = ['.tsx']): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '__tests__') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path, exts));
    else if (exts.some((ext) => entry.endsWith(ext))) out.push(path);
  }
  return out;
}

describe('components do not reintroduce failing raw greys', () => {
  const exemptFiles = new Set(EXEMPT.map((e) => e.file));
  const files = [
    ...sourceFiles('components', ['.tsx']),
    ...sourceFiles('app', ['.tsx']),
    ...sourceFiles('lib', ['.ts', '.tsx']),
  ].filter((f) => !f.endsWith('.test.tsx') && !f.endsWith('.test.ts') && !f.endsWith('.spec.ts'));

  it('scans a non-trivial number of files', () => {
    // Guards against the walker silently returning nothing and the suite going
    // green because it checked zero files.
    expect(files.length).toBeGreaterThan(50);
  });

  it('finds no unexempted failing grey', () => {
    const violations: string[] = [];

    for (const file of files) {
      if (exemptFiles.has(file)) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        for (const { pattern, measured } of BANNED) {
          if (pattern.test(line)) {
            violations.push(
              `${file}:${i + 1} — ${pattern.source.match(/[\w:-]*text-gray-\d+/)?.[0]} (${measured})`
            );
          }
        }
      });
    }

    expect(
      violations,
      `Use text-secondary-text (4.83:1 light / 8.27:1 dark) instead:\n${violations.join('\n')}`
    ).toEqual([]);
  });

  it('every exemption names a file that still exists and still needs it', () => {
    // A stale exemption is worse than none: it silently permits a grey that is
    // no longer justified.
    for (const { file } of EXEMPT) {
      const source = readFileSync(file, 'utf8');
      expect(
        BANNED.some(({ pattern }) => source.split('\n').some((l) => pattern.test(l))),
        `${file} is exempted but no longer contains a banned grey — drop the exemption`
      ).toBe(true);
    }
  });
});

describe('components do not hardcode colour literals', () => {
  // The raw-grey guard above only reads `className`. Colour set through SVG
  // presentation attributes or an inline style never appears there, so it was
  // invisible to it — `AnchorProfile`'s history chart carried a hardcoded
  // `rgb(59,130,246)` (Tailwind blue-500) through a full tokenisation pass with
  // the suite green the whole time. Palette changes silently skipped it.
  //
  // Colour belongs to the theme. In SVG, reach it with `currentColor` plus a
  // text utility, or `var(--color-*)` directly.
  const COLOUR_ATTR =
    /(?:stopColor|fill|stroke|color|floodColor|lightingColor)=["'](?:#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\()/;
  const INLINE_STYLE_COLOUR = /style=\{\{[^}]*(?:#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\()/;

  const files = [
    ...sourceFiles('components', ['.tsx']),
    ...sourceFiles('app', ['.tsx']),
    ...sourceFiles('lib', ['.ts', '.tsx']),
  ].filter((f) => !f.endsWith('.test.tsx') && !f.endsWith('.test.ts') && !f.endsWith('.spec.ts'));

  it('scans a non-trivial number of files', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(files)('%s uses theme colour, not a literal', (file) => {
    const offenders = readFileSync(file, 'utf8')
      .split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => COLOUR_ATTR.test(line) || INLINE_STYLE_COLOUR.test(line));

    expect(
      offenders.map(({ n, line }) => `${file}:${n} ${line.trim()}`).join('\n'),
      `${file} hardcodes a colour literal — use currentColor with a text utility, or var(--color-*)`
    ).toBe('');
  });
});

describe('contrastRatio', () => {
  it('matches known WCAG values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // Order must not matter.
    expect(contrastRatio('#6b7280', '#ffffff')).toBeCloseTo(
      contrastRatio('#ffffff', '#6b7280'),
      10
    );
  });
});

// ---- Custody boundary guard (#1147) ----
//
// The project's central claim (docs/PRODUCTION_AUDIT.md §1) is that the app
// never takes custody of user funds — no server-side signing key, no held
// secret, no route that submits a transaction on a user's behalf. This
// static source scan enforces that invariant.

const PUBLISHER_EXEMPTION = 'packages/publisher';

function hasFromSecretImport(filePath: string): boolean {
  const content = readFileSync(filePath, 'utf8');
  return (
    content.includes('import') &&
    content.includes('Keypair.fromSecret') &&
    content.includes('@stellar/stellar-sdk')
  );
}

function isExempted(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return (
    lower.includes(PUBLISHER_EXEMPTION.toLowerCase()) ||
    lower.includes('test') ||
    lower.includes('e2e') ||
    lower.includes('.spec.') ||
    lower.includes('.test.')
  );
}

function findSourceFiles(dir: string, exts: string[] = ['.ts', '.tsx', '.mts']): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '__tests__') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...findSourceFiles(path, exts));
    else if (exts.some((ext) => entry.endsWith(ext))) out.push(path);
  }
  return out;
}

describe('custody boundary: no unauthorized custody-taking code paths', () => {
  const libFiles = findSourceFiles('lib');
  const appFiles = findSourceFiles('app');
  const allSourceFiles = [...libFiles, ...appFiles];

  it('no lib/app module imports Keypair.fromSecret except exempted publisher', () => {
    const violations = allSourceFiles
      .filter((f) => hasFromSecretImport(f) && !isExempted(f))
      .map((f) => f.replace(process.cwd() + '/', ''));

    expect(violations, [
      ...violations.map(
        (v) => `File ${v} imports Keypair.fromSecret from @stellar/stellar-sdk but is not the exempted publisher package`
      ),
    ]).toHaveLength(0);
  });

  it('no route handlers call Keypair.sign or submit transactions from user accounts', () => {
    const routeFiles = findSourceFiles(join(process.cwd(), 'app', 'api'))
      .filter((f) => f.includes('route.ts') || f.includes('route.mts'));

    const signViolations = routeFiles
      .filter((f) => {
        const content = readFileSync(f, 'utf8');
        return content.includes('Keypair.sign') || content.includes('.sign(');
      })
      .map((f) => f.replace(process.cwd() + '/', ''));

    expect(signViolations, [
      ...signViolations.map(
        (v) => `File ${v} contains unauthorized Keypair.sign or transaction signing`
      ),
    ]).toHaveLength(0);
  });

  it('no undocumented user-key environment variables in lib/app', () => {
    const envViolations = allSourceFiles
      .filter((f) => {
        const content = readFileSync(f, 'utf8');
        // Check for user key env vars beyond the documented PUBLISHER_SECRET
        return (
          (content.includes('USER_SECRET') || content.includes('PRIVATE_KEY') || content.includes('SECRET_KEY')) &&
          !content.includes('PUBLISHER_SECRET') &&
          !isExempted(f)
        );
      })
      .map((f) => f.replace(process.cwd() + '/', ''));

    expect(envViolations, [
      ...envViolations.map(
        (v) => `File ${v} has an undocumented user-key environment variable`
      ),
    ]).toHaveLength(0);
  });
});
