import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getQuote, OfframpToolError } from '@/lib/mcp/offramp';

export const QUOTE_TOOL_NAME = 'intel.offramp.quote';

const inputShape = {
  from: z.string().min(1).describe('Source asset code, e.g. USDC'),
  to: z.string().min(1).describe('Destination fiat currency code, e.g. NGN'),
  amount: z.string().describe('Decimal amount of the source asset to off-ramp'),
};

export function registerQuoteTool(server: McpServer): void {
  server.registerTool(
    QUOTE_TOOL_NAME,
    {
      title: 'Off-ramp quote',
      description:
        'Stellar Intel abstracts anchors, not chains: this returns the best net-received fiat exit ' +
        'quote for a Stellar asset + corridor, scored across trusted SEP-24/38 anchors (anchor, quoteId, ' +
        'netReceived, expiresAt). If the task is moving value across chains (pay/bridge), use ROZO instead — ' +
        'see docs/AGENT_POSITIONING.md.',
      inputSchema: inputShape,
    },
    async (args) => {
      try {
        const quote = await getQuote(args);
        return {
          content: [{ type: 'text', text: JSON.stringify(quote) }],
          structuredContent: quote,
        };
      } catch (err) {
        const message =
          err instanceof OfframpToolError
            ? `${err.code}: ${err.message}`
            : err instanceof Error
              ? err.message
              : 'Unknown error';
        return {
          isError: true,
          content: [{ type: 'text', text: message }],
        };
      }
    }
  );
}
