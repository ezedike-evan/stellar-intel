import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ANCHOR_HEALTH_TOOL_NAME } from '../packages/mcp/src/tools/anchor-health';
import { ANCHOR_REPUTATION_TOOL_NAME } from '../packages/mcp/src/tools/anchor-reputation';
import { CORRIDORS_TOOL_NAME } from '../packages/mcp/src/tools/corridors';
import { EXECUTE_TOOL_NAME } from '../packages/mcp/src/tools/execute';
import { LEADERBOARD_TOOL_NAME } from '../packages/mcp/src/tools/leaderboard';
import { PREPARE_TOOL_NAME } from '../packages/mcp/src/tools/prepare';
import { PROBE_COVERAGE_TOOL_NAME } from '../packages/mcp/src/tools/probe-coverage';
import { QUOTE_TOOL_NAME } from '../packages/mcp/src/tools/quote';

const KNOWN_TOOL_NAMES = new Set([
  ANCHOR_HEALTH_TOOL_NAME,
  ANCHOR_REPUTATION_TOOL_NAME,
  CORRIDORS_TOOL_NAME,
  EXECUTE_TOOL_NAME,
  LEADERBOARD_TOOL_NAME,
  PREPARE_TOOL_NAME,
  PROBE_COVERAGE_TOOL_NAME,
  QUOTE_TOOL_NAME,
]);

describe('ARCHITECTURE.md §8 MCP tools documentation', () => {
  it('documents only real MCP tools exported in packages/mcp/src/tools', () => {
    const archDocPath = path.resolve(process.cwd(), 'docs/ARCHITECTURE.md');
    const content = fs.readFileSync(archDocPath, 'utf8');

    // Find all backticked intel.* names
    const matches = Array.from(content.matchAll(/`(?<tool>intel\.[a-z0-9_.]+)`/g)).map(
      (m) => m.groups?.tool ?? ''
    );

    expect(matches.length).toBeGreaterThan(0);
    for (const toolName of matches) {
      expect(
        KNOWN_TOOL_NAMES.has(toolName),
        `Documented tool "${toolName}" must be a real MCP tool`
      ).toBe(true);
    }
  });

  it('documents all 8 real MCP tools', () => {
    const archDocPath = path.resolve(process.cwd(), 'docs/ARCHITECTURE.md');
    const content = fs.readFileSync(archDocPath, 'utf8');

    for (const tool of KNOWN_TOOL_NAMES) {
      expect(content).toContain(`\`${tool}\``);
    }
  });
});
