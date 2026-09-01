import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// lib/config.ts validates these at import time (throws if unset) — they're
// meaningful defaults for a standalone MCP client, not secrets, so set them
// before anything transitively pulls lib/config.ts in.
const MCP_ENV_DEFAULTS: Record<string, string> = {
  NEXT_PUBLIC_STELLAR_NETWORK: 'mainnet',
  NEXT_PUBLIC_HORIZON_URL: 'https://horizon.stellar.org',
  NEXT_PUBLIC_USDC_ISSUER: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  NEXT_PUBLIC_APP_NAME: 'Stellar Intel',
};

for (const [key, value] of Object.entries(MCP_ENV_DEFAULTS)) {
  if (!process.env[key] || process.env[key]?.trim() === '') {
    process.env[key] = value;
  }
}

export async function createServer(): Promise<McpServer> {
  // Dynamic imports so the env defaults above are applied before lib/config loads.
  const { registerQuoteTool } = await import('./tools/quote.js');
  const { registerPrepareTool } = await import('./tools/prepare.js');
  const { registerExecuteTool } = await import('./tools/execute.js');
  const { registerProbeCoverageTool } = await import('./tools/probe-coverage.js');
  const { registerAnchorReputationTool } = await import('./tools/anchor-reputation.js');
  const { registerAnchorHealthTool } = await import('./tools/anchor-health.js');
  const { registerLeaderboardTool } = await import('./tools/leaderboard.js');
  const { registerPrompts } = await import('./prompts.js');
  const { registerAnchorHealthResource } = await import('./resources/anchor-health.js');

  const server = new McpServer({
    name: '@stellarintel/mcp',
    version: '0.1.0',
  });
  registerQuoteTool(server);
  registerPrepareTool(server);
  registerExecuteTool(server);
  registerProbeCoverageTool(server);
  registerAnchorReputationTool(server);
  registerAnchorHealthTool(server);
  registerLeaderboardTool(server);
  registerPrompts(server);
  registerAnchorHealthResource(server);
  return server;
}
