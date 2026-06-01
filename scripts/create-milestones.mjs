#!/usr/bin/env node
// scripts/create-milestones.mjs
//
// Create (or update) the canonical Stellar Intel milestone set via the GitHub
// CLI. Run once per repo, then periodically as waves close out.
//
// Prereqs:
//   - `gh` authenticated against the target repo
//   - Run from inside a git clone of stellar-intel (uses `gh repo view`)
//
// Usage:
//   node scripts/create-milestones.mjs             # create/update
//   node scripts/create-milestones.mjs --dry-run   # print plan only
//
// Idempotent: re-runs update titles/descriptions of existing milestones by
// number match (title stays stable; description and due date refresh).

import { execFileSync } from 'node:child_process';

const DRY_RUN = process.argv.includes('--dry-run');

const MILESTONES = [
  {
    title: 'v1.0 Core',
    description:
      'Core executable off-ramp. Issues #001–#070. Gate: npm run test:release green on clean clone.',
  },
  {
    title: 'v1.1 Hardening',
    description: 'SEP-38 quoting, replay protection, error surfaces, telemetry. Issues #071–#110.',
  },
  {
    title: 'v1.2 Router + Seeds',
    description: 'Multi-anchor solver, seeded rate data, composite scoring. Issues #111–#140.',
  },
  {
    title: 'v1.3 Polish',
    description: 'UI polish, accessibility, bundle budget, release gate for v1. Issues #141–#150.',
  },
  {
    title: 'v2 Observable',
    description:
      'Reputation as product surface + Soroban oracle live + multi-anchor split routing + public reputation API. Issues #151–#250.',
  },
  {
    title: 'v3 Guaranteed',
    description:
      'Intent-level SLAs: guaranteed rate, quote-bonding, failure insurance. Scope to be written in v2 cooldown.',
  },
  {
    title: 'v4 Universal',
    description: 'SDK + MCP GA + embeddable widget for third-party wallets and dapps.',
  },
  {
    title: 'v5 Institutional',
    description:
      'Compliance-grade primitives: audit trail, signed provenance, institutional KYC adapters.',
  },
];

function sh(cmd, args, options = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', ...options }).trim();
}

function listExistingMilestones() {
  const raw = sh('gh', [
    'api',
    '--paginate',
    'repos/{owner}/{repo}/milestones?state=all&per_page=100',
  ]);
  // `gh api --paginate` concatenates arrays with no separator; parse by lines.
  const parsed = [];
  for (const chunk of raw.split(/\n(?=\[)/)) {
    if (!chunk.trim()) continue;
    try {
      parsed.push(...JSON.parse(chunk));
    } catch {
      // ignore malformed pagination boundary
    }
  }
  return parsed;
}

function createMilestone({ title, description }) {
  if (DRY_RUN) {
    console.log(`  [dry-run] would create "${title}"`);
    return;
  }
  sh('gh', [
    'api',
    '--method',
    'POST',
    'repos/{owner}/{repo}/milestones',
    '-f',
    `title=${title}`,
    '-f',
    `description=${description}`,
  ]);
  console.log(`  created: ${title}`);
}

function updateMilestone(number, { title, description }) {
  if (DRY_RUN) {
    console.log(`  [dry-run] would update #${number} "${title}"`);
    return;
  }
  sh('gh', [
    'api',
    '--method',
    'PATCH',
    `repos/{owner}/{repo}/milestones/${number}`,
    '-f',
    `title=${title}`,
    '-f',
    `description=${description}`,
  ]);
  console.log(`  updated: ${title} (#${number})`);
}

function main() {
  const existing = listExistingMilestones();
  const byTitle = new Map(existing.map((m) => [m.title, m]));

  console.log(`Syncing ${MILESTONES.length} milestones${DRY_RUN ? ' (dry-run)' : ''}`);
  for (const m of MILESTONES) {
    const hit = byTitle.get(m.title);
    if (hit) {
      updateMilestone(hit.number, m);
    } else {
      createMilestone(m);
    }
  }
  console.log('Done.');
}

main();
