import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from '@/lib/mcp/server';

export { createServer };

async function main(): Promise<void> {
  const server = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // The process now stays alive serving stdio requests until the client closes.
}

// Only auto-start when invoked directly (not when imported by tests).
const invokedDirectly =
  process.argv[1] !== undefined && /scripts[\\/]mcp[\\/]server\.(ts|js|mjs)$/.test(process.argv[1]);

if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(`MCP server failed to start: ${String(err)}\n`);
    process.exit(1);
  });
}
