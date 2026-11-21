/**
 * lib/mcp/audit.ts
 *
 * Audit recording for hosted MCP tool calls (AGS020).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { recordAuditEvent } from '@/lib/audit/record';
import { TOOL_SCOPES, AUTH_META_KEY } from '@/lib/mcp/scopes';
import { RATE_LIMITED_META_KEY } from '@/lib/mcp/rate-limit';
import type { ApiScope } from '@/lib/auth/api-keys';

export function applyToolAudit(server: McpServer): void {
  const registerTool = server.registerTool.bind(server) as (
    ...args: unknown[]
  ) => ReturnType<McpServer['registerTool']>;

  const wrapped = (name: string, config: unknown, handler: unknown) => {
    const audited = async (...args: unknown[]) => {
      const extra = args[args.length - 1] as {
        authInfo?: {
          clientId?: string;
          scopes?: string[];
          extra?: {
            kind?: 'anonymous' | 'key' | 'token';
            tier?: string;
            rateLimitKey?: string;
            maxIntentAmount?: string | null;
          };
        };
        requestId?: string | number;
      };

      const authInfo = extra?.authInfo;
      if (!authInfo) {
        // With no extra.authInfo (stdio / in-memory), record nothing. The audit log covers the hosted endpoint.
        return (handler as (...hArgs: unknown[]) => unknown)(...args);
      }

      const callerId = authInfo.clientId ?? 'anonymous';
      const callerKind = authInfo.extra?.kind ?? 'anonymous';
      const toolScope = (TOOL_SCOPES[name] as ApiScope) ?? null;
      const requestId = extra.requestId != null ? String(extra.requestId) : null;
      interface ToolResultShape {
        _meta?: Record<string, unknown>;
        isError?: boolean;
        structuredContent?: {
          unsignedEnvelope?: {
            intentHash?: string;
          };
        };
      }

      interface ToolArgsShape {
        unsignedEnvelope?: {
          intentHash?: string;
        };
      }

      const toolArgs =
        args.length > 1 && typeof args[0] === 'object' && args[0] !== null
          ? (args[0] as ToolArgsShape)
          : undefined;

      let result: ToolResultShape | undefined;
      let errorCaught: unknown = null;

      try {
        result = (await (handler as (...hArgs: unknown[]) => unknown)(...args)) as
          | ToolResultShape
          | undefined;
      } catch (err) {
        errorCaught = err;
      }

      let outcome: 'ok' | 'denied' | 'rate_limited' | 'error' = 'ok';
      if (result?._meta?.[RATE_LIMITED_META_KEY]) {
        outcome = 'rate_limited';
      } else if (result?._meta?.[AUTH_META_KEY]) {
        outcome = 'denied';
      } else if (errorCaught !== null || result?.isError) {
        outcome = 'error';
      } else {
        outcome = 'ok';
      }

      const intentHash =
        result?.structuredContent?.unsignedEnvelope?.intentHash ??
        toolArgs?.unsignedEnvelope?.intentHash ??
        null;

      recordAuditEvent({
        surface: 'mcp',
        action: name,
        scope: toolScope,
        status: null,
        requestId,
        callerId,
        callerKind,
        outcome,
        intentHash,
      });

      if (errorCaught !== null) {
        throw errorCaught;
      }
      return result;
    };

    return registerTool(name, config as never, audited as never);
  };

  server.registerTool = wrapped as unknown as typeof server.registerTool;
}
