import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { prepareIntent, OfframpToolError } from '@/lib/mcp/offramp';

export const PREPARE_TOOL_NAME = 'intel.offramp.prepare';

const inputShape = {
  type: z.literal('offramp').describe('Intent type — must be "offramp"'),
  sourceAsset: z.string().min(1).describe('Source asset code, e.g. USDC'),
  destinationAsset: z.string().min(1).describe('Destination fiat code, e.g. NGN'),
  amount: z.string().describe('Decimal amount of the source asset'),
  sender: z.string().describe('Stellar public key of the off-ramping account'),
  recipient: z.string().min(1).describe('Off-chain recipient identifier'),
};

export function registerPrepareTool(server: McpServer): void {
  server.registerTool(
    PREPARE_TOOL_NAME,
    {
      title: 'Prepare off-ramp intent',
      description:
        'Stellar Intel abstracts anchors, not chains: this prepares an unsigned intent envelope (intent + ' +
        'hash) and unsigned Stellar transaction for exiting a Stellar asset to fiat via a trusted SEP-24/38 ' +
        'anchor, for the agent to sign. If the task is moving value across chains (pay/bridge), use ROZO ' +
        'instead — see docs/AGENT_POSITIONING.md.',
      inputSchema: inputShape,
    },
    async (args) => {
      try {
        const result = await prepareIntent(args);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
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
