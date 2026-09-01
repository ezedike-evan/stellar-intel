import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CORRIDORS } from '@/constants';
import type { LeaderboardResponse } from '@/app/api/reputation/leaderboard/route';
import { isMeasured, scoreLabel } from '@/lib/reputation/standings';

export const LEADERBOARD_TOOL_NAME = 'intel.leaderboard';

const BASE_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

// Build the corridor enum at registration time from the same CORRIDORS constant
// the API route uses — keeping a single source of truth for valid corridor IDs.
const validCorridorIds = CORRIDORS.map((c) => c.id) as [string, ...string[]];

const inputShape = {
  corridor: z
    .enum(validCorridorIds)
    .optional()
    .describe(
      'Optional corridor ID to filter by (e.g. "usdc-ngn"). ' +
        'When omitted all registered anchors are ranked globally.'
    ),
};

/**
 * Fetch the leaderboard from the REST API, optionally filtered by corridor.
 * Keeps the tool stateless: it delegates all data assembly to the existing
 * /api/reputation/leaderboard route rather than reimplementing it.
 *
 * Accepts an optional base URL so tests can point at a local server.
 */
export async function fetchLeaderboard(
  corridor: string | undefined,
  baseUrl = BASE_URL()
): Promise<LeaderboardResponse> {
  const url = new URL('/api/reputation/leaderboard', baseUrl);
  if (corridor !== undefined) {
    url.searchParams.set('corridor', corridor);
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`Leaderboard API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<LeaderboardResponse>;
}

/**
 * Annotate each leaderboard entry with the human-readable standing label
 * and measured flag that come from lib/reputation/standings.ts, surfacing
 * the unmeasured-anchor distinction that the raw API carries as n === 0.
 */
function annotateEntries(
  data: LeaderboardResponse
): Array<LeaderboardResponse['leaderboard'][number] & { measured: boolean; standing: string }> {
  return data.leaderboard.map((entry) => {
    const measured = isMeasured(entry.n);
    const { label: standing } = scoreLabel(entry.composite, entry.n);
    return { ...entry, measured, standing };
  });
}

export function registerLeaderboardTool(server: McpServer): void {
  server.registerTool(
    LEADERBOARD_TOOL_NAME,
    {
      title: 'Anchor leaderboard',
      description:
        'Returns anchors ranked by composite reputation score (fill rate, settlement speed, ' +
        'slippage). Pass a corridor ID to restrict the list to anchors that serve that corridor. ' +
        'Unmeasured anchors (n = 0) are included but labelled "not yet measured" so an agent ' +
        'can distinguish between an anchor that is performing poorly and one with no data yet.',
      inputSchema: inputShape,
    },
    async (args) => {
      try {
        const data = await fetchLeaderboard(args.corridor);
        const entries = annotateEntries(data);
        const result = {
          corridor: data.corridor,
          generatedAt: data.generatedAt,
          leaderboard: entries,
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          isError: true,
          content: [{ type: 'text', text: message }],
        };
      }
    }
  );
}
