import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CORRIDORS, VISIBLE_CORRIDORS } from '../../../../constants/anchors.js';

interface Corridor {
  id: string;
  displayName: string;
  anchors: string[];
}

export function registerCorridorsTool(server: McpServer): void {
  server.tool(
    'intel.corridors',
    {},
    async () => {
      const visibleIds = new Set(VISIBLE_CORRIDORS as readonly string[]);
      const allCorridors = Array.isArray(CORRIDORS)
        ? (CORRIDORS as Corridor[])
        : Object.values(CORRIDORS as Record<string, Corridor>);

      const corridors = allCorridors
        .filter((sorridor) => visibleIds.has(corridor.id))
        .map((corridor) => ({
          id: corridor.id,
          displayName: corridor.displayName ?? corridor.id,
          anchors: corridor.anchors ?? [],
        }));

      return {
        content: [
          { type: 'text', text: JSON.stringify(corridors, null, 2) },
        ],
      };
    },
  );
}
