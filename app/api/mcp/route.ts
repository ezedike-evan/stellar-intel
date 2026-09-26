import { NextRequest, NextResponse } from 'next/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createServer } from '@/scripts/mcp/server';
import { checkRateLimit, getClientIp } from '@/lib/api/rate-limit';
import { getLogger } from '@/lib/logger';

/**
 * app/api/mcp/route.ts
 *
 * The MCP server as a remote endpoint, not a package.
 *
 * Until now the only ways to reach these tools were `npx tsx
 * scripts/mcp/server.ts` over stdio, or installing `@stellarintel/mcp` and
 * running it yourself — both of which require the caller to run our code.
 * `packages/mcp/src/transports/streamable-http.ts` does speak Streamable HTTP,
 * but it boots its own `node:http` server, so it is still something you host.
 *
 * This route puts the same tools on the deployed app, so any MCP client can
 * connect with a URL and nothing installed:
 *
 *   { "mcpServers": { "stellar-intel": { "type": "http",
 *       "url": "https://stellar-intel.vercel.app/api/mcp" } } }
 *
 * Tool definitions are not duplicated here. The route builds its server from
 * the same `createServer()` in `scripts/mcp/server.ts` that the stdio entry
 * point uses, so the two transports always expose an identical surface.
 *
 * That is the stdio dev server's four-tool set, not the eight-tool set in
 * `packages/mcp`. The richer package cannot be imported here: its modules use
 * explicit `./tool.js` specifiers, which Turbopack does not resolve back to
 * `.ts` sources, and `npm run build --workspace=@stellarintel/mcp` currently
 * fails on unrelated pre-existing errors in `lib/oracle/read.ts` and
 * `lib/stellar/anchors.ts`, so there is no dist to import either. Porting the
 * remaining four tools is tracked separately.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MCP_RATE_LIMIT = { bucket: 'api.mcp', maxRequests: 60 } as const;

export async function POST(request: NextRequest): Promise<Response> {
  const logger = getLogger('api.mcp');
  const ip = getClientIp(request.headers);
  const rl = await checkRateLimit(ip, MCP_RATE_LIMIT);
  if (!rl.allowed) {
    logger.warn({ event: 'rate_limit_exceeded', ip, retryAfter: rl.retryAfter });
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Too many requests' },
        id: null,
      },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfter), 'X-RateLimit-Remaining': '0' },
      }
    );
  }

  // A stateless transport refuses to serve a second request — it throws
  // "Stateless transport cannot be reused across requests" once
  // `_hasHandledRequest` is set. Both the transport and the server are
  // therefore built per invocation and closed again below; hoisting either to
  // module scope would work exactly once per warm instance.
  let server: McpServer | undefined;
  try {
    const transport = new WebStandardStreamableHTTPServerTransport({
      // Omitted, not set to undefined: `exactOptionalPropertyTypes` is on, and
      // leaving `sessionIdGenerator` out is what selects stateless mode.
      //
      // Stateless is the right fit for a serverless function. There is no
      // instance affinity between requests, so a session id would name state
      // the next invocation cannot see.
      enableJsonResponse: true,
    });

    server = await createServer();
    await server.connect(transport);

    // With enableJsonResponse the returned Response carries a fully buffered
    // JSON body rather than an open SSE stream, so it is safe to close the
    // server once this resolves.
    const response = await transport.handleRequest(request);
    await server.close();
    server = undefined;
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({
      event: 'mcp_handler_error',
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null },
      { status: 500 }
    );
  } finally {
    if (server) await server.close().catch(() => {});
  }
}

/**
 * GET would open the spec's standalone SSE stream for server-initiated
 * messages. On a serverless function that is a stream nobody closes, held open
 * until the platform's timeout kills it. This server never initiates messages,
 * and the MCP spec allows 405 for exactly that case.
 */
export function GET(): NextResponse {
  return methodNotAllowed();
}

/** Session teardown. There are no sessions to tear down in stateless mode. */
export function DELETE(): NextResponse {
  return methodNotAllowed();
}

function methodNotAllowed(): NextResponse {
  return NextResponse.json(
    {
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed. This endpoint is stateless: send JSON-RPC over POST.',
      },
      id: null,
    },
    { status: 405, headers: { Allow: 'POST' } }
  );
}
