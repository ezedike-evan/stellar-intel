import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { executeIntent, OfframpToolError, ExecuteOutputSchema } from '@/lib/mcp/offramp';
import { McpToolError, fromOfframpError, upstreamTimeout } from '../errors.js';

export const EXECUTE_TOOL_NAME = 'intel.execute';

const inputShape = {
  unsignedEnvelope: z
    .object({
      intent: z.object({
        type: z.literal('offramp').describe('Intent type — must be "offramp"'),
        sourceAsset: z.string().min(1),
        destinationAsset: z.string().min(1),
        amount: z.string(),
        sender: z.string(),
        recipient: z.string().min(1),
      }),
      intentHash: z.string().describe('Hex SHA-256 of the canonicalized intent'),
    })
    .describe('The exact envelope returned by intel.offramp.prepare'),
  signature: z
    .string()
    .min(1)
    .describe(
      "Base64 ed25519 signature over unsignedEnvelope.intentHash, produced by the sender's own wallet"
    ),
  signedTx: z
    .string()
    .min(1)
    .describe(
      "Base64 XDR of the unsignedTx from intel.offramp.prepare, signed by the sender's own wallet"
    ),
};

export function registerExecuteTool(server: McpServer): void {
  server.registerTool(
    EXECUTE_TOOL_NAME,
    {
      title: 'Execute a prepared intent',
      description:
        'Verifies an agent-signed intent + transaction against the prepared intent and submits it to ' +
        'Horizon. Stellar Intel never signs anything — the agent signs the intent hash and the ' +
        'transaction itself with its own wallet before calling this tool.',
      inputSchema: inputShape,
      outputSchema: ExecuteOutputSchema,
    },
    async (args) => {
      try {
        const result = await executeIntent(args);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
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
