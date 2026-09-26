import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { IsomorphicHeaders } from '@modelcontextprotocol/sdk/types.js';
import { checkRateLimit } from '@/lib/api/rate-limit';

/**
 * Per-client rate limiting for the MCP tool surface (#1050).
 *
 * `lib/api/rate-limit.ts` protects the REST surface; the MCP server had no
 * equivalent, so one agent in a loop could exhaust anchor quotas for everyone
 * — the cost of a tool call is not paid by us, it is paid at the anchor.
 *
 * The limiter is the existing one, not a second implementation: same fixed
 * windows, same Postgres-backed shared state (`lib/api/shared-state.ts`), same
 * per-instance fallback when no database is configured. Only the bucket and the
 * client identity are new.
 */

/** Bucket prefix, so MCP traffic is counted separately from `v1.*` REST buckets. */
export const MCP_TOOL_RATE_LIMIT_BUCKET = 'mcp.tools';

/**
 * Stable discriminator for a rejected-because-limited call.
 *
 * A client branches on this rather than string-matching a message. It rides in
 * the tool result's `_meta` (and leads the text body) rather than in a
 * JSON-RPC error: the SDK converts anything thrown inside a tool callback into
 * a result carrying `isError`, so a thrown `McpError` would arrive as an
 * ordinary failed tool call with the code buried in a string. Reporting it as
 * a typed error *result* is what actually reaches the client intact, and it is
 * what the MCP specification asks for — a tool that refused to run is a tool
 * error, not a malformed request.
 */
export const RATE_LIMITED_ERROR_CODE = 'RATE_LIMITED';

/** `_meta` key the structured payload is published under. */
export const RATE_LIMITED_META_KEY = 'stellarintel/rateLimit';

export interface RateLimitedErrorData {
  code: typeof RATE_LIMITED_ERROR_CODE;
  /** The tool that was rejected. */
  tool: string;
  /** Seconds to wait before the window resets. */
  retryAfter: number;
  /** Configured cap for the window. */
  limit: number;
  /** Epoch ms when the current window resets. */
  resetAt: number;
  /**
   * False when the count is per-instance rather than shared — the limit is
   * then advisory. Mirrors `RateLimitResult.shared`; a client that is told it
   * is limited deserves to know whether the number means anything.
   */
  shared: boolean;
}

export interface ToolRateLimitOptions {
  windowMs?: number;
  maxRequests?: number;
}

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 60;

function positiveIntFromEnv(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function headerValue(headers: IsomorphicHeaders | undefined, name: string): string | undefined {
  const value = headers?.[name];
  if (Array.isArray(value)) return value[0]?.trim() || undefined;
  return value?.trim() || undefined;
}

/**
 * Who to count a call against.
 *
 * Streamable HTTP gives every client a session id, which is the right unit:
 * it survives across requests and is not shared between agents. Where there is
 * none, fall back to the forwarded client IP, then to a constant.
 *
 * `stdio` deliberately resolves to one shared key: a stdio server is a
 * subprocess of exactly one client, so "per-client" and "per-process" are the
 * same thing there, and the limit still bounds what that client can spend.
 */
export function resolveClientId(extra: {
  sessionId?: string;
  requestInfo?: { headers?: IsomorphicHeaders };
}): string {
  if (extra.sessionId?.trim()) return `session:${extra.sessionId.trim()}`;

  const headers = extra.requestInfo?.headers;
  const forwarded = headerValue(headers, 'x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || headerValue(headers, 'x-real-ip');
  if (ip) return `ip:${ip}`;

  return 'local';
}

/**
 * Wrap every tool registered on `server` with a per-client limit.
 *
 * Applied to `registerTool` itself rather than to each tool's handler, so a
 * tool added later is covered without anyone remembering to opt in — the
 * property being protected is "no tool call skips the limiter", and a per-file
 * opt-in erodes the first time someone adds a tool in a hurry.
 *
 * The check runs before the handler, so a rejected call never reaches an
 * anchor: that is the point of the issue, not the error message.
 */
export function applyToolRateLimit(server: McpServer, options: ToolRateLimitOptions = {}): void {
  const windowMs =
    options.windowMs ?? positiveIntFromEnv('MCP_RATE_LIMIT_WINDOW_MS') ?? DEFAULT_WINDOW_MS;
  const maxRequests =
    options.maxRequests ?? positiveIntFromEnv('MCP_RATE_LIMIT_MAX') ?? DEFAULT_MAX_REQUESTS;

  const registerTool = server.registerTool.bind(server) as (
    ...args: unknown[]
  ) => ReturnType<McpServer['registerTool']>;

  const wrapped = (name: string, config: unknown, handler: unknown) => {
    const limited = async (...args: unknown[]) => {
      // The handler extra is always the last argument: (args, extra) for a tool
      // with an input schema, (extra) for one without.
      const extra = args[args.length - 1] as {
        sessionId?: string;
        requestInfo?: { headers?: IsomorphicHeaders };
      };

      const result = await checkRateLimit(resolveClientId(extra), {
        bucket: `${MCP_TOOL_RATE_LIMIT_BUCKET}:${name}`,
        windowMs,
        maxRequests,
      });

      if (!result.allowed) {
        const data: RateLimitedErrorData = {
          code: RATE_LIMITED_ERROR_CODE,
          tool: name,
          retryAfter: result.retryAfter,
          limit: result.limit,
          resetAt: result.resetAt,
          shared: result.shared,
        };

        // `CODE: message` is how every other tool in this server reports a
        // typed failure (see tools/quote.ts), so a client that already parses
        // those needs no new special case to recognise this one.
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text:
                `${RATE_LIMITED_ERROR_CODE}: rate limit exceeded for ${name} — ` +
                `${result.limit} calls per ${Math.round(windowMs / 1000)}s. ` +
                `Retry after ${result.retryAfter}s.`,
            },
          ],
          _meta: { [RATE_LIMITED_META_KEY]: data },
        };
      }

      return (handler as (...a: unknown[]) => unknown)(...args);
    };

    return registerTool(name, config, limited);
  };

  server.registerTool = wrapped as unknown as McpServer['registerTool'];
}
