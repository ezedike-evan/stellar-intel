import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { prepareOnrampIntent, OnrampPrepareOutputSchema, OnrampToolError } from '@/lib/mcp/onramp';
import { fromOnrampError, McpToolError, upstreamTimeout } from '@/lib/mcp/errors';
import { OnrampDepositMethodSchema, OnrampMemoTypeSchema } from '@/lib/intent/onramp-schema';

export const ONRAMP_PREPARE_TOOL_NAME = 'intel.onramp.prepare';

const inputShape = {
  type: z.literal('onramp').describe('Intent type — must be "onramp"'),
  sourceAsset: z.string().min(1).describe('Fiat currency the user pays in, e.g. NGN'),
  destinationAsset: z.string().min(1).describe('Stellar asset code to receive, e.g. USDC'),
  amount: z.string().describe('Decimal amount of fiat to deposit'),
  sender: z.string().min(1).describe('Payer reference on the fiat rail (not a Stellar account)'),
  destination: z.string().describe('Stellar public key credited when the deposit completes'),
  depositMethod: OnrampDepositMethodSchema.describe('How the user funds the deposit'),
  memo: z.string().min(1).optional().describe('Memo for anchors that use a pooled account'),
  memoType: OnrampMemoTypeSchema.optional().describe('Kind of memo; required with memo'),
};

export function registerOnrampPrepareTool(server: McpServer): void {
  server.registerTool(
    ONRAMP_PREPARE_TOOL_NAME,
    {
      title: 'Prepare on-ramp intent',
      description:
        'Returns an unsigned on-ramp intent envelope (intent + hash), an unsigned changeTrust ' +
        'transaction when the destination lacks the trustline, and a handoffUrl. Does not ' +
        'execute. Returns a handoffUrl the user must open in a browser to complete KYC and the ' +
        'deposit.',
      inputSchema: inputShape,
      outputSchema: OnrampPrepareOutputSchema,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const result = await prepareOnrampIntent(args);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
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
