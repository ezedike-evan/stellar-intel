import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { hasScope, type ApiScope } from '@/lib/auth/caller';

export const TOOL_SCOPES: Record<string, ApiScope> = {
  'intel.offramp.prepare': 'intents:write',
  'intel.execute': 'intents:write',
  'intel.onramp.prepare': 'intents:write',
  'intel.offramp.quote': 'quotes:read',
  'intel.anchor.reputation': 'quotes:read',
  'intel.anchor.health': 'quotes:read',
  'intel.probe.coverage': 'quotes:read',
  'intel.leaderboard': 'quotes:read',
  'intel.corridors': 'quotes:read',
  'intel.onramp.quote': 'quotes:read',
};

export const INSUFFICIENT_SCOPE_ERROR_CODE = 'INSUFFICIENT_SCOPE';
export const AUTH_META_KEY = 'stellarintel/auth';

export interface InsufficientScopeErrorData {
  code: typeof INSUFFICIENT_SCOPE_ERROR_CODE;
  tool: string;
  requiredScope: ApiScope;
}

/**
 * Wrap every tool registered on `server` with a scope check.
 *
 * Every registered tool must appear in `TOOL_SCOPES`; registering an unlisted
 * tool throws immediately so a new tool cannot ship unscoped.
 *
 * When `extra.authInfo` is absent (stdio / in-memory local process run by its
 * owner), the call is allowed. On the hosted HTTP endpoint, `authInfo.scopes`
 * is always populated and checked against the tool's required scope.
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
      const extra = args[args.length - 1] as { authInfo?: AuthInfo } | undefined;
      const authInfo = extra?.authInfo;

      if (authInfo && !hasScope(authInfo.scopes as ApiScope[], required)) {
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

      return (handler as (...hArgs: unknown[]) => unknown)(...args);
    };

    return registerTool(name, config as never, scoped as never);
  };

  server.registerTool = wrapped as unknown as typeof server.registerTool;
}
