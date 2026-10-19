import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import commitlintConfig from '../commitlint.config.mjs';

describe('CONTRIBUTING.md commitlint documentation', () => {
  it('documents every commitlint scope-enum entry in CONTRIBUTING.md', () => {
    const contributingPath = path.resolve(__dirname, '../CONTRIBUTING.md');
    const content = fs.readFileSync(contributingPath, 'utf-8');

    const rules = commitlintConfig.rules as Record<string, unknown>;
    const scopeRule = rules?.['scope-enum'] as unknown[];
    expect(scopeRule).toBeDefined();

    const allowedScopes = scopeRule[2] as string[];
    expect(Array.isArray(allowedScopes)).toBe(true);

    for (const scope of allowedScopes) {
      expect(content).toContain(`\`${scope}\``);
    }
  });

  it('documents every commitlint type-enum entry in CONTRIBUTING.md', () => {
    const contributingPath = path.resolve(__dirname, '../CONTRIBUTING.md');
    const content = fs.readFileSync(contributingPath, 'utf-8');

    const rules = commitlintConfig.rules as Record<string, unknown>;
    const typeRule = rules?.['type-enum'] as unknown[];
    expect(typeRule).toBeDefined();

    const allowedTypes = typeRule[2] as string[];
    expect(Array.isArray(allowedTypes)).toBe(true);

    for (const type of allowedTypes) {
      expect(content).toContain(`\`${type}\``);
    }
  });
});
