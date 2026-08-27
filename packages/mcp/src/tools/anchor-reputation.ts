import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export const ANCHOR_REPUTATION_TOOL_NAME = 'intel.anchor.reputation';

const inputShape = {
  anchor: z.string().min(1).describe('Anchor identifier (e.g., cowrie, flutterwave)'),
};

const PercentilesSchema = z.object({
  p50: z.number(),
  p95: z.number(),
});

const ScorecardOkSchema = z.object({
  state: z.literal('ok'),
  window: z.union([z.literal(7), z.literal(30), z.literal(90)]),
  sampleSize: z.number(),
  fillRate: z.number(),
  settleMs: PercentilesSchema,
  slippage: PercentilesSchema,
  computedAt: z.string(),
  lastPublisherTxTimestamp: z.string().nullable(),
});

const ScorecardInsufficientSchema = z.object({
  state: z.literal('insufficient_data'),
  window: z.union([z.literal(7), z.literal(30), z.literal(90)]),
  sampleSize: z.number(),
  computedAt: z.string(),
  lastPublisherTxTimestamp: z.string().nullable(),
});

const ScorecardSchema = z.union([ScorecardOkSchema, ScorecardInsufficientSchema]);

export const AnchorReputationOutputSchema = z.object({
  anchorId: z.string(),
  scorecards: z.record(z.union([z.literal(7), z.literal(30), z.literal(90)]), ScorecardSchema),
});

export type AnchorReputationOutput = z.infer<typeof AnchorReputationOutputSchema>;

const BASE_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export async function fetchAnchorReputation(anchor: string): Promise<AnchorReputationOutput> {
  const url = `${BASE_URL()}/api/reputation/${encodeURIComponent(anchor)}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch reputation for ${anchor}: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return AnchorReputationOutputSchema.parse(data);
}

export function registerAnchorReputationTool(server: McpServer): void {
  server.registerTool(
    ANCHOR_REPUTATION_TOOL_NAME,
    {
      title: 'Anchor reputation scorecards',
      description:
        'Returns 7/30/90-day rolling percentile scorecards for an anchor. Each scorecard shows state (ok or insufficient_data), sample size, fill rate, settlement latency percentiles (p50/p95), and slippage percentiles (p50/p95).',
      inputSchema: inputShape,
      outputSchema: AnchorReputationOutputSchema,
    },
    async (args) => {
      try {
        const result = await fetchAnchorReputation(args.anchor);
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
