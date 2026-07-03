#!/usr/bin/env node
// Bulk-create the UI Issue Batch C catalog (issues-ui.md) on GitHub via `gh`.
//
// Idempotent: an issue whose exact title already exists is skipped. Ensures every
// referenced label and milestone exists first. Default mode is a DRY RUN — pass
// --apply to actually create issues.
//
// Usage:
//   node scripts/create-ui-issues.mjs                        # dry run (default)
//   node scripts/create-ui-issues.mjs --apply                # create for real
//   node scripts/create-ui-issues.mjs --apply --only C001,C016,C029

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const CATALOG = 'issues-ui.md';
const APPLY = process.argv.includes('--apply');
const onlyArg = process.argv[process.argv.indexOf('--only') + 1];
const ONLY = process.argv.includes('--only')
  ? new Set(onlyArg.split(',').map((s) => s.trim()))
  : null;

const MILESTONES = {
  'v1.3 Off-ramp Polish': 'Off-ramp page UX hardening, trust signals, accessibility, performance.',
  'v1.4 SEP-6': 'SEP-6 enablement: rate source + programmatic withdraw.',
  'v1.5 Anchor Fleet': 'Survey-driven anchor onboarding and fleet infrastructure.',
};

function gh(args, { capture = true } = {}) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
}

function tryGh(args) {
  try {
    return { ok: true, out: gh(args) };
  } catch (err) {
    return { ok: false, err: err.stderr || err.message };
  }
}

/** Parse issues-ui.md into structured blocks. */
function parseCatalog(text) {
  const blocks = [];
  for (const chunk of text.split(/\n---\n/)) {
    const lines = chunk.split('\n');
    const headerIdx = lines.findIndex((l) => /^#C\d+ /.test(l));
    if (headerIdx === -1) continue;
    const header = lines[headerIdx];
    const m = header.match(/^#(C\d+) (.+)$/);
    if (!m) continue;
    const [, id, rest] = m;
    const labelsLine = lines.find((l) => l.startsWith('Labels:'));
    const msLine = lines.find((l) => l.startsWith('Milestone:'));
    if (!labelsLine || !msLine) {
      throw new Error(`${id}: missing Labels: or Milestone: line`);
    }
    const labels = labelsLine
      .replace('Labels:', '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const milestone = msLine.replace('Milestone:', '').trim();
    const labelsIdx = lines.indexOf(labelsLine);
    const body = lines
      .slice(headerIdx + 1, labelsIdx)
      .join('\n')
      .trim();
    blocks.push({
      id,
      title: `${id}: ${rest}`,
      body: `${body}\n\n---\n_Catalog: \`${CATALOG}\` · ${id}_`,
      labels,
      milestone,
    });
  }
  return blocks;
}

function ensureLabels(blocks) {
  const labels = new Set(blocks.flatMap((b) => b.labels));
  for (const name of labels) {
    if (!APPLY) {
      console.log(`  [dry] ensure label: ${name}`);
      continue;
    }
    tryGh(['label', 'create', name, '--force', '--color', 'ededed']);
  }
}

function ensureMilestones(blocks) {
  const used = new Set(blocks.map((b) => b.milestone));
  for (const title of used) {
    if (!APPLY) {
      console.log(`  [dry] ensure milestone: ${title}`);
      continue;
    }
    const res = tryGh([
      'api',
      '--method',
      'POST',
      'repos/{owner}/{repo}/milestones',
      '-f',
      `title=${title}`,
      '-f',
      `description=${MILESTONES[title] ?? ''}`,
    ]);
    if (!res.ok && !/already_exists|HTTP 422/.test(res.err)) {
      console.error(`  ! milestone "${title}": ${res.err.trim()}`);
    }
  }
}

function titleExists(title) {
  const res = tryGh([
    'issue',
    'list',
    '--state',
    'all',
    '--search',
    `${title} in:title`,
    '--json',
    'title',
    '--limit',
    '50',
  ]);
  if (!res.ok) return false;
  try {
    return JSON.parse(res.out).some((i) => i.title === title);
  } catch {
    return false;
  }
}

function main() {
  const text = readFileSync(CATALOG, 'utf8');
  const blocks = parseCatalog(text).filter((b) => !ONLY || ONLY.has(b.id));
  console.log(`Parsed ${blocks.length} issues from ${CATALOG} (${APPLY ? 'APPLY' : 'DRY RUN'})\n`);

  ensureLabels(blocks);
  ensureMilestones(blocks);

  const tmp = mkdtempSync(join(tmpdir(), 'ui-issues-'));
  let created = 0;
  let skipped = 0;
  for (const b of blocks) {
    if (titleExists(b.title)) {
      console.log(`  skip (exists): ${b.title}`);
      skipped++;
      continue;
    }
    if (!APPLY) {
      console.log(
        `  [dry] create: ${b.title}\n         labels: ${b.labels.join(', ')} | milestone: ${b.milestone}`
      );
      created++;
      continue;
    }
    const bodyFile = join(tmp, `${b.id}.md`);
    writeFileSync(bodyFile, b.body);
    const args = [
      'issue',
      'create',
      '--title',
      b.title,
      '--body-file',
      bodyFile,
      '--milestone',
      b.milestone,
    ];
    for (const l of b.labels) args.push('--label', l);
    const res = tryGh(args);
    if (res.ok) {
      console.log(`  created: ${b.title} -> ${res.out.trim()}`);
      created++;
    } else {
      console.error(`  ! failed: ${b.title}: ${res.err.trim()}`);
    }
  }

  console.log(
    `\n${APPLY ? 'Created' : 'Would create'}: ${created} · skipped (exists): ${skipped} · total: ${blocks.length}`
  );
  if (!APPLY) console.log('Re-run with --apply to create them.');
}

main();
