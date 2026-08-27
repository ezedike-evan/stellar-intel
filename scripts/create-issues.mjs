#!/usr/bin/env node
// File a batch of issues from a catalog written in the format documented in
// .github/ISSUE_BATCH_TEMPLATE.md.
//
// Replaces scripts/create-ui-issues.mjs and scripts/create-batch-2-issues.mjs,
// which were the same script twice with the catalog path baked in.
//
// Idempotent: a block whose exact title already exists is skipped, so a partial
// run can be repeated safely. Dry run is the default.
//
//   node scripts/create-issues.mjs issues-ui.md
//   node scripts/create-issues.mjs issues-ui.md --apply
//   node scripts/create-issues.mjs issues-ui.md --apply --only C002,C003
//   node scripts/create-issues.mjs issues-ui.md --apply --repo owner/name

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const CATALOG = argv.find((a) => !a.startsWith('--'));

function flag(name) {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
}

const ONLY = flag('--only')
  ? new Set(
      flag('--only')
        .split(',')
        .map((s) => s.trim())
    )
  : null;
const REPO = flag('--repo');

if (!CATALOG) {
  console.error(
    'usage: node scripts/create-issues.mjs <catalog.md> [--apply] [--only IDS] [--repo owner/name]'
  );
  process.exit(2);
}

const repoArgs = REPO ? ['--repo', REPO] : [];

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function tryGh(args) {
  try {
    return { ok: true, out: gh(args) };
  } catch (err) {
    return { ok: false, err: err.stderr || err.message };
  }
}

/**
 * Blocks are separated by a line containing only `---`. The header carries the
 * id and title; everything up to `Labels:` is the body, verbatim.
 */
function parseCatalog(text, catalogName) {
  const blocks = [];
  const seen = new Set();

  for (const chunk of text.split(/\r?\n---\r?\n/)) {
    const lines = chunk.split(/\r?\n/);
    const headerIdx = lines.findIndex((l) => /^#[A-Za-z]*\d+ /.test(l.trim()));
    if (headerIdx === -1) continue;

    const m = lines[headerIdx].trim().match(/^#([A-Za-z]*\d+) (.+)$/);
    if (!m) continue;
    const [, id, title] = m;

    if (seen.has(id)) throw new Error(`${id}: duplicate id in ${catalogName}`);
    seen.add(id);

    // Trimmed match on purpose: Prettier reflows these catalogs and can turn
    // `Labels:` into a list continuation indented by two spaces, which is what
    // broke the previous per-catalog scripts.
    const labelsLine = lines.find((l) => l.trim().startsWith('Labels:'));
    if (!labelsLine) throw new Error(`${id}: missing a "Labels:" line`);

    const msLine = lines.find((l) => l.trim().startsWith('Milestone:'));
    const labels = labelsLine
      .trim()
      .replace('Labels:', '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const body = lines
      .slice(headerIdx + 1, lines.indexOf(labelsLine))
      .join('\n')
      .trim();

    blocks.push({
      id,
      title: title.trim(),
      body: `${body}\n\n---\n_Filed from \`${catalogName}\` · \`${id}\`_`,
      labels,
      milestone: msLine ? msLine.trim().replace('Milestone:', '').trim() : null,
    });
  }

  return blocks;
}

/**
 * Verify rather than create. The previous scripts ran
 * `gh label create <name> --force --color ededed`, which updates a label that
 * already exists — running either of them would have repainted the whole
 * taxonomy grey. Unknown labels are a typo in the catalog, not a request.
 */
function checkLabels(blocks) {
  const res = tryGh(['label', 'list', ...repoArgs, '--limit', '300', '--json', 'name']);
  if (!res.ok) {
    console.error(`  ! could not list labels: ${res.err.trim()}`);
    process.exit(1);
  }
  const existing = new Set(JSON.parse(res.out).map((l) => l.name));
  const missing = [...new Set(blocks.flatMap((b) => b.labels))].filter((l) => !existing.has(l));

  if (missing.length) {
    console.error('Unknown labels referenced by the catalog:');
    for (const l of missing) console.error(`  - ${l}`);
    console.error('\nAdd them to .github/labels.yml and let label-sync apply them,');
    console.error('or fix the typo in the catalog. Not creating them from here.');
    process.exit(1);
  }
}

function checkMilestones(blocks) {
  const used = [...new Set(blocks.map((b) => b.milestone).filter(Boolean))];
  if (!used.length) return;

  const res = tryGh([
    'api',
    ...(REPO ? [`repos/${REPO}/milestones`] : ['repos/{owner}/{repo}/milestones']),
    '--jq',
    '.[].title',
  ]);
  if (!res.ok) return;

  const existing = new Set(
    res.out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const missing = used.filter((m) => !existing.has(m));
  if (missing.length) {
    console.error(`Unknown milestones: ${missing.join(', ')}`);
    console.error('Create them in the GitHub UI first, or drop the Milestone: line.');
    process.exit(1);
  }
}

/**
 * Fetch every existing title once. Searching per block turned a 60-block
 * catalog into 60 API round trips, which took minutes and hit rate limits.
 */
function existingTitles() {
  const res = tryGh([
    'issue',
    'list',
    ...repoArgs,
    '--state',
    'all',
    '--json',
    'title',
    '--limit',
    '1000',
  ]);
  if (!res.ok) {
    console.error(`  ! could not list issues: ${res.err.trim()}`);
    process.exit(1);
  }
  try {
    return new Set(JSON.parse(res.out).map((i) => i.title));
  } catch {
    return new Set();
  }
}

const catalogName = basename(CATALOG);
const all = parseCatalog(readFileSync(CATALOG, 'utf8'), catalogName);
const blocks = ONLY ? all.filter((b) => ONLY.has(b.id)) : all;

if (!blocks.length) {
  console.error(`No blocks matched in ${catalogName}.`);
  process.exit(1);
}

console.log(
  `${catalogName}: ${blocks.length} block(s)${APPLY ? '' : '  [DRY RUN — pass --apply to file]'}\n`
);

checkLabels(blocks);
checkMilestones(blocks);

const taken = existingTitles();

const tmp = mkdtempSync(join(tmpdir(), 'issue-batch-'));
let created = 0;
let skipped = 0;
const filed = [];

for (const b of blocks) {
  if (taken.has(b.title)) {
    console.log(`  skip   ${b.id}  (title already exists)`);
    skipped += 1;
    continue;
  }

  if (!APPLY) {
    console.log(`  [dry]  ${b.id}  ${b.title}`);
    console.log(
      `         labels: ${b.labels.join(', ')}${b.milestone ? ` · milestone: ${b.milestone}` : ''}`
    );
    continue;
  }

  const bodyFile = join(tmp, `${b.id}.md`);
  writeFileSync(bodyFile, b.body);

  const args = ['issue', 'create', ...repoArgs, '--title', b.title, '--body-file', bodyFile];
  // One comma-joined --label, not a repeated flag. gh accepts the repeated
  // form and then silently creates the issue with no labels at all, which is
  // how 60 issues were filed unlabelled before this was caught.
  if (b.labels.length) args.push('--label', b.labels.join(','));
  if (b.milestone) args.push('--milestone', b.milestone);

  const res = tryGh(args);
  if (!res.ok) {
    console.error(`  FAIL   ${b.id}: ${res.err.trim()}`);
    continue;
  }
  const url = res.out.trim().split('\n').pop();
  console.log(`  ok     ${b.id}  ${url}`);
  filed.push({ id: b.id, number: Number(url.split('/').pop()), wanted: b.labels.length });
  created += 1;
}

console.log(`\n${APPLY ? `${created} created` : 'dry run'}, ${skipped} skipped.`);

/**
 * A create that reports success is not proof the labels stuck: gh exits 0 on a
 * `--label` form it does not honour. Read them back rather than trusting it.
 */
if (APPLY && filed.length) {
  const res = tryGh([
    'issue',
    'list',
    ...repoArgs,
    '--state',
    'all',
    '--json',
    'number,labels',
    '--limit',
    '1000',
  ]);
  if (res.ok) {
    const counts = new Map(JSON.parse(res.out).map((i) => [i.number, i.labels.length]));
    const bare = filed.filter((f) => f.wanted > 0 && !counts.get(f.number));
    if (bare.length) {
      console.error(`\n! ${bare.length} issue(s) were created without their labels:`);
      for (const f of bare) console.error(`    ${f.id}  #${f.number}`);
      process.exitCode = 1;
    }
  }
}
