import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('anchor exclusions documentation', () => {
  it('issuer-only table matches snapshot issuerOnlyDomains', () => {
    const root = process.cwd();
    const docPath = join(root, 'docs', 'anchors', 'exclusions.md');
    const snapshotPath = join(root, 'scripts', 'anchor-survey.snapshot.json');

    const docContent = readFileSync(docPath, 'utf8');
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as {
      issuerOnlyDomains: string[];
    };

    // Extract lines between "## Issuer-only domains" and the next heading or note
    const sectionMatch = docContent.match(
      /## Issuer-only domains[^\n]*\n([\s\S]*?)(?=\n_Note:|\n>|\n## )/
    );
    expect(sectionMatch).toBeTruthy();

    const tableContent = sectionMatch && typeof sectionMatch[1] === 'string' ? sectionMatch[1] : '';
    const tableLines = tableContent.split('\n').filter((line) => line.trim().startsWith('|'));

    // Skip the header row and divider row (first two rows)
    const dataRows = tableLines.slice(2);
    const docDomains = dataRows
      .map((row) => {
        const match = row.match(/`([^`]+)`/);
        return match ? match[1] : null;
      })
      .filter((d): d is string => d !== null);

    expect(docDomains).toEqual(snapshot.issuerOnlyDomains);
  });
});
