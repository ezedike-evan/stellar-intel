import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { hasScope, isApiScope, type ApiScope } from '@/lib/auth/api-keys';

/**
 * Per-tool scopes for the MCP surface (AGS017).
 *
 * A key issued only for quotes must not be able to prepare or execute intents.
 * Every tool declares the scope it needs here, and `applyToolScopes` refuses to
 * register a tool that is missing from the map, so a new tool cannot ship
 * unscoped.
 */
export const TOOL_SCOPES: Record<string, ApiScope> = {
  'intel.offramp.prepare': 'intents:write',
  'intel.execute': 'intents:write',
  'intel.onramp.prepare': 'intents:write',
  'intel.offramp.quote': 'quotes:read',
  'intel.anchor.reputation': 'quotes:read',
  'intel.anchor.sla': 'quotes:read',
  'intel.anchor.health': 'quotes:read',
  'intel.probe.coverage': 'quotes:read',
  'intel.leaderboard': 'quotes:read',
  'intel.corridors': 'quotes:read',
  'intel.onramp.quote': 'quotes:read',
};

/** Stable discriminator for a call refused for want of a scope. */
export const INSUFFICIENT_SCOPE_ERROR_CODE = 'INSUFFICIENT_SCOPE';

/** `_meta` key the structured refusal is published under. */
export const AUTH_META_KEY = 'stellarintel/auth';

export interface InsufficientScopeErrorData {
  code: typeof INSUFFICIENT_SCOPE_ERROR_CODE;
  tool: string;
  requiredScope: ApiScope;
}

/**
 * Wrap every tool registered on `server` with its scope check.
 *
 * Like `applyToolRateLimit`, this wraps `registerTool` itself, so no tool can
 * be added without passing through it. With no `authInfo` (stdio, in-memory:
 * a local process run by its owner) every call is allowed. On the hosted
 * endpoint the caller's scopes arrive as `authInfo.scopes`, and a call without
 * the tool's scope is refused before its handler runs.
 */
export function applyToolScopes(server: McpServer): void {
  const registerTool = server.registerTool.bind(server) as (
    ...args: unknown[]
  ) => ReturnType<McpServer['registerTool']>;

  const wrapped = (name: string, config: unknown, handler: unknown) => {
    const required = TOOL_SCOPES[name];
    if (!required) {
      throw new Error(`No scope declared for MCP tool "${name}"`);
    }

    const scoped = async (...args: unknown[]) => {
      // The handler extra is always the last argument: (args, extra) for a tool
      // with an input schema, (extra) for one without.
      const extra = args[args.length - 1] as { authInfo?: AuthInfo } | undefined;
      const authInfo = extra?.authInfo;

      if (authInfo) {
        const granted = (authInfo.scopes ?? []).filter(isApiScope);
        if (!hasScope(granted, required)) {
          const data: InsufficientScopeErrorData = {
            code: INSUFFICIENT_SCOPE_ERROR_CODE,
            tool: name,
            requiredScope: required,
          };
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `${INSUFFICIENT_SCOPE_ERROR_CODE}: tool "${name}" needs the "${required}" scope`,
              },
            ],
            _meta: { [AUTH_META_KEY]: data },
          };
        }
      }

      return (handler as (...hArgs: unknown[]) => unknown)(...args);
    };

    return registerTool(name, config as never, scoped as never);
  };

  server.registerTool = wrapped as unknown as typeof server.registerTool;
}
