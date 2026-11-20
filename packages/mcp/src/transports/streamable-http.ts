import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { createServer } from '../server';

export interface StreamableHttpOptions {
  host?: string;
  port?: number;
  /**
   * Browser origins allowed to call the server. Defaults to none: a request
   * that carries an `Origin` header is rejected, because a browser attaches one
   * to every cross-origin call and a local MCP server has no legitimate web
   * page calling it. Non-browser MCP clients send no `Origin` and are unaffected.
   */
  allowedOrigins?: string[];
}

/** Largest request body read before answering 413. */
const MAX_BODY_BYTES = 1_048_576;
/** Most concurrent sessions held; an initialize beyond this gets 503. */
const MAX_SESSIONS = 100;

class PayloadTooLargeError extends Error {
  constructor() {
    super('Request body too large');
    this.name = 'PayloadTooLargeError';
  }
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
  // A declared length over the cap is refused without reading anything.
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new PayloadTooLargeError();
  }

  // A chunked body declares nothing, so the cap is enforced as it is read.
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buf.length;
    if (received > MAX_BODY_BYTES) {
      throw new PayloadTooLargeError();
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) {
    return undefined;
  }
  return JSON.parse(raw);
}

function forbidden(message: string): string {
  return JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null });
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
  const allowedOrigins = options.allowedOrigins ?? [];
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  // Initialize requests being set up but not yet in `sessions`, so concurrent
  // initializes cannot all slip under the cap together.
  let pendingSessions = 0;
  // Known only once the socket is bound (the port may be 0); read per request.
  let boundPort = options.port ?? 3000;
  const allowedHosts = (): string[] => [
    `${host}:${boundPort}`,
    `localhost:${boundPort}`,
    `127.0.0.1:${boundPort}`,
    `[::1]:${boundPort}`,
  ];

  const httpServer = createHttpServer(async (req, res) => {
    try {
      // DNS rebinding: a page on an attacker's domain can be made to resolve to
      // 127.0.0.1, but its requests still carry the attacker's Host and Origin.
      // Checked here, before any body is read or session looked up, and the
      // same lists are handed to the transport below. The SDK only checks Origin
      // when the list is non-empty, so the empty default is enforced here.
      const hostHeader = req.headers.host;
      if (!hostHeader || !allowedHosts().includes(hostHeader)) {
        sendJson(res, 403, forbidden(`Invalid Host header: ${hostHeader ?? ''}`));
        return;
      }
      const originHeader = req.headers.origin;
      if (originHeader !== undefined && !allowedOrigins.includes(originHeader)) {
        sendJson(res, 403, forbidden(`Invalid Origin header: ${originHeader}`));
        return;
      }

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
          if (sessions.size + pendingSessions >= MAX_SESSIONS) {
            sendJson(
              res,
              503,
              JSON.stringify({
                jsonrpc: '2.0',
                error: { code: -32000, message: 'Too many sessions' },
                id: null,
              })
            );
            return;
          }
          pendingSessions += 1;
          try {
            const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => randomUUID(),
              enableDnsRebindingProtection: true,
              allowedHosts: allowedHosts(),
              allowedOrigins,
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
          } finally {
            pendingSessions -= 1;
          }
          return;
        }
      }

      sendJson(res, 400, BAD_REQUEST);
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        res.writeHead(413, { 'Content-Type': 'application/json', Connection: 'close' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Request body too large' },
            id: null,
          })
        );
        return;
      }
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
  boundPort = typeof address === 'object' && address !== null ? address.port : port;

  return {
    url: `http://${host}:${boundPort}/mcp`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
