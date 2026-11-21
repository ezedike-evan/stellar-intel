/**
 * lib/mcp/scopes.ts
 *
 * Scope definitions and mappings for MCP tools.
 */

export const API_SCOPES = ['quotes:read', 'intents:write', 'reputation:write', 'admin'] as const;

export type ApiScope = (typeof API_SCOPES)[number];

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
