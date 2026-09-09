// Generates lib/seo/llms-full.generated.txt — the corpus served at
// /llms-full.txt — from the Markdown sources in docs/ (#1064).
//
// Usage:
//   npm run emit-llms-full            # regenerate the committed artifact
//   npm run emit-llms-full -- --check # exit non-zero if it is stale, write nothing
//
// It runs as part of `prebuild`, so `npm run build` always ships an artifact
// that matches docs/. The --check mode is the same guard without a git working
// tree, for anyone who wants to know before committing.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLlmsFullText, LLMS_FULL_FILE, includedDocs } from '../lib/seo/llms-full.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const outPath = resolve(repoRoot, LLMS_FULL_FILE);

const check = process.argv.includes('--check');
const expected = buildLlmsFullText(repoRoot);

if (check) {
  const actual = existsSync(outPath) ? readFileSync(outPath, 'utf-8') : null;
  if (actual !== expected) {
    console.error(
      `${LLMS_FULL_FILE} is ${actual === null ? 'missing' : 'stale'} — run 'npm run emit-llms-full' and commit the result`
    );
    process.exit(1);
  }
  console.log(`${LLMS_FULL_FILE} is up to date.`);
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, expected, 'utf-8');
  console.log(
    `llms-full.txt written to ${outPath} (${includedDocs().length} documents, ${expected.length} chars)`
  );
}
