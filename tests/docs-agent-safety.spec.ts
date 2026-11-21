import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TOOL_SCOPES } from '@/lib/mcp/scopes';

describe('docs agent safety & MCP scopes drift guard', () => {
  it('documents every tool and its required scope in docs/MCP.md on the same table row', () => {
    const mcpDocPath = path.resolve(process.cwd(), 'docs/MCP.md');
    const content = fs.readFileSync(mcpDocPath, 'utf8');

    const lines = content.split('\n');
    for (const [tool, scope] of Object.entries(TOOL_SCOPES)) {
      const toolBackticked = `\`${tool}\``;
      const matchingRow = lines.find(
        (line) => line.includes(toolBackticked) && line.includes(scope)
      );
      expect(
        matchingRow,
        `docs/MCP.md table row missing for tool "${tool}" and scope "${scope}"`
      ).toBeDefined();
    }
  });

  it('mentions CALLER_TOKEN_SECRET in docs/SECURITY.md', () => {
    const secDocPath = path.resolve(process.cwd(), 'docs/SECURITY.md');
    const content = fs.readFileSync(secDocPath, 'utf8');
    expect(content).toContain('CALLER_TOKEN_SECRET');
  });
});
