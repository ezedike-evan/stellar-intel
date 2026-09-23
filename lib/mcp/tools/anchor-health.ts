import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ANCHORS } from '@/constants/anchors';

export const ANCHOR_HEALTH_TOOL_NAME = 'intel.anchor.health';

const inputShape = {
  domain: z.string().min(1).describe('Anchor domain (e.g. anclap.com)'),
  asset: z.string().optional().describe('Optional asset code to check status for (e.g. USDC, NGN)'),
};

export const AnchorHealthOutputSchema = z.object({
  anchorId: z.string(),
  status: z.string(),
  consecutiveFailures: z.number(),
  degraded: z.boolean(),
  lastCheckedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  stale: z.boolean(),
});

export type AnchorHealthOutput = z.infer<typeof AnchorHealthOutputSchema>;

const BASE_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export async function fetchAnchorHealth(
  domain: string,
  asset?: string
): Promise<AnchorHealthOutput> {
  const domainLower = domain.toLowerCase().trim();
  const anchor = ANCHORS.find(
    (a) =>
      a.homeDomain.toLowerCase() === domainLower || a.serviceDomain?.toLowerCase() === domainLower
  );

  if (!anchor) {
    throw new Error(`No anchor found with domain "${domain}"`);
  }

  if (asset) {
    const assetUpper = asset.toUpperCase().trim();
    const supportsAsset =
      anchor.assetCode.toUpperCase() === assetUpper ||
      anchor.corridors.some((c) => c.split('-').some((part) => part.toUpperCase() === assetUpper));

    if (!supportsAsset) {
      throw new Error(`Asset "${asset}" is not supported by anchor "${domain}"`);
    }
  }

  const url = `${BASE_URL()}/api/v1/anchors/${encodeURIComponent(anchor.id)}/health`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch health for ${anchor.id}: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return AnchorHealthOutputSchema.parse(data);
}

export function registerAnchorHealthTool(server: McpServer): void {
  server.registerTool(
    ANCHOR_HEALTH_TOOL_NAME,
    {
      title: 'Anchor health metrics',
      description:
        'Returns the current status, consecutive failure count, degraded flag, last check timestamp, last error message, and staleness flag for a given anchor domain and optional asset.',
      inputSchema: inputShape,
      outputSchema: AnchorHealthOutputSchema,
    },
    async (args) => {
      try {
        const result = await fetchAnchorHealth(args.domain, args.asset);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
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
