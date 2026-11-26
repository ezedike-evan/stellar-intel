import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { recordAuditEvent } from '@/lib/audit/record';
import type { AuditOutcome } from '@/lib/audit/types';
import { RATE_LIMITED_META_KEY } from './rate-limit';
import { AUTH_META_KEY, TOOL_SCOPES } from './scopes';

/**
 * Audit trail for hosted MCP tool calls (AGS020).
 *
 * Every tool call on the hosted endpoint, including refused ones, is recorded
 * the way REST calls are: tool, caller, scope, intent hash and outcome. The
 * arguments and the result content are never passed to the recorder, so no
 * sender, recipient or amount reaches the log. stdio and in-memory calls carry
 * no `authInfo` and are not recorded: the log covers the hosted endpoint.
 */

interface ToolResultLike {
  isError?: boolean;
  _meta?: Record<string, unknown>;
  structuredContent?: { unsignedEnvelope?: { intentHash?: unknown } };
}

type CallerKind = 'anonymous' | 'key' | 'token';

function callerKind(authInfo: AuthInfo): CallerKind {
  const kind = (authInfo.extra as { kind?: unknown } | undefined)?.kind;
  return kind === 'key' || kind === 'token' ? kind : 'anonymous';
}

function outcomeOf(result: ToolResultLike | undefined): AuditOutcome {
  if (result?._meta?.[RATE_LIMITED_META_KEY]) return 'rate_limited';
  if (result?._meta?.[AUTH_META_KEY]) return 'denied';
  if (result?.isError) return 'error';
  return 'ok';
}

function intentHashOf(result: ToolResultLike | undefined, toolArgs: unknown): string | null {
  const fromResult = result?.structuredContent?.unsignedEnvelope?.intentHash;
  if (typeof fromResult === 'string') return fromResult;
  const fromArgs = (toolArgs as { unsignedEnvelope?: { intentHash?: unknown } } | undefined)
    ?.unsignedEnvelope?.intentHash;
  return typeof fromArgs === 'string' ? fromArgs : null;
}

/**
 * Wrap every tool registered on `server` with an audit record.
 *
 * Install it before the rate limiter and the scope check, so it is the
 * outermost wrapper at call time and sees their refusals.
 */
export function applyToolAudit(server: McpServer): void {
  const registerTool = server.registerTool.bind(server) as (
    ...args: unknown[]
  ) => ReturnType<McpServer['registerTool']>;

  const wrapped = (name: string, config: unknown, handler: unknown) => {
    const audited = async (...args: unknown[]) => {
      // (args, extra) for a tool with an input schema, (extra) for one without.
      const extra = args[args.length - 1] as
        { authInfo?: AuthInfo; requestId?: string | number } | undefined;
      const toolArgs = args.length > 1 ? args[0] : undefined;
      const authInfo = extra?.authInfo;

      const record = (outcome: AuditOutcome, result: ToolResultLike | undefined) => {
        if (!authInfo) return;
        recordAuditEvent({
          surface: 'mcp',
          action: name,
          scope: TOOL_SCOPES[name] ?? null,
          status: null,
          requestId: extra?.requestId === undefined ? null : String(extra.requestId),
          callerId: authInfo.clientId,
          callerKind: callerKind(authInfo),
          intentHash: intentHashOf(result, toolArgs),
          outcome,
        });
      };

      let result: ToolResultLike | undefined;
      try {
        result = (await (handler as (...hArgs: unknown[]) => unknown)(...args)) as
          ToolResultLike | undefined;
      } catch (err) {
        record('error', undefined);
        throw err;
      }
      record(outcomeOf(result), result);
      return result;
    };

    return registerTool(name, config as never, audited as never);
  };

  server.registerTool = wrapped as unknown as typeof server.registerTool;
}
