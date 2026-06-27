import { SepError, TimeoutError, parseSepErrorBody } from './errors';
import { TERMINAL_STATES } from './sep24';
import { mapToCanonical } from './sep24-status-map';
import type {
  WithdrawStatusValue,
  WithdrawStatus,
  Sep6WithdrawParams,
  Sep6WithdrawResponse,
} from '@/types';

export { TERMINAL_STATES };

// ─── Types ────────────────────────────────────────────────────────────────────

/** Schema for a single field in the SEP-6 interactive form. */
export interface Sep6FieldSchema {
  description: string;
  choices?: string[];
}

/** Fields required by the anchor for a SEP-6 transaction. */
export interface Sep6AssetFields {
  transaction?: Record<string, Sep6FieldSchema>;
}

/** Raw asset entry from the SEP-6 GET /info withdraw object. */
export interface Sep6AssetInfo {
  enabled: boolean;
  fee_fixed?: number;
  fee_percent?: number;
  min_amount?: number;
  max_amount?: number;
  fields?: Sep6AssetFields;
}

/** Normalized, validated SEP-6 withdraw configuration for a single asset. */
export interface Sep6WithdrawConfig {
  enabled: true;
  feeFixed: number;
  feePercent: number;
  min: number;
  max: number;
  fields: Sep6AssetFields;
}

export interface Sep6Transaction {
  id: string;
  status: WithdrawStatusValue;
  normalizedStatus: WithdrawStatus;
  updatedAt: Date;
  amountIn?: string;
  amountOut?: string;
  amountFee?: string;
  stellarTransactionId?: string;
  externalTransactionId?: string;
}

// ─── Typed error ──────────────────────────────────────────────────────────────

/** Thrown when the requested asset is not present or is disabled in the anchor's SEP-6 /info. */
export class Sep6AssetDisabledError extends Error {
  readonly assetCode: string;
  readonly transferServer: string;

  constructor(assetCode: string, transferServer: string) {
    super(`Asset "${assetCode}" is not enabled for SEP-6 withdraw on ${transferServer}`);
    this.name = 'Sep6AssetDisabledError';
    this.assetCode = assetCode;
    this.transferServer = transferServer;
  }
}

// ─── Timeout helper ───────────────────────────────────────────────────────────

const SEP6_INFO_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const KNOWN_STATUSES = new Set<WithdrawStatusValue>([
  'incomplete',
  'pending_user_transfer_start',
  'pending_user_transfer_complete',
  'pending_external',
  'pending_anchor',
  'pending_stellar',
  'pending_trust',
  'pending_user',
  'completed',
  'refunded',
  'error',
  'no_market',
  'too_small',
  'too_large',
  'expired',
]);

function normalizeStatus(raw: unknown): WithdrawStatusValue {
  if (typeof raw === 'string' && KNOWN_STATUSES.has(raw as WithdrawStatusValue)) {
    return raw as WithdrawStatusValue;
  }
  return 'pending_external';
}

// ─── Fetchers ─────────────────────────────────────────────────────────────────

export async function getSep6Info(
  transferServer: string,
  assetCode: string
): Promise<Sep6WithdrawConfig> {
  const raw = await withTimeout(
    (async (): Promise<unknown> => {
      const res = await fetch(`${transferServer}/info`);

      if (!res.ok) {
        const body: unknown =
          typeof res.json === 'function' ? await res.json().catch(() => null) : null;
        throw parseSepErrorBody(body, res.status);
      }

      return res.json();
    })(),
    SEP6_INFO_TIMEOUT_MS,
    `SEP-6 /info ${transferServer}`
  ).catch((err) => {
    if (err instanceof Error && !(err instanceof SepError) && err.message.includes('timed out')) {
      throw new TimeoutError(err.message);
    }
    throw err;
  });

  const data = raw as Record<string, unknown>;
  const withdraw = data['withdraw'] as Record<string, unknown> | undefined;

  if (!withdraw || typeof withdraw[assetCode] !== 'object' || withdraw[assetCode] === null) {
    throw new Sep6AssetDisabledError(assetCode, transferServer);
  }

  const asset = withdraw[assetCode] as Sep6AssetInfo;

  if (asset.enabled === false) {
    throw new Sep6AssetDisabledError(assetCode, transferServer);
  }

  return {
    enabled: true,
    feeFixed: asset.fee_fixed ?? 0,
    feePercent: asset.fee_percent ?? 0,
    min: asset.min_amount ?? 0,
    max: asset.max_amount ?? 0,
    fields: asset.fields ?? {},
  };
}

export async function getSep6Transaction(
  transferServer: string,
  transactionId: string,
  jwt: string,
  signal?: AbortSignal
): Promise<Sep6Transaction> {
  const res = await fetch(`${transferServer}/transaction?id=${transactionId}`, {
    headers: { Authorization: `Bearer ${jwt}` },
    ...(signal ? { signal } : {}),
  });

  if (!res.ok) {
    const body: unknown =
      typeof res.json === 'function' ? await res.json().catch(() => null) : null;
    throw parseSepErrorBody(body, res.status);
  }

  const data = (await res.json()) as { transaction?: Record<string, unknown> };
  const tx = data.transaction ?? {};
  const status = normalizeStatus(tx['status']);

  return {
    id: String(tx['id'] ?? transactionId),
    status,
    normalizedStatus: mapToCanonical(status),
    updatedAt: new Date(),
    ...(tx['amount_in'] !== undefined && { amountIn: tx['amount_in'] as string }),
    ...(tx['amount_out'] !== undefined && { amountOut: tx['amount_out'] as string }),
    ...(tx['amount_fee'] !== undefined && { amountFee: tx['amount_fee'] as string }),
    ...(tx['stellar_transaction_id'] !== undefined && {
      stellarTransactionId: tx['stellar_transaction_id'] as string,
    }),
    ...(tx['external_transaction_id'] !== undefined && {
      externalTransactionId: tx['external_transaction_id'] as string,
    }),
  };
}

export function buildSep6WithdrawRequest(
  transferServer: string,
  params: Sep6WithdrawParams
): string {
  if (!params.asset_code) throw new Error('asset_code is required');
  if (!params.type) throw new Error('type is required');
  if (!params.dest) throw new Error('dest is required');

  const url = new URL(`${transferServer}/withdraw`);
  url.searchParams.set('asset_code', params.asset_code);
  url.searchParams.set('type', params.type);
  url.searchParams.set('dest', params.dest);
  if (params.amount) url.searchParams.set('amount', params.amount);
  if (params.account) url.searchParams.set('account', params.account);

  return url.toString();
}

export type { Sep6WithdrawParams, Sep6WithdrawResponse };
