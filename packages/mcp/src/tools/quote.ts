import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getQuote, OfframpToolError, QuoteOutputSchema } from '@/lib/mcp/offramp';
import { McpToolError, fromOfframpError, upstreamTimeout } from '../errors.js';

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
        'Returns the live net-received quote for a corridor + amount (anchor, quoteId, netReceived, expiresAt).',
      inputSchema: inputShape,
      outputSchema: QuoteOutputSchema,
    },
    async (args) => {
      try {
        const quote = await getQuote(args);
        return {
          content: [{ type: 'text', text: JSON.stringify(quote) }],
          structuredContent: quote,
        };
      } catch (err) {
        const toolErr =
          err instanceof OfframpToolError
            ? fromOfframpError(err)
            : err instanceof McpToolError
              ? err
              : upstreamTimeout(
                  err instanceof Error ? err.message : 'Unknown error',
                  'UNKNOWN_ERROR'
                );
        return {
          isError: true,
          content: [{ type: 'text', text: `${toolErr.category}: ${toolErr.message}` }],
        };
      }
    }
  );
}
