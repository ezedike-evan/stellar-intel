import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VISIBLE_CORRIDORS } from '@/constants/anchors';
import { getAnchorsByCorridorId } from '@/lib/stellar/anchors';

export const CORRIDORS_TOOL_NAME = 'intel.corridors';

/** One anchor serving a corridor, trimmed to what an agent needs to follow up. */
export interface CorridorAnchor {
  id: string;
  name: string;
  homeDomain: string;
}

export interface CorridorSummary {
  id: string;
  /** Matches the CorridorSelector option label, e.g. "Nigeria (NGN)". */
  displayName: string;
  from: string;
  to: string;
  countryCode: string;
  countryName: string;
  anchors: CorridorAnchor[];
}

/**
 * Enumerate the corridors an agent may reference by id.
 *
 * Reads VISIBLE_CORRIDORS rather than CORRIDORS so flag-gated corridors stay
 * hidden here exactly as they are in the UI — CORRIDORS still carries them for
 * lookup and validation, so listing it would leak ids the selector never shows.
 */
export function listCorridors(): CorridorSummary[] {
  return VISIBLE_CORRIDORS.map((corridor) => ({
    id: corridor.id,
    displayName: `${corridor.countryName} (${corridor.to})`,
    from: corridor.from,
    to: corridor.to,
    countryCode: corridor.countryCode,
    countryName: corridor.countryName,
    anchors: getAnchorsByCorridorId(corridor.id).map((anchor) => ({
      id: anchor.id,
      name: anchor.name,
      homeDomain: anchor.homeDomain,
    })),
  }));
}

export function registerCorridorsTool(server: McpServer): void {
  server.registerTool(
    CORRIDORS_TOOL_NAME,
    {
      title: 'List corridors',
      description:
        'Lists every corridor Stellar Intel currently surfaces, with its id, display name, ' +
        'source asset, destination fiat currency, country, and the anchors that serve it. ' +
        'Call this before any tool that takes a corridor id rather than guessing one. ' +
        'Flag-gated corridors that the UI hides are omitted.',
      inputSchema: {},
    },
    async () => {
      const corridors = listCorridors();
      const result = { count: corridors.length, corridors };
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      };
    }
  );
}
