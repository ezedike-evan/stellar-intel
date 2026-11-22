import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  type ExecutionSlaReport,
  ExecutionSlaReportSchema,
} from '@/lib/reputation/execution-sla';

export const ANCHOR_SLA_TOOL_NAME = 'intel.anchor.sla';

const inputShape = {
  anchor: z.string().min(1).describe('Anchor identifier (e.g., moneygram, cowrie)'),
  corridor: z
    .string()
    .min(1)
    .optional()
    .describe('Corridor id, e.g. usdc-ngn. Omit for every corridor the anchor serves.'),
};

export type AnchorSlaOutput = ExecutionSlaReport;

const BASE_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export async function fetchAnchorSla(anchor: string, corridor?: string): Promise<AnchorSlaOutput> {
  const url = new URL(`${BASE_URL()}/api/reputation/${encodeURIComponent(anchor)}/sla`);
  if (corridor) {
    url.searchParams.set('corridor', corridor);
  }
  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch SLA for ${anchor}: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return ExecutionSlaReportSchema.parse(data);
}

export function registerAnchorSlaTool(server: McpServer): void {
  server.registerTool(
    ANCHOR_SLA_TOOL_NAME,
    {
      title: 'Anchor settlement-time SLA',
      description:
        "Returns p50/p95/p99 settlement latency over the trailing 30 days for an anchor, overall and per corridor, with breach status against the anchor's declared thresholds and a daily p95 series. state is insufficient_data until 30 completed withdrawals exist; p99 is null below 100.",
      inputSchema: inputShape,
      outputSchema: ExecutionSlaReportSchema,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const result = await fetchAnchorSla(args.anchor, args.corridor);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
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
