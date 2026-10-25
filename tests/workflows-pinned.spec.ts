// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A workflow that references an action by tag or branch runs whatever that ref
// points at on the day it runs, usually with a token in scope. Pinning to a
// full commit SHA makes a hijacked tag unable to reach us (#1379). Dependabot's
// github-actions ecosystem keeps the pins current.

const WORKFLOWS_DIR = join(process.cwd(), '.github', 'workflows');
const USES = /^\s*-?\s*uses:\s*([^\s#]+)/gm;
const PINNED = /@[0-9a-f]{40}$/;

function workflowFiles(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
}

/** `file: ref` for every action reference that is not a full commit SHA. */
export function findUnpinned(dir: string): string[] {
  const offenders: string[] = [];
  for (const file of workflowFiles(dir)) {
    const text = readFileSync(join(dir, file), 'utf8');
    for (const match of text.matchAll(USES)) {
      const ref = match[1]!;
      // Local composite actions and container images are not fetched by tag.
      if (ref.startsWith('./') || ref.startsWith('docker://')) continue;
      if (!PINNED.test(ref)) offenders.push(`${file}: ${ref}`);
    }
  }
  return offenders;
}

/**
 * Workflows with neither a top-level `permissions:` nor one on every job.
 *
 * A text scan rather than a YAML parse, so the test needs no parser dependency:
 * the workflows use block style, with the top-level keys at column 0, job ids at
 * two spaces and a job's own keys at four.
 */
export function findMissingPermissions(dir: string): string[] {
  const offenders: string[] = [];
  for (const file of workflowFiles(dir)) {
    const text = readFileSync(join(dir, file), 'utf8');
    if (/^permissions:/m.test(text)) continue;

    const jobsAt = text.search(/^jobs:\s*$/m);
    const jobsBlock = jobsAt === -1 ? '' : text.slice(jobsAt).split('\n').slice(1).join('\n');
    const jobs = jobsBlock.split(/^ {2}(?=[A-Za-z0-9_-]+:\s*$)/m).slice(1);
    if (jobs.length > 0 && jobs.every((job) => /^ {4}permissions:/m.test(job))) continue;

    offenders.push(file);
  }
  return offenders;
}

describe('GitHub workflows (#1379)', () => {
  it('reference every action by a full 40-character commit SHA', () => {
    expect(findUnpinned(WORKFLOWS_DIR)).toEqual([]);
  });

  it('declare permissions, at the top level or on every job', () => {
    expect(findMissingPermissions(WORKFLOWS_DIR)).toEqual([]);
  });

  it('actually checks something', () => {
    expect(workflowFiles(WORKFLOWS_DIR).length).toBeGreaterThan(0);
  });
});

describe('the workflow checks themselves', () => {
  function withWorkflow(contents: string, run: (dir: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), 'workflows-'));
    try {
      writeFileSync(join(dir, 'bad.yml'), contents);
      run(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('flag a tag ref and name the file and ref', () => {
    withWorkflow(
      'name: x\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: foo/bar@v1\n',
      (dir) => expect(findUnpinned(dir)).toEqual(['bad.yml: foo/bar@v1'])
    );
  });

  it('flag a branch ref and a short SHA', () => {
    withWorkflow(
      'name: x\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n' +
        '      - uses: foo/bar@main\n      - uses: foo/baz@3d3c42e\n',
      (dir) => expect(findUnpinned(dir)).toHaveLength(2)
    );
  });

  it('accept a full SHA with a trailing comment, and skip local and docker refs', () => {
    withWorkflow(
      'name: x\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n' +
        `      - uses: foo/bar@${'a'.repeat(40)} # v1.2.3\n` +
        '      - uses: ./.github/actions/local\n' +
        '      - uses: docker://alpine:3\n',
      (dir) => expect(findUnpinned(dir)).toEqual([])
    );
  });

  it('flag a workflow with no permissions anywhere', () => {
    withWorkflow(
      'name: x\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n',
      (dir) => expect(findMissingPermissions(dir)).toEqual(['bad.yml'])
    );
  });

  it('accept permissions on every job instead of the top level', () => {
    withWorkflow(
      'name: x\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: read\n    steps:\n      - run: echo hi\n',
      (dir) => expect(findMissingPermissions(dir)).toEqual([])
    );
  });

  it('flag a workflow where only some jobs declare permissions', () => {
    withWorkflow(
      'name: x\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: read\n    steps:\n      - run: echo hi\n  b:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n',
      (dir) => expect(findMissingPermissions(dir)).toEqual(['bad.yml'])
    );
  });
});
