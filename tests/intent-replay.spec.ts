import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { POST } from '@/app/api/intent/offramp/route'
import { clearIntentReplayStore } from '@/lib/intent/replay'

const NOW = new Date('2026-05-29T12:00:00.000Z')

const BASE_BODY = {
  publicKey: 'GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABCDE',
  nonce: 'nonce-123',
  deadline: '2026-05-29T12:05:00.000Z',
  intentHash: 'intent-hash-123',
}

function buildRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/intent/offramp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  clearIntentReplayStore()
})

afterEach(() => {
  clearIntentReplayStore()
  vi.useRealTimers()
})

describe('POST /api/intent/offramp replay protection', () => {
  it('accepts the first submission of an intent', async () => {
    const response = await POST(buildRequest(BASE_BODY))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, intentHash: BASE_BODY.intentHash })
  })

  it('returns 409 for a repeated submission with the same public key and nonce', async () => {
    await POST(buildRequest(BASE_BODY))

    const response = await POST(buildRequest(BASE_BODY))
    const payload = (await response.json()) as { code: string; message: string }

    expect(response.status).toBe(409)
    expect(payload.code).toBe('replay_detected')
    expect(payload.message).toMatch(/nonce/i)
  })

  it('returns 410 when the deadline has passed', async () => {
    const response = await POST(
      buildRequest({
        ...BASE_BODY,
        deadline: '2026-05-29T11:59:59.000Z',
      })
    )
    const payload = (await response.json()) as { code: string; message: string }

    expect(response.status).toBe(410)
    expect(payload.code).toBe('deadline_expired')
    expect(payload.message).toMatch(/expired/i)
  })

  it('keeps replay state isolated per public key', async () => {
    await POST(buildRequest(BASE_BODY))

    const response = await POST(
      buildRequest({
        ...BASE_BODY,
        publicKey: 'GBCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABCD',
      })
    )

    expect(response.status).toBe(200)
  })
})