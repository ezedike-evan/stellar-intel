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
        'Returns the best net-received quote for a corridor + amount (anchor, quoteId, netReceived, expiresAt).',
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
