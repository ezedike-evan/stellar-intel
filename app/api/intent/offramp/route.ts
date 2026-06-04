import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Asset, Networks, TransactionBuilder, Operation, Memo, BASE_FEE, Account } from '@stellar/stellar-sdk'
import { hashIntent } from '@/lib/intent/hash'
import { USDC_ISSUER } from '@/lib/config'
import { withRequestLogger } from '@/lib/logger'
import type { Intent } from '@/lib/intent/hash'
import type { ApiError } from '@/types'

// ─── Request schema ────────────────────────────────────────────────────────────

const IntentSchema = z.object({
  type: z.literal('offramp'),
  sourceAsset: z.string().min(1),
  destinationAsset: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d+)?$/, 'amount must be a positive decimal string'),
  sender: z.string().min(1),
  recipient: z.string().min(1),
})

// ─── Response types ────────────────────────────────────────────────────────────

export interface OfframpRoute {
  anchorId: string
  anchorDomain: string
  corridorId: string
  estimatedFee: string
  estimatedReceived: string
}

export interface OfframpIntentResponse {
  route: OfframpRoute
  unsignedTx: string
  quoteId: string
}

// ─── Anchor routing (simple first-match by corridor) ──────────────────────────

const ANCHOR_ROUTING: Record<string, { anchorId: string; anchorDomain: string; anchorAccount: string }> = {
  'usdc-ngn': {
    anchorId: 'cowrie',
    anchorDomain: 'cowrie.exchange',
    anchorAccount: 'GAIJ3VXNY7RPPLGVVCLGBK7NPHLL5ZRKATHETOA7M7UPZPAAHEGQQIY2',
  },
  'usdc-kes': {
    anchorId: 'flutterwave',
    anchorDomain: 'flutterwave.com',
    anchorAccount: 'GC6PVZIZYHHROHYBBOZDJ5ZZI4RH6LDSHRT4K7BA5QGZFKMZ6HAZUQAK',
  },
}

function resolveRoute(sourceAsset: string, destinationAsset: string): OfframpRoute | null {
  const corridorId = `${sourceAsset.toLowerCase()}-${destinationAsset.toLowerCase()}`
  const anchor = ANCHOR_ROUTING[corridorId]
  if (!anchor) return null
  return {
    anchorId: anchor.anchorId,
    anchorDomain: anchor.anchorDomain,
    corridorId,
    estimatedFee: '2',
    estimatedReceived: '0',
  }
}

// ─── Unsigned transaction builder ─────────────────────────────────────────────

function buildUnsignedOfframpTx(
  senderPublicKey: string,
  anchorAccount: string,
  amount: string,
  assetCode: string,
  assetIssuer: string,
  quoteId: string
): string {
  const asset = new Asset(assetCode, assetIssuer)
  const account = new Account(senderPublicKey, '0')

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.PUBLIC,
  })
    .addOperation(
      Operation.payment({
        destination: anchorAccount,
        asset,
        amount,
      })
    )
    .addMemo(Memo.hash(Buffer.from(quoteId, 'hex')))
    .setTimeout(300)
    .build()

  return tx.toXDR()
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.intent.offramp', async (logger) => {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      logger.warn({ event: 'invalid_json', message: 'Request body must be valid JSON' })
      return NextResponse.json<ApiError>(
        { code: 'INVALID_JSON', message: 'Request body must be valid JSON' },
        { status: 400 }
      )
    }

    const parsed = IntentSchema.safeParse(body)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      logger.warn({ event: 'validation_failed', issues: parsed.error.issues })
      return NextResponse.json<ApiError>(
        {
          code: 'VALIDATION_ERROR',
          message: first?.message ?? 'Invalid intent payload',
        },
        { status: 400 }
      )
    }

    const intent = parsed.data as Intent
    const route = resolveRoute(intent.sourceAsset, intent.destinationAsset)

    logger.info({ event: 'intent_parsed', sourceAsset: intent.sourceAsset, destinationAsset: intent.destinationAsset })

    if (!route) {
      logger.warn({ event: 'no_route', sourceAsset: intent.sourceAsset, destinationAsset: intent.destinationAsset })
      return NextResponse.json<ApiError>(
        {
          code: 'NO_ROUTE',
          message: `No route found for ${intent.sourceAsset} → ${intent.destinationAsset}`,
        },
        { status: 400 }
      )
    }

    const quoteId = await hashIntent(intent)
    const anchorEntry = ANCHOR_ROUTING[route.corridorId]

    if (!anchorEntry) {
      logger.error({ event: 'anchor_config_missing', corridorId: route.corridorId })
      return NextResponse.json<ApiError>(
        { code: 'NO_ROUTE', message: 'Anchor configuration missing' },
        { status: 400 }
      )
    }

    let unsignedTx: string
    try {
      unsignedTx = buildUnsignedOfframpTx(
        intent.sender,
        anchorEntry.anchorAccount,
        intent.amount,
        intent.sourceAsset,
        USDC_ISSUER,
        quoteId
      )
    } catch (err) {
      logger.error({ event: 'tx_build_failed', error: err instanceof Error ? err.message : 'Unknown error' })
      return NextResponse.json<ApiError>(
        {
          code: 'TX_BUILD_FAILED',
          message: err instanceof Error ? err.message : 'Failed to build transaction',
        },
        { status: 500 }
      )
    }

    logger.info({ event: 'intent_response', corridorId: route.corridorId, quoteId })
    return NextResponse.json<OfframpIntentResponse>({ route, unsignedTx, quoteId })
  })
}
