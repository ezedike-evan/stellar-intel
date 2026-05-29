import { NextRequest, NextResponse } from 'next/server'
import { verifySignedIntent } from '@/lib/intent/sign'
import type { SignedIntent, Plan } from '@/types'

/**
 * POST /api/intent/offramp
 * 
 * Submit a signed intent for off-ramp execution.
 * 
 * This endpoint:
 * 1. Verifies the signature on the signed intent
 * 2. Validates the intent structure
 * 3. Routes the intent to the appropriate handler
 * 4. Returns a plan with anchor, quote, and unsigned transaction
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
        { error: 'Missing required fields: intent, intentHash, signature' },
        { status: 400 }
      )
    }

    // Verify the signature
    const isValid = await verifySignedIntent(body)
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      )
    }

    // Validate intent structure
    const intent = body.intent
    if (!intent.account || !intent.corridor || !intent.sellAmount || !intent.deadline) {
      return NextResponse.json(
        { error: 'Invalid intent structure' },
        { status: 400 }
      )
    }

    // Check if deadline has passed
    if (new Date(intent.deadline) < new Date()) {
      return NextResponse.json(
        { error: 'Intent deadline has passed' },
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
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
