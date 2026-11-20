import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getQuote, OfframpToolError, QuoteOutputSchema } from '@/lib/mcp/offramp';
import { McpToolError, fromOfframpError, upstreamTimeout } from '@/lib/mcp/errors';

export const QUOTE_TOOL_NAME = 'intel.offramp.quote';

const inputShape = {
  from: z
    .string()
    .min(1)
    .describe('On-chain source asset code as listed by intel.corridors (e.g. USDC, ARST, NGNT)'),
  to: z.string().min(1).describe('Destination fiat currency code, e.g. NGN'),
  amount: z.string().describe('Decimal amount of the source asset to off-ramp'),
};

export function registerQuoteTool(server: McpServer): void {
  server.registerTool(
    QUOTE_TOOL_NAME,
    {
      title: 'Off-ramp quote',
      description:
        'Returns the live net-received quote for a corridor + amount (anchor, quoteId, netReceived, ' +
        'expiresAt, source, indicative). When indicative is true, netReceived is an estimate the ' +
        'anchor may move, not a guarantee; only indicative: false (a SEP-38 firm quote) is binding.',
      inputSchema: inputShape,
      outputSchema: QuoteOutputSchema,
      annotations: { readOnlyHint: true },
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
          content: [{ type: 'text', text: `${toolErr.code}: ${toolErr.message}` }],
        };
      }
    }
  );
}
