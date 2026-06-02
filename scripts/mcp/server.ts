/**
 * Stellar Intel MCP server (issues #135 / #136).
 *
 * Exposes the off-ramp tools over stdio so MCP-capable agents (and the
 * subprocess round-trip test in tests/mcp-e2e.spec.ts, #137) can invoke:
 *   - intel.offramp.quote   — best net-received quote for a corridor
 *   - intel.offramp.prepare — unsigned envelope + unsigned tx for signing
 *
 * Run with:  npx tsx scripts/mcp/server.ts
 *
 * The off-ramp core transitively imports lib/config, which validates the
 * NEXT_PUBLIC_* env vars at module load. An MCP agent invoking this server has
 * no reason to provide Next.js front-end env, so we apply safe mainnet defaults
 * for any that are unset BEFORE importing the tools (which pull in config).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

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
  // Dynamic imports so env defaults above are applied before lib/config loads.
  const { registerQuoteTool } = await import('./tools/quote');
  const { registerPrepareTool } = await import('./tools/prepare');

  const server = new McpServer({
    name: 'stellar-intel',
    version: '1.2.0',
  });
  registerQuoteTool(server);
  registerPrepareTool(server);
  return server;
}

async function main(): Promise<void> {
  const server = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // The process now stays alive serving stdio requests until the client closes.
}

// Only auto-start when invoked directly (not when imported by tests).
const invokedDirectly =
  process.argv[1] !== undefined &&
  /scripts[\\/]mcp[\\/]server\.(ts|js|mjs)$/.test(process.argv[1]);

if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(`MCP server failed to start: ${String(err)}\n`);
    process.exit(1);
  });
}
