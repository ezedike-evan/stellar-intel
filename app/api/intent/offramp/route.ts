import { NextResponse } from 'next/server'
import { registerIntentReplay } from '@/lib/intent/replay'

type IntentPayload = {
  account?: unknown
  nonce?: unknown
  deadline?: unknown
  intentHash?: unknown
}

type IntentReplayBody = {
  publicKey?: unknown
  account?: unknown
  nonce?: unknown
  deadline?: unknown
  intentHash?: unknown
  intent?: IntentPayload
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function pickValue(...values: unknown[]): string | null {
  for (const value of values) {
    const text = readString(value)
    if (text) return text
  }
  return null
}

function jsonError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ code, message }, { status })
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as IntentReplayBody | null

  if (!body || typeof body !== 'object') {
    return jsonError(400, 'invalid_request', 'Request body must be valid JSON.')
  }

  const publicKey = pickValue(body.publicKey, body.account, body.intent?.account)
  const nonce = pickValue(body.nonce, body.intent?.nonce)
  const deadline = pickValue(body.deadline, body.intent?.deadline)
  const intentHash = pickValue(body.intentHash, body.intent?.intentHash)

  if (!publicKey || !nonce || !deadline || !intentHash) {
    return jsonError(400, 'invalid_request', 'Expected publicKey, nonce, deadline, and intentHash.')
  }

  const result = registerIntentReplay({ publicKey, nonce, deadline })

  if (!result.ok) {
    return jsonError(result.status, result.code, result.message)
  }

  return NextResponse.json({ ok: true, intentHash }, { status: 200 })
}