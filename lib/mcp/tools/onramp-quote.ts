import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getOnrampQuote, OnrampQuoteOutputSchema, OnrampToolError } from '@/lib/mcp/onramp';
import { fromOnrampError, McpToolError, upstreamTimeout } from '@/lib/mcp/errors';

export const ONRAMP_QUOTE_TOOL_NAME = 'intel.onramp.quote';

const inputShape = {
  sourceAsset: z.string().min(1).describe('Fiat currency the user pays in, e.g. NGN'),
  destinationAsset: z
    .string()
    .min(1)
    .describe('Stellar asset code to receive, as listed by intel.corridors (e.g. USDC)'),
  amount: z.string().describe('Decimal amount of fiat to deposit'),
  asset: z
    .string()
    .optional()
    .describe('Only quote this asset, as a SEP-38 identifier (stellar:CODE:ISSUER)'),
};

export function registerOnrampQuoteTool(server: McpServer): void {
  server.registerTool(
    ONRAMP_QUOTE_TOOL_NAME,
    {
      title: 'On-ramp quote',
      description:
        'Returns the best indicative deposit estimate for a fiat → Stellar asset corridor ' +
        '(anchor, asset, estimatedReceived, fee, exchangeRate) plus alternatives. This is an ' +
        'indicative estimate, never a firm quote: the anchor sets the final conversion inside ' +
        'its deposit flow. Re-fetch after expiresAt.',
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
          err instanceof OnrampToolError
            ? fromOnrampError(err)
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
