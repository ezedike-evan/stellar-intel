import { z } from 'zod';
import { TimeoutError, parseSepErrorBody } from './errors';
import { fetchWithTimeout } from './http';
import type { Sep31Info } from '@/types';

const DEFAULT_TIMEOUT_MS = 8_000;

// ─── Schema ─────────────────────────────────────────────────────────────────
//
// Validated at the network boundary, mirroring lib/stellar/sep6-schemas.ts.
// Unknown keys (both per-asset and top-level) are passed through rather than
// stripped, since anchors are free to advertise extra SEP-31 /info fields we
// don't record yet.

const Sep31ReceiveAssetSchema = z
  .object({
    enabled: z.boolean().optional(),
    quotes_supported: z.boolean().optional(),
    quotes_required: z.boolean().optional(),
    min_amount: z.number().optional(),
    max_amount: z.number().optional(),
    fee_fixed: z.number().optional(),
    fee_percent: z.number().optional(),
  })
  .passthrough();

const Sep31InfoSchema = z
  .object({
    receive: z.record(z.string(), Sep31ReceiveAssetSchema).optional().default({}),
  })
  .passthrough();

// ─── Fetcher ────────────────────────────────────────────────────────────────

function normalizeDirectPaymentServer(directPaymentServer: string): string {
  const trimmed = directPaymentServer.trim();
  if (!trimmed) {
    throw new Error('directPaymentServer URL is required');
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Invalid directPaymentServer URL: ${trimmed}`);
  }

  if (url.protocol !== 'https:') {
    throw new Error(`SEP-31 directPaymentServer must use https:// (got "${trimmed}")`);
  }

  return trimmed.replace(/\/$/, '');
}

/**
 * Fetches and validates an anchor's SEP-31 `GET /info`. Record-only: no send,
 * customer, or transaction endpoints are requested or parsed.
 *
 * Rejects non-`https://` servers before making a request. Throws a
 * {@link SepError} (via {@link parseSepErrorBody}) on a non-2xx response, and a
 * {@link TimeoutError} if the request exceeds `opts.timeoutMs` (default 8s).
 */
export async function getSep31Info(
  directPaymentServer: string,
  opts?: { timeoutMs?: number }
): Promise<Sep31Info> {
  const base = normalizeDirectPaymentServer(directPaymentServer);
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let res: Response;
  try {
    res = await fetchWithTimeout(`${base}/info`, timeoutMs);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new TimeoutError(`SEP-31 /info request to ${base} timed out after ${timeoutMs}ms`);
    }
    throw err;
  }

  if (!res.ok) {
    const body: unknown =
      typeof res.json === 'function' ? await res.json().catch(() => null) : null;
    throw parseSepErrorBody(body, res.status);
  }

  const raw: unknown = await res.json();
  return Sep31InfoSchema.parse(raw) as Sep31Info;
}

/** Receive asset codes advertised as enabled (i.e. `enabled !== false`). */
export function sep31ReceiveAssets(info: Sep31Info): string[] {
  return Object.entries(info.receive)
    .filter(([, asset]) => asset.enabled !== false)
    .map(([code]) => code);
}
