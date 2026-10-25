import { SepError, parseSepErrorBody } from './errors';
import { getTransferServer } from './sep1';
import { getAnchorsByCorridorId, getCorridorById } from './anchors';
import { fetchWithTimeout } from './http';
import { computeTotalReceived } from '@/lib/utils';
import { AMOUNT_PATTERN } from '@/lib/patterns';
import { normalizeStatus } from './sep24-status-map';
import type {
  Sep24FeeParams,
  AnchorRate,
  RateComparison,
  Sep24WithdrawRequest,
  Sep24WithdrawResponse,
  Sep24DepositRequest,
  Sep24DepositResponse,
  DepositFlowParams,
  DepositFlowSession,
  Sep24Transaction,
  WithdrawStatusValue,
  ResolvedAnchor,
} from '@/types';

// ─── Transaction polling ──────────────────────────────────────────────────────

export const TERMINAL_STATES: ReadonlySet<WithdrawStatusValue> = new Set([
  'completed',
  'error',
  'refunded',
  'expired',
  'no_market',
  'too_small',
  'too_large',
]);

const RETRYABLE_STATUS_CODES = new Set([500, 502, 503, 504]);
const GET_SEP24_TRANSACTION_MAX_ATTEMPTS = 3;
const GET_SEP24_TRANSACTION_RETRY_BASE_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSep24TransactionOnce(
  transferServer: string,
  transactionId: string,
  jwt: string,
  signal?: AbortSignal
): Promise<Sep24Transaction> {
  const res = await fetch(`${transferServer}/transaction?id=${encodeURIComponent(transactionId)}`, {
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

  return {
    id: String(tx['id'] ?? transactionId),
    status: normalizeStatus(tx['status']),
    updatedAt: new Date(),
    ...(tx['amount_in'] !== undefined && { amountIn: tx['amount_in'] as string }),
    ...(tx['amount_in_asset'] !== undefined && { amountInAsset: tx['amount_in_asset'] as string }),
    ...(tx['amount_out'] !== undefined && { amountOut: tx['amount_out'] as string }),
    ...(tx['amount_out_asset'] !== undefined && {
      amountOutAsset: tx['amount_out_asset'] as string,
    }),
    ...((tx['amount_fee'] !== undefined ||
      (tx['fee_details'] as { total?: string })?.total !== undefined) && {
      amountFee: (tx['amount_fee'] ?? (tx['fee_details'] as { total?: string })?.total) as string,
    }),
    ...((tx['stellar_transaction_id'] ?? tx['stellarTransactionId']) !== undefined && {
      stellarTransactionId: (tx['stellar_transaction_id'] ?? tx['stellarTransactionId']) as string,
    }),
    ...((tx['external_transaction_id'] ?? tx['externalTransactionId']) !== undefined && {
      externalTransactionId: (tx['external_transaction_id'] ??
        tx['externalTransactionId']) as string,
    }),
    ...(tx['refunds'] !== undefined && {
      refunds: tx['refunds'] as Sep24Transaction['refunds'],
    }),
    ...(parseInstructions(tx['instructions']) !== undefined && {
      instructions: parseInstructions(tx['instructions']),
    }),
    ...(parseHttpsUrl(tx['more_info_url']) !== undefined && {
      moreInfoUrl: parseHttpsUrl(tx['more_info_url']),
    }),
    ...(typeof tx['message'] === 'string' && { message: tx['message'] }),
    ...(typeof tx['claimable_balance_id'] === 'string' && {
      claimableBalanceId: tx['claimable_balance_id'],
    }),
    ...(typeof tx['from'] === 'string' && { from: tx['from'] }),
    ...(typeof tx['to'] === 'string' && { to: tx['to'] }),
    ...((tx['kind'] === 'deposit' || tx['kind'] === 'withdrawal') && { kind: tx['kind'] }),
  };
}

/**
 * The deposit `instructions` map, keeping only entries whose `value` is a string
 * (an anchor sends arbitrary JSON; a non-string value cannot be shown to a user as
 * a payment instruction). A missing `description` becomes `''`. `undefined` when
 * nothing usable is left, so the field is simply absent.
 */
function parseInstructions(raw: unknown): Sep24Transaction['instructions'] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;

  const parsed: Record<string, { value: string; description: string }> = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { value, description } = entry as { value?: unknown; description?: unknown };
    if (typeof value !== 'string') continue;
    parsed[key] = { value, description: typeof description === 'string' ? description : '' };
  }
  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

/**
 * `more_info_url`, kept only when it is a parseable https URL. It is rendered as a
 * link, so a `javascript:` or `data:` URL from a hostile anchor must never get
 * through.
 */
function parseHttpsUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  try {
    return new URL(raw).protocol === 'https:' ? raw : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Fetches the current status of a single SEP-24 transaction.
 * Unknown anchor status strings are normalized to "pending_external" rather than throwing.
 * Transient 5xx failures are retried before surface-level failure.
 */
export async function getSep24Transaction(
  transferServer: string,
  transactionId: string,
  jwt: string,
  signal?: AbortSignal
): Promise<Sep24Transaction> {
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      return await fetchSep24TransactionOnce(transferServer, transactionId, jwt, signal);
    } catch (error) {
      if (
        attempt < GET_SEP24_TRANSACTION_MAX_ATTEMPTS &&
        error instanceof SepError &&
        RETRYABLE_STATUS_CODES.has(error.httpStatus)
      ) {
        const delayMs = Math.min(GET_SEP24_TRANSACTION_RETRY_BASE_MS * 2 ** (attempt - 1), 2000);
        await sleep(delayMs);
        continue;
      }
      throw error;
    }
  }
}

// ─── Typed errors ─────────────────────────────────────────────────────────────

export class Sep24WithdrawError extends Error {
  readonly status: number;
  readonly anchorBody: unknown;

  constructor(status: number, anchorBody: unknown, transferServer: string) {
    super(`Withdraw initiation failed: HTTP ${status} from ${transferServer}`);
    this.name = 'Sep24WithdrawError';
    this.status = status;
    this.anchorBody = anchorBody;
  }
}

export class Sep24DepositError extends Error {
  readonly status: number;
  readonly anchorBody: unknown;

  constructor(status: number, anchorBody: unknown, transferServer: string) {
    super(`Deposit initiation failed: HTTP ${status} from ${transferServer}`);
    this.name = 'Sep24DepositError';
    this.status = status;
    this.anchorBody = anchorBody;
  }
}

export class AnchorRateError extends Error {
  readonly anchorId: string;

  constructor(anchorId: string, message: string) {
    super(message);
    this.name = 'AnchorRateError';
    this.anchorId = anchorId;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseRate(raw: unknown): number {
  if (raw === undefined || raw === null) return 0;
  const num = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(num) ? num : 0;
}

/**
 * Resolves the correct asset query parameters (old vs SEP-38 format)
 * based on the anchor's /info response.
 */
export function resolveAssetParams(
  info: Sep24InfoResponse | null,
  operation: 'deposit' | 'withdraw',
  assetCode: string,
  assetIssuer?: string
): Record<string, string> {
  const fullAsset =
    assetCode === 'XLM' && !assetIssuer ? 'stellar:native' : `stellar:${assetCode}:${assetIssuer}`;
  if (info && info[operation] && info[operation][fullAsset]) {
    return { asset: fullAsset };
  }
  const params: Record<string, string> = { asset_code: assetCode };
  if (assetIssuer) params.asset_issuer = assetIssuer;
  return params;
}

/**
 * Looks up one asset's entry in a SEP-24 /info operation map (ONR007).
 *
 * Anchors key these maps either by SEP-38 identifier (`stellar:CODE:ISSUER`)
 * or by bare code (`USDC`), and native XLM additionally appears as
 * `stellar:native` or `native`. This is the one place that tries the variants
 * in order, so callers stop re-implementing the lookup inconsistently.
 */
export function findSep24AssetInfo(
  info: Sep24InfoResponse | null,
  operation: 'deposit' | 'withdraw',
  assetCode: string,
  assetIssuer?: string
): Sep24AssetInfo | null {
  const map = info?.[operation];
  if (!map) return null;

  const candidates =
    assetCode === 'XLM' && !assetIssuer
      ? ['stellar:native', 'native']
      : assetIssuer
        ? [`stellar:${assetCode}:${assetIssuer}`, assetCode]
        : [assetCode];

  for (const key of candidates) {
    const entry = map[key];
    if (entry) return entry;
  }
  return null;
}

/** One enabled asset parsed out of a SEP-24 /info operation map. */
export interface Sep24EnabledAsset {
  /** The raw /info key, exactly as the anchor published it. */
  key: string;
  code: string;
  /** Issuer parsed from an identifier-style key; null for native XLM or a bare code key. */
  issuer: string | null;
  info: Sep24AssetInfo;
}

/**
 * Lists the assets an anchor enables for `operation` in its SEP-24 /info
 * (ONR007). Entries whose `enabled` is not exactly `true` are left out, and
 * identifier-style keys are parsed into code and issuer so callers can build
 * requests for any supported asset, not only the registry's primary one.
 */
export function listEnabledAssets(
  info: Sep24InfoResponse | null,
  operation: 'deposit' | 'withdraw'
): Sep24EnabledAsset[] {
  const map = info?.[operation];
  if (!map) return [];

  const assets: Sep24EnabledAsset[] = [];
  for (const [key, entry] of Object.entries(map)) {
    if (entry?.enabled !== true) continue;
    if (key === 'native' || key === 'stellar:native') {
      assets.push({ key, code: 'XLM', issuer: null, info: entry });
      continue;
    }
    const identifier = /^stellar:([^:]+):([^:]+)$/.exec(key);
    const code = identifier?.[1];
    const issuer = identifier?.[2];
    if (code && issuer) {
      assets.push({ key, code, issuer, info: entry });
    } else {
      assets.push({ key, code: key, issuer: null, info: entry });
    }
  }
  return assets;
}

// ─── GET /fee (low-level, takes transferServer directly) ─────────────────────

export type Sep24FeeResult = { ok: true; fee: number } | { ok: false; reason: 'unsupported' };

/**
 * Fetches the anchor's fee quote directly from a known transfer server.
 * Uses a 5-second timeout with one automatic retry on network/timeout failure.
 * Returns { ok: false, reason: 'unsupported' } for 404s without throwing.
 */
export async function getSep24Fee(params: {
  transferServer: string;
  assetCode: string;
  assetIssuer: string;
  amount: string;
  type: string;
}): Promise<Sep24FeeResult> {
  const url = new URL(`${params.transferServer}/fee`);
  url.searchParams.set('operation', 'withdraw');

  const info = await getSep24Info(params.transferServer).catch(() => null);
  const assetParams = resolveAssetParams(info, 'withdraw', params.assetCode, params.assetIssuer);
  for (const [k, v] of Object.entries(assetParams)) {
    url.searchParams.set(k, v);
  }

  url.searchParams.set('amount', params.amount);
  url.searchParams.set('type', params.type);
  const urlStr = url.toString();

  let res: Response;
  try {
    res = await fetchWithTimeout(urlStr, 5_000);
  } catch {
    res = await fetchWithTimeout(urlStr, 5_000);
  }

  if (res.status === 404) return { ok: false, reason: 'unsupported' };
  if (!res.ok) {
    const body: unknown =
      typeof res.json === 'function' ? await res.json().catch(() => null) : null;
    throw parseSepErrorBody(body, res.status);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const fee = Number(data['fee']);
  return Number.isFinite(fee) ? { ok: true, fee } : { ok: false, reason: 'unsupported' };
}

// ─── GET /info (with 5-minute in-memory cache) ────────────────────────────────

export interface Sep24AssetInfo {
  enabled: boolean;
  min_amount?: number;
  max_amount?: number;
  fee_fixed?: number;
  fee_percent?: number;
  authentication_required?: boolean;
}

export interface Sep24InfoResponse {
  deposit: Record<string, Sep24AssetInfo>;
  withdraw: Record<string, Sep24AssetInfo>;
  fee: { enabled: boolean; authentication_required?: boolean };
  transaction: { enabled: boolean; authentication_required?: boolean };
  transactions: { enabled: boolean; authentication_required?: boolean };
}

const INFO_CACHE = new Map<string, { data: Sep24InfoResponse; expiresAt: number }>();
const INFO_CACHE_TTL_MS = 5 * 60 * 1_000;

export function _clearInfoCache(): void {
  INFO_CACHE.clear();
}

/**
 * Fetches and parses the anchor's SEP-24 /info response.
 * Results are cached per transfer server for 5 minutes.
 */
export async function getSep24Info(transferServer: string): Promise<Sep24InfoResponse> {
  const cached = INFO_CACHE.get(transferServer);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  if (
    typeof process !== 'undefined' &&
    process.env.NODE_ENV === 'test' &&
    !process.env.TEST_SEP24_INFO
  ) {
    return {
      deposit: {},
      withdraw: {},
      fee: { enabled: true },
      transaction: { enabled: true },
      transactions: { enabled: true },
    } as Sep24InfoResponse;
  }

  const res = await fetch(`${transferServer}/info`);
  if (!res.ok) {
    const body: unknown =
      typeof res.json === 'function' ? await res.json().catch(() => null) : null;
    throw new SepError(
      `Failed to fetch /info from ${transferServer}: HTTP ${res.status}`,
      `INFO_FETCH_FAILED`,
      res.status,
      body
    );
  }

  const data = (await res.json()) as Sep24InfoResponse;
  INFO_CACHE.set(transferServer, { data, expiresAt: Date.now() + INFO_CACHE_TTL_MS });
  return data;
}

// ─── Fee fetching ─────────────────────────────────────────────────────────────

/**
 * Fetches the withdrawal fee from a single anchor's SEP-24 /fee endpoint.
 * Throws on HTTP errors, missing fee field, or request timeout (10s).
 */
export async function fetchAnchorFee(
  params: Sep24FeeParams
): Promise<{ fee: string; anchorDomain: string; exchangeRate: number }> {
  const transferServer = await getTransferServer(params.anchorDomain);
  if (!transferServer) {
    throw new Error(`Anchor "${params.anchorDomain}" does not support SEP-24.`);
  }

  const url = new URL(`${transferServer}/fee`);
  url.searchParams.set('operation', params.operation);

  const info = await getSep24Info(transferServer).catch(() => null);
  const assetParams = resolveAssetParams(
    info,
    params.operation,
    params.assetCode,
    params.assetIssuer
  );
  for (const [k, v] of Object.entries(assetParams)) {
    url.searchParams.set(k, v);
  }

  url.searchParams.set('amount', params.amount);
  url.searchParams.set('type', params.type);

  let res: Response;
  try {
    res = await fetchWithTimeout(url.toString(), 10_000);
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`Request to ${params.anchorDomain} timed out after 10 seconds`);
    }
    throw err;
  }

  if (!res.ok) {
    const body: unknown =
      typeof res.json === 'function' ? await res.json().catch(() => null) : null;
    throw new SepError(
      `HTTP ${res.status} from ${params.anchorDomain} fee endpoint`,
      `FEE_FETCH_FAILED`,
      res.status,
      body
    );
  }

  const data = (await res.json()) as Record<string, unknown>;

  const fee = data['fee'];
  if (fee === undefined || fee === null || isNaN(Number(fee))) {
    throw new Error(
      `Invalid fee response from ${params.anchorDomain}: missing or non-numeric "fee" field`
    );
  }

  const rateRaw = data['price'] ?? data['exchange_rate'] ?? data['rate'];
  const exchangeRate = parseRate(rateRaw);

  return { fee: String(fee), anchorDomain: params.anchorDomain, exchangeRate };
}

function getCorridorAsset(corridorId: string) {
  const corridor = getCorridorById(corridorId);
  return { code: corridor.from, issuer: corridor.fromIssuer };
}

/**
 * Fetches fees from all anchors serving the given corridor in parallel.
 * Uses Promise.allSettled so a single anchor failure does not block others.
 */
export async function fetchAllAnchorFees(
  amount: string,
  corridorId: string
): Promise<PromiseSettledResult<AnchorRate>[]> {
  const anchors = getAnchorsByCorridorId(corridorId);
  const corridor = getCorridorById(corridorId);
  const asset = getCorridorAsset(corridorId);

  return Promise.allSettled(
    anchors.map(async (anchor): Promise<AnchorRate> => {
      const { fee, exchangeRate } = await fetchAnchorFee({
        anchorDomain: anchor.homeDomain,
        operation: 'withdraw',
        assetCode: asset.code,
        assetIssuer: asset.issuer ?? '',
        amount,
        type: 'bank_account',
      });

      const feeNum = Number(fee);
      const amountNum = Number(amount);

      if (exchangeRate <= 0) {
        throw new AnchorRateError(
          anchor.id,
          `${anchor.name} returned a zero or missing exchange rate for ${corridor.to} — rate cannot be derived`
        );
      }

      return {
        anchorId: anchor.id,
        anchorName: anchor.name,
        corridorId,
        fee: feeNum,
        feeType: 'flat',
        exchangeRate,
        totalReceived: computeTotalReceived(amountNum, feeNum, 0, exchangeRate),
        source: 'sep24-fee' as const,
        updatedAt: new Date(),
      };
    })
  );
}

/**
 * Per-corridor solicitation deadline. Anchors that have not responded within
 * this window are dropped from the comparison rather than blocking it.
 */
export const SOLICITOR_DEADLINE_MS = 2_000;

/**
 * Thrown when an anchor's quote solicitation exceeds the configured deadline.
 */
export class DeadlineExceededError extends Error {
  readonly anchorId: string;
  readonly deadlineMs: number;

  constructor(anchorId: string, deadlineMs: number) {
    super(`Anchor "${anchorId}" did not respond within ${deadlineMs}ms deadline`);
    this.name = 'DeadlineExceededError';
    this.anchorId = anchorId;
    this.deadlineMs = deadlineMs;
  }
}

/**
 * Fans out SEP-24 fee quote requests to all anchors for a corridor concurrently,
 * enforcing a hard deadline so that slow anchors cannot block fast ones.
 *
 * Concurrency model:
 *  - All anchor fetches are launched simultaneously via Promise.allSettled.
 *  - Each individual fetch races against a per-anchor deadline timer.
 *  - Anchors that exceed the deadline contribute a rejected PromiseSettledResult
 *    (reason: DeadlineExceededError) without preventing other anchors' results.
 *  - No unhandled promise rejections: Promise.allSettled absorbs every outcome.
 *
 * @param amount     Sell amount (string, passed through to the fee endpoint).
 * @param corridorId Corridor identifier (e.g. 'usdc-ngn').
 * @param deadlineMs Maximum milliseconds to wait per anchor (default: SOLICITOR_DEADLINE_MS).
 * @returns          Settled results — fulfilled = valid quote, rejected = failure or timeout.
 */
export async function solicitAnchorQuotes(
  amount: string,
  corridorId: string,
  deadlineMs: number = SOLICITOR_DEADLINE_MS
): Promise<PromiseSettledResult<AnchorRate>[]> {
  const anchors = getAnchorsByCorridorId(corridorId);
  const corridor = getCorridorById(corridorId);
  const asset = getCorridorAsset(corridorId);

  // Fan out: one Promise per anchor, each racing against its own deadline.
  const racedPromises = anchors.map((anchor): Promise<AnchorRate> => {
    const fetchPromise = (async (): Promise<AnchorRate> => {
      const { fee, exchangeRate } = await fetchAnchorFee({
        anchorDomain: anchor.homeDomain,
        operation: 'withdraw',
        assetCode: asset.code,
        assetIssuer: asset.issuer ?? '',
        amount,
        type: 'bank_account',
      });

      const feeNum = Number(fee);
      const amountNum = Number(amount);

      if (exchangeRate <= 0) {
        throw new AnchorRateError(
          anchor.id,
          `${anchor.name} returned a zero or missing exchange rate for ${corridor.to} — rate cannot be derived`
        );
      }

      return {
        anchorId: anchor.id,
        anchorName: anchor.name,
        corridorId,
        fee: feeNum,
        feeType: 'flat',
        exchangeRate,
        totalReceived: computeTotalReceived(amountNum, feeNum, 0, exchangeRate),
        source: 'sep24-fee' as const,
        updatedAt: new Date(),
      };
    })();

    const deadlinePromise = new Promise<AnchorRate>((_, reject) =>
      setTimeout(() => reject(new DeadlineExceededError(anchor.id, deadlineMs)), deadlineMs)
    );

    // Promise.race: whichever settles first wins for this anchor slot.
    return Promise.race([fetchPromise, deadlinePromise]);
  });

  // Collect all outcomes — fulfilled or rejected — without throwing.
  return Promise.allSettled(racedPromises);
}

/**
 * Builds a RateComparison from an array of settled AnchorRate results.
 * Filters out failed fetches and determines the best rate by highest totalReceived.
 */
export function computeRateComparison(
  results: PromiseSettledResult<AnchorRate>[],
  corridorId: string
): RateComparison {
  const rates = results
    .filter((r): r is PromiseFulfilledResult<AnchorRate> => r.status === 'fulfilled')
    .map((r) => r.value);

  if (rates.length === 0) {
    return { corridorId, rates: [], pending: [], bestRateId: '' };
  }

  const best = rates.reduce((a, b) => {
    const at = a.totalReceived ?? 0;
    const bt = b.totalReceived ?? 0;
    if (bt > at) return b;
    if (bt < at) return a;
    // Break ties deterministically so input order never changes the winner.
    return b.anchorId < a.anchorId ? b : a;
  });

  return { corridorId, rates, pending: [], bestRateId: best.anchorId };
}

// ─── Withdraw interactive flow ────────────────────────────────────────────────

/**
 * POSTs to the anchor's SEP-24 withdraw interactive endpoint.
 * Returns the popup URL and transaction ID issued by the anchor.
 */
export async function initiateWithdraw(
  anchor: ResolvedAnchor,
  params: Sep24WithdrawRequest,
  signal?: AbortSignal
): Promise<Sep24WithdrawResponse> {
  const { jwt, assetCode, assetIssuer, amount, account, quoteId } = params;
  const transferServer = anchor.TRANSFER_SERVER_SEP0024;

  if (!transferServer || !anchor.capabilities.sep24) {
    throw new Error(`Anchor "${anchor.homeDomain}" does not support SEP-24 withdrawals.`);
  }

  const info = await getSep24Info(transferServer).catch(() => null);
  const assetParams = resolveAssetParams(info, 'withdraw', assetCode, assetIssuer);

  const res = await fetch(`${transferServer}/transactions/withdraw/interactive`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      ...assetParams,
      amount,
      account,
      lang: 'en',
      // Threads the SEP-38 firm quote id so the anchor honors the locked-in
      // price instead of re-quoting at settlement. Omitted when no firm
      // quote was available (e.g. the anchor doesn't advertise SEP-38).
      ...(quoteId ? { quote_id: quoteId } : {}),
    }),
    ...(signal ? { signal } : {}),
  });

  if (!res.ok) {
    const body: unknown =
      typeof res.json === 'function' ? await res.json().catch(() => null) : null;
    throw new Sep24WithdrawError(res.status, body, transferServer);
  }

  const data = (await res.json()) as Record<string, unknown>;

  if (data['type'] !== 'interactive_customer_info_needed') {
    throw new Error(
      `Unexpected response type from anchor: "${data['type']}". ` +
        `Expected "interactive_customer_info_needed".`
    );
  }

  if (!data['url'] || typeof data['url'] !== 'string') {
    throw new Error('Anchor withdraw response is missing the "url" field');
  }

  if (!data['id'] || typeof data['id'] !== 'string') {
    throw new Error('Anchor withdraw response is missing the "id" field');
  }

  return {
    type: 'interactive_customer_info_needed',
    url: data['url'] as string,
    id: data['id'] as string,
  };
}

// ─── Deposit interactive flow ─────────────────────────────────────────────────

/**
 * POSTs to the anchor's SEP-24 deposit interactive endpoint.
 * Returns the popup URL and transaction ID issued by the anchor. Mirrors
 * `initiateWithdraw` for the opposite direction (fiat/on-chain in, asset out).
 */
export async function initiateDeposit(
  anchor: ResolvedAnchor,
  params: Sep24DepositRequest,
  signal?: AbortSignal
): Promise<Sep24DepositResponse> {
  const { jwt, assetCode, assetIssuer, amount, account, lang } = params;
  const transferServer = anchor.TRANSFER_SERVER_SEP0024;

  if (!transferServer || !anchor.capabilities.sep24) {
    throw new Error(`Anchor "${anchor.homeDomain}" does not support SEP-24 deposits.`);
  }

  const info = await getSep24Info(transferServer).catch(() => null);
  const assetParams = resolveAssetParams(info, 'deposit', assetCode, assetIssuer);

  const res = await fetch(`${transferServer}/transactions/deposit/interactive`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      ...assetParams,
      amount,
      account,
      lang: lang ?? 'en',
      // A first-deposit wallet has no trustline yet. Saying it can take a
      // claimable balance lets the anchor pay out that way instead of leaving the
      // deposit stuck in pending_trust. SEP-24 request params are strings.
      claimable_balance_supported: 'true',
    }),
    ...(signal ? { signal } : {}),
  });

  if (!res.ok) {
    const body: unknown =
      typeof res.json === 'function' ? await res.json().catch(() => null) : null;
    throw new Sep24DepositError(res.status, body, transferServer);
  }

  const data = (await res.json()) as Record<string, unknown>;

  if (data['type'] !== 'interactive_customer_info_needed') {
    throw new Error(
      `Unexpected response type from anchor: "${data['type']}". ` +
        `Expected "interactive_customer_info_needed".`
    );
  }

  if (!data['url'] || typeof data['url'] !== 'string') {
    throw new Error('Anchor deposit response is missing the "url" field');
  }

  if (!data['id'] || typeof data['id'] !== 'string') {
    throw new Error('Anchor deposit response is missing the "id" field');
  }

  return {
    type: 'interactive_customer_info_needed',
    url: data['url'] as string,
    id: data['id'] as string,
  };
}

/**
 * Starts an interactive SEP-24 deposit and returns what the caller needs to send
 * the user to the anchor.
 *
 * The preconditions are checked before anything is fetched: the anchor must
 * support SEP-24 and the amount must be a positive decimal. It then calls
 * {@link initiateDeposit} (which sends the language, default `en`) and, when a
 * `callbackUrl` is given, adds it to the anchor's URL as `callback` without
 * dropping the query parameters the anchor already put there. With no callback
 * the anchor's URL is returned exactly as issued.
 */
export async function startDepositFlow(
  anchor: ResolvedAnchor,
  params: DepositFlowParams,
  signal?: AbortSignal
): Promise<DepositFlowSession> {
  const transferServer = anchor.TRANSFER_SERVER_SEP0024;
  if (!transferServer || !anchor.capabilities.sep24) {
    throw new Error(`Anchor "${anchor.homeDomain}" does not support SEP-24 deposits.`);
  }
  if (!AMOUNT_PATTERN.test(params.amount) || Number(params.amount) <= 0) {
    throw new Error('Deposit amount must be a positive decimal string.');
  }

  const { callbackUrl, ...request } = params;
  const issued = await initiateDeposit(anchor, request, signal);

  let depositUrl = issued.url;
  if (callbackUrl) {
    const url = new URL(issued.url);
    url.searchParams.set('callback', callbackUrl);
    depositUrl = url.toString();
  }

  return { transactionId: issued.id, depositUrl, transferServer };
}

/** The fields of a SEP-24 `/transaction` record the withdraw flow reads. */
export interface WithdrawTransactionRecord {
  withdrawAnchorAccount: string;
  memo: string;
  memoType: string;
  /** The anchor's own `amount_in`, `amount_out`, `amount_out_asset` and fee, when it reports them. */
  amountIn?: string;
  amountOut?: string;
  amountOutAsset?: string;
  amountFee?: string;
}

/**
 * Fetches the anchor's transaction record after the popup completes.
 * Returns the anchor account, memo, and memo type needed to build the Stellar payment.
 */
export async function getWithdrawTransactionRecord(
  transferServer: string,
  transactionId: string,
  jwt: string,
  signal?: AbortSignal
): Promise<WithdrawTransactionRecord> {
  const res = await fetch(`${transferServer}/transaction?id=${encodeURIComponent(transactionId)}`, {
    headers: { Authorization: `Bearer ${jwt}` },
    ...(signal ? { signal } : {}),
  });

  if (!res.ok) {
    const body: unknown =
      typeof res.json === 'function' ? await res.json().catch(() => null) : null;
    throw new SepError(
      `Failed to fetch transaction record: HTTP ${res.status}`,
      `TRANSACTION_RECORD_FAILED`,
      res.status,
      body
    );
  }

  const data = (await res.json()) as { transaction?: Record<string, unknown> };
  const tx = data.transaction;

  if (!tx?.['withdraw_anchor_account'] || typeof tx['withdraw_anchor_account'] !== 'string') {
    throw new Error(
      `Transaction record is missing "withdraw_anchor_account". Cannot build payment.`
    );
  }

  const feeDetails = tx['fee_details'] as { total?: string } | undefined;
  const amountFee = tx['amount_fee'] ?? feeDetails?.total;

  return {
    withdrawAnchorAccount: tx['withdraw_anchor_account'] as string,
    memo: (tx['memo'] as string) ?? '',
    memoType: (tx['memo_type'] as string) ?? 'text',
    ...(tx['amount_in'] !== undefined && { amountIn: tx['amount_in'] as string }),
    ...(tx['amount_out'] !== undefined && { amountOut: tx['amount_out'] as string }),
    ...(tx['amount_out_asset'] !== undefined && {
      amountOutAsset: tx['amount_out_asset'] as string,
    }),
    ...(amountFee !== undefined && { amountFee: amountFee as string }),
  };
}
