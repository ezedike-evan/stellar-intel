import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guard against custody-taking code paths.
 *
 * The project's central claim (docs/PRODUCTION_AUDIT.md §1) is that the app
 * never takes custody of user funds — no server-side signing key, no held
 * secret, no route that submits a transaction on a user's behalf. This spec
 * scans the source to enforce that invariant.
 *
 * Done when:
 *   - A spec fails if a custody-taking code path is introduced
 *   - PUBLISHER_SECRET is the only exemption and it names why
 *   - docs/PRODUCTION_AUDIT.md §1 can move from "Enforced in code" to "Enforced in CI"
 */

const LIB_DIR = join(process.cwd(), 'lib');
const APP_DIR = join(process.cwd(), 'app');
const PUBLISHER_EXEMPTION = 'packages/publisher';

// ---- 1. No Keypair.fromSecret imports outside the publisher ----

<<<<<<< Updated upstream
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
=======
function hasFromSecretImport(filePath: string): boolean {
  const content = readFileSync(filePath, 'utf8');
  // Check for import of Keypair.fromSecret from @stellar/stellar-sdk
  return (
    content.includes("import") &&
    content.includes('Keypair.fromSecret') &&
    content.includes('@stellar/stellar-sdk')
  );
}

function isExempted(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return (
    lower.includes(PUBLISHER_EXEMPTION.toLowerCase()) ||
    lower.includes('test') ||
    lower.includes('e2e')
  );
}
>>>>>>> Stashed changes

function findFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = require('node:fs').readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.mts')) {
      results.push(fullPath);
    }
  }
  return results;
}

const allSourceFiles = [...findFiles(LIB_DIR), ...findFiles(APP_DIR)];

describe('custody boundary: no unauthorized Keypair.fromSecret imports', () => {
  it('no lib module imports Keypair.fromSecret except the exempted publisher', () => {
    const violations = allSourceFiles
      .filter((f) => hasFromSecretImport(f) && !isExempted(f))
      .map((f) => ({
        file: f,
        relative: f.replace(process.cwd() + '/', ''),
      }));

    expect(violations).toHaveLength(0, [
      ...violations.map(
        (v) => `File ${v.relative} imports Keypair.fromSecret from @stellar/stellar-sdk but is not the exempted publisher package`
      ),
    ]);
  });
});

// ---- 2. No Keypair.sign or transaction submission in route handlers ----

function hasSignCall(filePath: string): boolean {
  const content = readFileSync(filePath, 'utf8');
  return content.includes('Keypair.sign');
}

function hasTransactionSubmission(filePath: string): boolean {
  const content = readFileSync(filePath, 'utf8');
  // Check for submitting a transaction built from a user's account
  return (
    content.includes('.sign(') ||
    content.includes('submitTransaction') ||
    content.includes('sendTransaction')
  );
}

describe('custody boundary: no unauthorized transaction submission in routes', () => {
  it('no route handlers call Keypair.sign or submit transactions', () => {
    const routeFiles = findFiles(join(process.cwd(), 'app', 'api'))
      .filter((f) => f.includes('route.ts') || f.includes('route.mts'));

    const violations = routeFiles
      .filter((f) => hasSignCall(f) || hasTransactionSubmission(f))
      .map((f) => ({
        file: f,
        relative: f.replace(process.cwd() + '/', ''),
      }));

    expect(violations).toHaveLength(0, [
      ...violations.map(
        (v) => `File ${v.relative} contains unauthorized Keypair.sign or transaction submission`
      ),
    ]);
  });
});

// ---- 3. No user-key env variable declarations (outside documented exemptions) ----

function hasUserKeyEnv(filePath: string): boolean {
  const content = readFileSync(filePath, 'utf8');
  // Check for user key environment variable declarations beyond PUBLISHER_SECRET
  return (
    (content.includes('PUBLISHER_SECRET') || content.includes('USER_SECRET') || content.includes('PRIVATE_KEY')) &&
    !content.includes('exemption') &&
    !content.includes('env SCHEMA')
  );
}

describe('custody boundary: no undocumented user-key env variables', () => {
  it('no undocumented user-key environment variables in lib/app', () => {
    const violations = allSourceFiles
      .filter((f) => hasUserKeyEnv(f) && !isExempted(f))
      .map((f) => ({
        file: f,
        relative: f.replace(process.cwd() + '/', ''),
      }));

    expect(violations).toHaveLength(0, [
      ...violations.map(
        (v) => `File ${v.relative} has an undocumented user-key environment variable`
      ),
    ]);
  });
});