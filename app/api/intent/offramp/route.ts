import { NextRequest, NextResponse } from 'next/server'
import { verifySignedIntent } from '@/lib/intent/sign'
import { registerIntentReplay } from '@/lib/intent/replay'
import type { SignedIntent, Plan } from '@/types'

/**
 * POST /api/intent/offramp
 *
 * Submit a signed intent for off-ramp execution.
 *
 * This endpoint:
 * 1. Validates the request body structure
 * 2. Registers the intent for replay protection
 * 3. Verifies the Ed25519 signature
 * 4. Validates the intent structure and deadline
 * 5. Routes the intent to the appropriate handler
 * 6. Returns a plan with anchor, quote, and unsigned transaction
 *
 * Request body:
 * {
 *   intent: Intent,
 *   intentHash: string,
 *   signature: string
 * }
 *
 * Response:
 * {
 *   plan: Plan,
 *   status: 'pending' | 'processing' | 'completed'
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body: SignedIntent = await request.json()

    // Verify required fields
    if (!body.intent || !body.intentHash || !body.signature) {
      return NextResponse.json(
        { code: 'MISSING_FIELDS', message: 'Missing required fields: intent, intentHash, signature' },
        { status: 400 }
      )
    }

    // Register for replay protection
    const intent = body.intent
    const replayResult = registerIntentReplay({
      publicKey: intent.account,
      nonce: intent.nonce,
      deadline: intent.deadline,
    })

    if (!replayResult.ok) {
      return NextResponse.json(
        { code: replayResult.code, message: replayResult.message },
        { status: replayResult.status }
      )
    }

    // Verify the signature
    const isValid = await verifySignedIntent(body)
    if (!isValid) {
      return NextResponse.json(
        { code: 'INVALID_SIGNATURE', message: 'Invalid signature' },
        { status: 401 }
      )
    }

    // Validate intent structure
    if (!intent.account || !intent.corridor || !intent.sellAmount || !intent.deadline) {
      return NextResponse.json(
        { code: 'INVALID_INTENT', message: 'Invalid intent structure' },
        { status: 400 }
      )
    }

    // Check if deadline has passed
    if (new Date(intent.deadline) < new Date()) {
      return NextResponse.json(
        { code: 'EXPIRED_INTENT', message: 'Intent deadline has passed' },
        { status: 400 }
      )
    }

    // TODO: Route to intent router to generate plan
    // For now, return a placeholder response
    const plan: Plan = {
      intentHash: body.intentHash,
      legs: [], // Will be populated by the router
      totalExpectedReceive: '0',
      totalFee: '0',
      isSplit: false,
      createdAt: new Date().toISOString(),
      expiresAt: intent.deadline,
    }

    return NextResponse.json({
      plan,
      status: 'pending',
    })
  } catch (error) {
    console.error('Error processing intent:', error)
    return NextResponse.json(
      { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 }
    )
  }
}
