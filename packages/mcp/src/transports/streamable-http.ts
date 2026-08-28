import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { createServer } from '../server.js';

export interface StreamableHttpOptions {
  host?: string;
  port?: number;
}

export interface StreamableHttpHandle {
  url: string;
  close: () => Promise<void>;
}

const BAD_REQUEST = JSON.stringify({
  jsonrpc: '2.0',
  error: { code: -32000, message: 'Bad Request' },
  id: null,
});

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) {
    return undefined;
  }
  return JSON.parse(raw);
}

function sendJson(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

/**
 * Runs the MCP server over the Streamable HTTP transport, for hosted agents
 * that reach the server over HTTP instead of a local subprocess.
 *
 * A per-session transport map is maintained (keyed by the server-generated
 * session ID), so multiple agents can connect concurrently and each keeps a
 * stable session across requests, exactly as the MCP Streamable HTTP
 * specification expects.
 */
export async function startStreamableHttpServer(
  options: StreamableHttpOptions = {}
): Promise<StreamableHttpHandle> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 3000;
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createHttpServer(async (req, res) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      // Requests carrying a session ID are routed to their existing session.
      if (sessionId) {
        const transport = sessions.get(sessionId);
        if (!transport) {
          sendJson(res, 400, BAD_REQUEST);
          return;
        }
        await transport.handleRequest(req, res);
        return;
      }

      // Session-less requests must be initialization requests to start one.
      if (req.method === 'POST') {
        const body = await readJsonBody(req);
        const isInitialize = Array.isArray(body)
          ? body.some((message) => isInitializeRequest(message))
          : body !== undefined && isInitializeRequest(body);
        if (isInitialize) {
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid) => {
              sessions.set(sid, transport);
            },
          });
          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid) {
              sessions.delete(sid);
            }
          };
          const server = await createServer();
          await server.connect(transport as Transport);
          await transport.handleRequest(req, res, body);
          return;
        }
      }

      sendJson(res, 400, BAD_REQUEST);
    } catch (err) {
      process.stderr.write(`MCP request failed: ${String(err)}\n`);
      if (!res.headersSent) {
        sendJson(
          res,
          500,
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          })
        );
      } else {
        res.end();
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => resolve());
  });

  const address = httpServer.address();
  const boundPort = typeof address === 'object' && address !== null ? address.port : port;

  return {
    url: `http://${host}:${boundPort}/mcp`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
