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
  const { registerQuoteTool } = await import('./tools/quote');
  const { registerPrepareTool } = await import('./tools/prepare');
  const { registerExecuteTool } = await import('./tools/execute');
  const { registerProbeCoverageTool } = await import('./tools/probe-coverage');
  const { registerAnchorReputationTool } = await import('./tools/anchor-reputation');
  const { registerAnchorSlaTool } = await import('./tools/anchor-sla');
  const { registerAnchorHealthTool } = await import('./tools/anchor-health');
  const { registerLeaderboardTool } = await import('./tools/leaderboard');
  const { registerCorridorsTool } = await import('./tools/corridors');
  const { registerOnrampQuoteTool } = await import('./tools/onramp-quote');
  const { registerOnrampPrepareTool } = await import('./tools/onramp-prepare');
  const { registerPrompts } = await import('./prompts');
  const { registerAnchorHealthResource } = await import('./resources/anchor-health');
  const { applyToolAudit } = await import('./audit');
  const { applyToolRateLimit } = await import('./rate-limit');
  const { applyToolScopes } = await import('./scopes');

  const server = new McpServer({
    name: '@stellarintel/mcp',
    version: '0.1.0',
  });
  // Before any tool is registered, three wrappers are installed on
  // `registerTool`, so a tool registered afterwards is covered without opting
  // in. Each wraps the one installed before it, so at call time they run in
  // install order: audit (outermost, so it sees refusals, AGS020), then the
  // rate limit (rate-limit.ts), then the scope check (scopes.ts, AGS017).
  applyToolAudit(server);
  applyToolRateLimit(server);
  // After the limiter, so a denied call still counts against the caller's limit.
  applyToolScopes(server);

  registerQuoteTool(server);
  registerPrepareTool(server);
  registerExecuteTool(server);
  registerProbeCoverageTool(server);
  registerAnchorReputationTool(server);
  registerAnchorSlaTool(server);
  registerAnchorHealthTool(server);
  registerLeaderboardTool(server);
  registerCorridorsTool(server);
  registerOnrampQuoteTool(server);
  registerOnrampPrepareTool(server);
  registerPrompts(server);
  registerAnchorHealthResource(server);
  return server;
}
