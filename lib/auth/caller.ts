import { getClientIp } from '@/lib/api/rate-limit';
import { flags } from '@/lib/flags';

export type ApiScope = 'quotes:read' | 'intents:write';
export type CallerTier = 'anonymous' | 'free' | 'pro' | 'enterprise';
export type CallerKind = 'anonymous' | 'api_key' | 'token';

export interface Caller {
  id: string;
  kind: CallerKind;
  tier: CallerTier;
  scopes: ApiScope[];
  rateLimitKey: string;
}

export interface ApiKeyRecord {
  id: string;
  key: string;
  tier: CallerTier;
  scopes: ApiScope[];
}

export type ResolveCallerResult = { ok: true; caller: Caller } | { ok: false; message: string };

const keyRegistry = new Map<string, ApiKeyRecord>();

export function registerApiKey(record: ApiKeyRecord): void {
  keyRegistry.set(record.key, { ...record, scopes: [...record.scopes] });
}

export function clearApiKeys(): void {
  keyRegistry.clear();
}

function loadEnvKeys(): Map<string, ApiKeyRecord> {
  const raw = process.env.API_KEYS?.trim();
  if (!raw) return new Map();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Map();
    const map = new Map<string, ApiKeyRecord>();
    for (const item of parsed) {
      if (
        item &&
        typeof item === 'object' &&
        typeof (item as ApiKeyRecord).id === 'string' &&
        typeof (item as ApiKeyRecord).key === 'string' &&
        Array.isArray((item as ApiKeyRecord).scopes)
      ) {
        const rec = item as ApiKeyRecord;
        map.set(rec.key, rec);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

export function anonymousScopes(): ApiScope[] {
  return flags.requireKeyForWrites ? ['quotes:read'] : ['quotes:read', 'intents:write'];
}

export function hasScope(scopes: readonly string[], required: ApiScope): boolean {
  return scopes.includes(required);
}

const TIER_MULTIPLIER: Record<CallerTier, number> = {
  anonymous: 1,
  free: 1,
  pro: 5,
  enterprise: 20,
};

export function limitForTier(baseLimit: number, tier: CallerTier): number {
  return Math.max(1, Math.round(baseLimit * TIER_MULTIPLIER[tier]));
}

function extractPresentedKey(headers: Headers): string | null {
  const apiKey = headers.get('x-api-key')?.trim();
  if (apiKey) return apiKey;

  const auth = headers.get('authorization')?.trim();
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice('bearer '.length).trim();
    if (token) return token;
  }

  return null;
}

export async function resolveCaller(headers: Headers): Promise<ResolveCallerResult> {
  const presented = extractPresentedKey(headers);
  if (!presented) {
    const ip = getClientIp(headers);
    return {
      ok: true,
      caller: {
        id: ip,
        kind: 'anonymous',
        tier: 'anonymous',
        scopes: anonymousScopes(),
        rateLimitKey: ip,
      },
    };
  }

  const record = keyRegistry.get(presented) ?? loadEnvKeys().get(presented);
  if (!record) {
    return { ok: false, message: 'Invalid API key' };
  }

  return {
    ok: true,
    caller: {
      id: record.id,
      kind: 'api_key',
      tier: record.tier,
      scopes: [...record.scopes],
      rateLimitKey: `key:${record.id}`,
    },
  };
}
