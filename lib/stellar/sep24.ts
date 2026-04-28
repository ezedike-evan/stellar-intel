import { getTransferServer } from './sep1'
import { getAnchorsByCorridorId, getCorridorById } from './anchors'
import { computeTotalReceived } from '@/lib/utils'
import type { Sep24FeeParams, AnchorRate, RateComparison, Sep24WithdrawRequest, Sep24WithdrawResponse, WithdrawStatus, WithdrawStatusValue } from '@/types'

// ─── Transaction polling ──────────────────────────────────────────────────────

export const TERMINAL_STATES: ReadonlySet<WithdrawStatusValue> = new Set([
  'completed',
  'error',
  'refunded',
])

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
])

function normalizeStatus(raw: unknown): WithdrawStatusValue {
  if (typeof raw === 'string' && KNOWN_STATUSES.has(raw as WithdrawStatusValue)) {
    return raw as WithdrawStatusValue
  }
  return 'pending_external'
}

/**
 * Fetches the current status of a single SEP-24 transaction.
 * Unknown anchor status strings are normalized to "pending_external" rather than throwing.
 */
export async function getSep24Transaction(
  transferServer: string,
  transactionId: string,
  jwt: string
): Promise<WithdrawStatus> {
  const res = await fetch(`${transferServer}/transaction?id=${transactionId}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  })

  if (!res.ok) {
    throw new Error(`Transaction fetch failed: HTTP ${res.status}`)
  }

  const data = (await res.json()) as { transaction?: Record<string, unknown> }
  const tx = data.transaction ?? {}

  return {
    id: String(tx['id'] ?? transactionId),
    status: normalizeStatus(tx['status']),
    updatedAt: new Date(),
    ...(tx['amount_in'] !== undefined && { amountIn: tx['amount_in'] as string }),
    ...(tx['amount_out'] !== undefined && { amountOut: tx['amount_out'] as string }),
    ...(tx['amount_fee'] !== undefined && { amountFee: tx['amount_fee'] as string }),
    ...(tx['stellar_transaction_id'] !== undefined && { stellarTransactionId: tx['stellar_transaction_id'] as string }),
  }
}

// ─── Typed errors ─────────────────────────────────────────────────────────────

export class AnchorRateError extends Error {
  readonly anchorId: string

  constructor(anchorId: string, message: string) {
    super(message)
    this.name = 'AnchorRateError'
    this.anchorId = anchorId
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseRate(raw: unknown): number {
  if (raw === undefined || raw === null) return 0
  const num = Number(String(raw).replace(/,/g, ''))
  return Number.isFinite(num) ? num : 0
}

// ─── Fee fetching ─────────────────────────────────────────────────────────────

/**
 * Fetches the withdrawal fee from a single anchor's SEP-24 /fee endpoint.
 * Throws on HTTP errors, missing fee field, or request timeout (10s).
 */
export async function fetchAnchorFee(
  params: Sep24FeeParams
): Promise<{ fee: string; anchorDomain: string; exchangeRate: number }> {
  const transferServer = await getTransferServer(params.anchorDomain)
  if (!transferServer) {
    throw new Error(`Anchor "${params.anchorDomain}" does not support SEP-24.`)
  }

  const url = new URL(`${transferServer}/fee`)
  url.searchParams.set('operation', params.operation)
  url.searchParams.set('asset_code', params.assetCode)
  url.searchParams.set('asset_issuer', params.assetIssuer)
  url.searchParams.set('amount', params.amount)
  url.searchParams.set('type', params.type)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  let res: Response
  try {
    res = await fetch(url.toString(), { signal: controller.signal })
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`Request to ${params.anchorDomain} timed out after 10 seconds`)
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }

  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} from ${params.anchorDomain} fee endpoint`
    )
  }

  const data = (await res.json()) as Record<string, unknown>

  const fee = data['fee']
  if (fee === undefined || fee === null || isNaN(Number(fee))) {
    throw new Error(
      `Invalid fee response from ${params.anchorDomain}: missing or non-numeric "fee" field`
    )
  }

  const rateRaw = data['price'] ?? data['exchange_rate'] ?? data['rate']
  const exchangeRate = parseRate(rateRaw)

  return { fee: String(fee), anchorDomain: params.anchorDomain, exchangeRate }
}

/**
 * Fetches fees from all anchors serving the given corridor in parallel.
 * Uses Promise.allSettled so a single anchor failure does not block others.
 */
export async function fetchAllAnchorFees(
  amount: string,
  corridorId: string
): Promise<PromiseSettledResult<AnchorRate>[]> {
  const anchors = getAnchorsByCorridorId(corridorId)
  const corridor = getCorridorById(corridorId)

  return Promise.allSettled(
    anchors.map(async (anchor): Promise<AnchorRate> => {
      const { fee, exchangeRate } = await fetchAnchorFee({
        anchorDomain: anchor.homeDomain,
        operation: 'withdraw',
        assetCode: anchor.assetCode,
        assetIssuer: anchor.assetIssuer,
        amount,
        type: 'bank_account',
      })

      const feeNum = Number(fee)
      const amountNum = Number(amount)

      if (exchangeRate <= 0) {
        throw new AnchorRateError(
          anchor.id,
          `${anchor.name} returned a zero or missing exchange rate for ${corridor.to} — rate cannot be derived`
        )
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
      }
    })
  )
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
    .map((r) => r.value)

  if (rates.length === 0) {
    return { corridorId, rates: [], bestRateId: '' }
  }

  const best = rates.reduce((a, b) => (b.totalReceived > a.totalReceived ? b : a))

  return { corridorId, rates, bestRateId: best.anchorId }
}

// ─── Withdraw interactive flow ────────────────────────────────────────────────

/**
 * POSTs to the anchor's SEP-24 withdraw interactive endpoint.
 * Returns the popup URL and transaction ID issued by the anchor.
 */
export async function initiateWithdraw(
  params: Sep24WithdrawRequest & { transferServer: string }
): Promise<Sep24WithdrawResponse> {
  const { transferServer, jwt, assetCode, assetIssuer, amount, account } = params

  const res = await fetch(`${transferServer}/transactions/withdraw/interactive`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      asset_code: assetCode,
      asset_issuer: assetIssuer,
      amount,
      account,
      lang: 'en',
    }),
  })

  if (!res.ok) {
    throw new Error(`Withdraw initiation failed: HTTP ${res.status} from ${transferServer}`)
  }

  const data = (await res.json()) as Record<string, unknown>

  if (data['type'] !== 'interactive_customer_info_needed') {
    throw new Error(
      `Unexpected response type from anchor: "${data['type']}". ` +
        `Expected "interactive_customer_info_needed".`
    )
  }

  if (!data['url'] || typeof data['url'] !== 'string') {
    throw new Error('Anchor withdraw response is missing the "url" field')
  }

  if (!data['id'] || typeof data['id'] !== 'string') {
    throw new Error('Anchor withdraw response is missing the "id" field')
  }

  return {
    type: 'interactive_customer_info_needed',
    url: data['url'] as string,
    id: data['id'] as string,
  }
}

/**
 * Opens the anchor's KYC popup and waits for the user to complete it.
 * Resolves with the transaction ID on success.
 * Rejects if the user cancels or closes the popup.
 */
export function openWithdrawPopup(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const width = 600
    const height = 700
    const left = Math.round(window.screen.width / 2 - width / 2)
    const top = Math.round(window.screen.height / 2 - height / 2)

    const popup = window.open(
      url,
      'stellar_anchor_kyc',
      `width=${width},height=${height},left=${left},top=${top}`
    )

    if (!popup) {
      reject(new Error('Failed to open popup. Check that popups are not blocked.'))
      return
    }

    let resolved = false

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'stellar_transaction_created') {
        cleanup()
        resolve(event.data.transaction_id as string)
      } else if (event.data?.type === 'stellar_cancel') {
        cleanup()
        reject(new Error('User cancelled the transaction'))
      }
    }

    const pollInterval = setInterval(() => {
      if (popup.closed && !resolved) {
        cleanup()
        reject(new Error('Popup was closed'))
      }
    }, 500)

    function cleanup() {
      resolved = true
      clearInterval(pollInterval)
      window.removeEventListener('message', onMessage)
    }

    window.addEventListener('message', onMessage)
  })
}

/**
 * Fetches the anchor's transaction record after the popup completes.
 * Returns the anchor account, memo, and memo type needed to build the Stellar payment.
 */
export async function getWithdrawTransactionRecord(
  transferServer: string,
  transactionId: string,
  jwt: string
): Promise<{ withdrawAnchorAccount: string; memo: string; memoType: string }> {
  const res = await fetch(`${transferServer}/transaction?id=${transactionId}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  })

  if (!res.ok) {
    throw new Error(`Failed to fetch transaction record: HTTP ${res.status}`)
  }

  const data = (await res.json()) as { transaction?: Record<string, unknown> }
  const tx = data.transaction

  if (!tx?.['withdraw_anchor_account'] || typeof tx['withdraw_anchor_account'] !== 'string') {
    throw new Error(
      `Transaction record is missing "withdraw_anchor_account". Cannot build payment.`
    )
  }

  return {
    withdrawAnchorAccount: tx['withdraw_anchor_account'] as string,
    memo: (tx['memo'] as string) ?? '',
    memoType: (tx['memo_type'] as string) ?? 'text',
  }
}
