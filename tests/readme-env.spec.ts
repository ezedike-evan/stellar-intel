import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Every variable assigned in .env.example must be documented in the README (#1527). Offline,
// fs only: a variable added to .env.example without a README row fails here.
const ENV_EXAMPLE = readFileSync(join(process.cwd(), '.env.example'), 'utf8');
const README = readFileSync(join(process.cwd(), 'README.md'), 'utf8');
const ASSIGNED = Array.from(ENV_EXAMPLE.matchAll(/^[A-Z_]+(?==)/gm), (match) => match[0]);

describe('README environment variables', () => {
  it('finds the variables assigned in .env.example', () => {
    expect(ASSIGNED.length).toBeGreaterThan(0);
  });

  it.each(ASSIGNED)('documents %s in README.md', (name) => {
    expect(README).toContain(`\`${name}\``);
  });
});
