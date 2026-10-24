import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getOnrampQuote, OnrampQuoteOutputSchema } from '@/lib/mcp/onramp';
import { McpToolError, upstreamTimeout } from '@/lib/mcp/errors';

export const ONRAMP_QUOTE_TOOL_NAME = 'intel.onramp.quote';

const inputShape = {
  sourceAsset: z.string().min(1).describe('Fiat currency the user pays in, e.g. NGN'),
  destinationAsset: z
    .string()
    .min(1)
    .describe('Stellar asset code to receive, as listed by intel.corridors (e.g. USDC)'),
  amount: z.string().describe('Decimal amount of fiat to deposit'),
};

export function registerOnrampQuoteTool(server: McpServer): void {
  server.registerTool(
    ONRAMP_QUOTE_TOOL_NAME,
    {
      title: 'On-ramp quote',
      description:
        'Returns the best indicative deposit estimate for a fiat → Stellar asset corridor ' +
        '(anchor, asset, estimatedReceived, exchangeRate) plus alternatives. The firm ' +
        'conversion is set by the anchor inside its deposit flow.',
      inputSchema: inputShape,
      outputSchema: OnrampQuoteOutputSchema,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const quote = await getOnrampQuote(args);
        return {
          content: [{ type: 'text', text: JSON.stringify(quote) }],
          structuredContent: quote,
        };
      } catch (err) {
        const toolErr =
          err instanceof McpToolError
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
