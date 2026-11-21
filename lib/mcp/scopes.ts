/**
 * lib/mcp/scopes.ts
 *
 * Scope definitions and mappings for MCP tools (AGS017).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { hasScope, type ApiScope } from '@/lib/auth/api-keys';

export const API_SCOPES = ['quotes:read', 'intents:write', 'reputation:write', 'admin'] as const;

export type { ApiScope };

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

export interface ScopeDeniedMeta {
  code: typeof INSUFFICIENT_SCOPE_ERROR_CODE;
  tool: string;
  requiredScope: ApiScope;
}

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
      const extra = args[args.length - 1] as {
        authInfo?: {
          scopes?: string[];
        };
      };

      if (!extra?.authInfo) {
        // With no extra.authInfo (stdio / in-memory), allow the call.
        return (handler as (...hArgs: unknown[]) => unknown)(...args);
      }

      const grantedScopes = (extra.authInfo.scopes ?? []) as ApiScope[];
      if (!hasScope(grantedScopes, required)) {
        const meta: ScopeDeniedMeta = {
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
          _meta: { [AUTH_META_KEY]: meta },
        };
      }

      return (handler as (...hArgs: unknown[]) => unknown)(...args);
    };

    return registerTool(name, config as never, scoped as never);
  };

  server.registerTool = wrapped as unknown as typeof server.registerTool;
}
