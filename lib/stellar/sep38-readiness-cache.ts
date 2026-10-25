import { getAllSep38Readiness, type Sep38Readiness } from './sep38-readiness';

export const SEP38_READINESS_TTL_MS = 10 * 60 * 1000;

export interface Sep38ReadinessSnapshot {
  anchors: Sep38Readiness[];
  generatedAt: string;
}

let cached: { snapshot: Sep38ReadinessSnapshot; expiresAt: number } | null = null;
let inflight: Promise<Sep38ReadinessSnapshot> | null = null;

/**
 * The readiness of every anchor, held in memory for ten minutes. A check makes two
 * network reads per anchor, so a public endpoint must not repeat them per request;
 * concurrent callers share one refresh instead of each starting their own.
 */
export async function getCachedSep38Readiness(
  now: number = Date.now()
): Promise<Sep38ReadinessSnapshot> {
  if (cached && cached.expiresAt > now) return cached.snapshot;
  if (inflight) return inflight;

  inflight = getAllSep38Readiness()
    .then((anchors) => {
      const snapshot = { anchors, generatedAt: new Date().toISOString() };
      cached = { snapshot, expiresAt: now + SEP38_READINESS_TTL_MS };
      return snapshot;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function clearSep38ReadinessCache(): void {
  cached = null;
  inflight = null;
}
