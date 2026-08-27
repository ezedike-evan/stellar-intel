import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from '../server.js';

/**
 * Runs the MCP server over the stdio transport (the default), for local
 * process-spawned integrations. The process stays alive serving stdio
 * requests until the client closes the pipe.
 */
export async function startStdioServer(): Promise<void> {
  const server = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
