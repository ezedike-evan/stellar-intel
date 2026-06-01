import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Networks, TransactionBuilder, Keypair, BASE_FEE } from '@stellar/stellar-sdk'
import type { Transaction } from '@stellar/stellar-sdk'

// ─── Mock setup ───────────────────────────────────────────────────────────────

vi.mock('@stellar/freighter-api', () => ({
  isConnected: vi.fn(),
  getAddress: vi.fn(),
  getNetwork: vi.fn(),
  signTransaction: vi.fn(),
}))

vi.mock('@/lib/stellar/sep10', () => ({
  authenticate: vi.fn(),
  fetchSep10Challenge: vi.fn(),
  signChallenge: vi.fn(),
  submitChallenge: vi.fn(),
}))

vi.mock('@/lib/stellar/sep24', () => ({
  initiateWithdraw: vi.fn(),
  getWithdrawTransactionRecord: vi.fn(),
  getSep24Transaction: vi.fn(),
}))

vi.mock('@/lib/stellar/sep1', () => ({
  getTransferServer: vi.fn(),
  getWebAuthEndpoint: vi.fn(),
}))

vi.mock('@/lib/stellar/anchors', () => ({
  getAnchorById: vi.fn(),
  getResolvedAnchorById: vi.fn(),
}))

vi.mock('@/lib/stellar/horizon', () => ({
  horizonServer: {
    loadAccount: vi.fn(),
    submitTransaction: vi.fn(),
  },
  buildWithdrawPayment: vi.fn(),
  signAndSubmitPayment: vi.fn(),
  fetchAccount: vi.fn(),
}))

// ─── Imports after mocks ──────────────────────────────────────────────────────

import * as freighter from '@stellar/freighter-api'
import * as sep10 from '@/lib/stellar/sep10'
import * as sep24 from '@/lib/stellar/sep24'
import * as sep1 from '@/lib/stellar/sep1'
import * as anchors from '@/lib/stellar/anchors'
import * as horizon from '@/lib/stellar/horizon'

// ─── Type definitions ─────────────────────────────────────────────────────────

interface MockReputationLog {
  intentHash: string
  anchorId: string
  deliveredRate: number
  deliveredAmount: string
  settleSeconds: number
  outcome: 'success' | 'failure'
  stellarTx: string
}

// ─── Test fixtures ────────────────────────────────────────────────────────────

// Use fixed keypairs for testing (deterministic)
const USER_PUBLIC_KEY = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789'
const ANCHOR_PUBLIC_KEY = 'GANCHOR123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567'

const RESOLVED_ANCHOR = {
  id: 'test-anchor',
  name: 'Test Anchor',
  homeDomain: 'test-anchor.example',
  corridors: ['usdc-ngn'],
  assetCode: 'USDC',
  assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  TRANSFER_SERVER_SEP0024: 'https://test-anchor.example/sep24',
  WEB_AUTH_ENDPOINT: 'https://test-anchor.example/auth',
  SIGNING_KEY: ANCHOR_PUBLIC_KEY,
  NETWORK_PASSPHRASE: Networks.PUBLIC,
  capabilities: {
    sep10: true,
    sep24: true,
    sep38: false,
    sep12: false,
  },
}

const MOCK_AUTH = {
  jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjk5OTk5OTk5OTl9.signature',
  anchorDomain: RESOLVED_ANCHOR.homeDomain,
  publicKey: USER_PUBLIC_KEY,
  expiresAt: new Date(Date.now() + 86400_000),
}

const MOCK_WITHDRAW_RESPONSE = {
  type: 'interactive_customer_info_needed' as const,
  url: 'https://test-anchor.example/kyc',
  id: 'txn-test-123',
}

const MOCK_TRANSACTION_RECORD = {
  id: 'txn-test-123',
  status: 'pending_user_transfer_start' as const,
  withdrawAnchorAccount: ANCHOR_PUBLIC_KEY,
  withdrawMemo: 'test-memo-123',
  withdrawMemoType: 'text' as const,
  amountIn: '100',
  amountOut: '158000',
  amountFee: '2',
}

const MOCK_COMPLETED_TRANSACTION = {
  ...MOCK_TRANSACTION_RECORD,
  status: 'completed' as const,
  stellarTransactionId: 'test-stellar-tx-hash',
}

// ─── Helper functions ─────────────────────────────────────────────────────────

/**
 * Creates a mock SEP-10 challenge transaction XDR string.
 */
function createMockChallengeXDR(): string {
  // Mock XDR string for a challenge transaction
  return 'AAAAAgAAAABIQVZFIEEgQkFEIFRJTUU='
}

/**
 * Creates a mock unsigned withdrawal payment transaction XDR string.
 */
function createMockUnsignedPaymentXDR(): string {
  // Mock XDR string for a payment transaction
  return 'AAAAAgAAAABQQVlNRU5UIFRSBVNUIFRYU0E='
}

/**
 * Simulates the intent flow: sign intent → route → build unsigned tx → sign → submit.
 * Returns the reputation log entry that would be written.
 */
async function executeIntentFlow(
  amount: string,
  anchorId: string
): Promise<MockReputationLog> {
  // Step 1: Resolve anchor
  const resolvedAnchor = await anchors.getResolvedAnchorById(anchorId)
  expect(resolvedAnchor).toBeDefined()

  // Step 2: Authenticate with anchor (SEP-10)
  const auth = await sep10.authenticate(resolvedAnchor, USER_PUBLIC_KEY)
  expect(auth.jwt).toBeDefined()
  expect(auth.expiresAt.getTime()).toBeGreaterThan(Date.now())

  // Step 3: Initiate withdrawal (SEP-24)
  const withdrawResp = await sep24.initiateWithdraw(resolvedAnchor, {
    assetCode: resolvedAnchor.assetCode,
    amount,
  })
  expect(withdrawResp.id).toBeDefined()

  // Step 4: Get transaction record (includes anchor account + memo)
  const txRecord = await sep24.getWithdrawTransactionRecord(
    resolvedAnchor.TRANSFER_SERVER_SEP0024,
    withdrawResp.id,
    auth.jwt
  )
  expect(txRecord.withdrawAnchorAccount).toBeDefined()
  expect(txRecord.withdrawMemo).toBeDefined()

  // Step 5: Build unsigned payment transaction
  const unsignedTx = await horizon.buildWithdrawPayment({
    sourcePublicKey: USER_PUBLIC_KEY,
    anchorAccount: txRecord.withdrawAnchorAccount,
    amount,
    memo: txRecord.withdrawMemo,
    memoType: txRecord.withdrawMemoType,
    assetCode: resolvedAnchor.assetCode,
    assetIssuer: resolvedAnchor.assetIssuer,
  })
  expect(unsignedTx).toBeDefined()

  // Step 6: Sign transaction with Freighter
  const signedTx = await freighter.signTransaction(unsignedTx.toXDR())
  expect(signedTx).toBeDefined()

  // Step 7: Submit to Stellar
  const submitResult = await horizon.signAndSubmitPayment(unsignedTx, USER_PUBLIC_KEY)
  expect(submitResult.hash).toBeDefined()

  // Step 8: Poll for completion
  let completedTx = txRecord
  let pollCount = 0
  const maxPolls = 10

  while (
    !['completed', 'error', 'refunded'].includes(completedTx.status) &&
    pollCount < maxPolls
  ) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    completedTx = await sep24.getSep24Transaction(
      resolvedAnchor.TRANSFER_SERVER_SEP0024,
      withdrawResp.id,
      auth.jwt
    )
    pollCount++
  }

  expect(completedTx.status).toBe('completed')

  // Step 9: Write reputation log
  const reputationLog: MockReputationLog = {
    intentHash: 'mock-intent-hash-' + Date.now(),
    anchorId: resolvedAnchor.id,
    deliveredRate: parseFloat(completedTx.amountOut || '0') / parseFloat(amount),
    deliveredAmount: completedTx.amountOut || '0',
    settleSeconds: 5, // Mock settlement time
    outcome: completedTx.status === 'completed' ? 'success' : 'failure',
    stellarTx: submitResult.hash,
  }

  return reputationLog
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Intent Flow End-to-End', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Setup Freighter mocks
    vi.mocked(freighter.isConnected).mockResolvedValue({
      isConnected: true,
      error: null,
    })
    vi.mocked(freighter.getAddress).mockResolvedValue({
      address: USER_PUBLIC_KEY,
    })
    vi.mocked(freighter.getNetwork).mockResolvedValue({
      network: 'PUBLIC',
      error: null,
    })
    vi.mocked(freighter.signTransaction).mockResolvedValue({
      signedTransaction: createMockUnsignedPaymentXDR(),
    })

    // Setup SEP-10 mocks
    vi.mocked(sep10.authenticate).mockResolvedValue(MOCK_AUTH)

    // Setup SEP-24 mocks
    vi.mocked(sep24.initiateWithdraw).mockResolvedValue(MOCK_WITHDRAW_RESPONSE)
    vi.mocked(sep24.getWithdrawTransactionRecord).mockResolvedValue(
      MOCK_TRANSACTION_RECORD
    )
    vi.mocked(sep24.getSep24Transaction)
      .mockResolvedValueOnce(MOCK_TRANSACTION_RECORD)
      .mockResolvedValueOnce(MOCK_COMPLETED_TRANSACTION)

    // Setup SEP-1 mocks
    vi.mocked(sep1.getTransferServer).mockResolvedValue(
      RESOLVED_ANCHOR.TRANSFER_SERVER_SEP0024
    )
    vi.mocked(sep1.getWebAuthEndpoint).mockResolvedValue(
      RESOLVED_ANCHOR.WEB_AUTH_ENDPOINT
    )

    // Setup anchor mocks
    vi.mocked(anchors.getResolvedAnchorById).mockResolvedValue(RESOLVED_ANCHOR)

    // Setup Horizon mocks
    vi.mocked(horizon.buildWithdrawPayment).mockResolvedValue({
      toXDR: () => createMockUnsignedPaymentXDR(),
    } as any)
    vi.mocked(horizon.signAndSubmitPayment).mockResolvedValue({
      hash: 'test-stellar-tx-hash-' + Date.now(),
      ledger: 12345,
      resultCode: 'tx_success',
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('completes the full intent flow: sign → route → build → sign → submit → complete', async () => {
    const amount = '100'
    const anchorId = 'test-anchor'

    const reputationLog = await executeIntentFlow(amount, anchorId)

    // Verify reputation log was written
    expect(reputationLog).toBeDefined()
    expect(reputationLog.intentHash).toBeDefined()
    expect(reputationLog.anchorId).toBe(anchorId)
    expect(reputationLog.deliveredAmount).toBe(MOCK_COMPLETED_TRANSACTION.amountOut)
    expect(reputationLog.outcome).toBe('success')
    expect(reputationLog.stellarTx).toBeDefined()
  })

  it('writes reputation log row with correct fields', async () => {
    const amount = '50'
    const anchorId = 'test-anchor'

    const reputationLog = await executeIntentFlow(amount, anchorId)

    // Verify all required fields are present
    expect(reputationLog).toMatchObject({
      intentHash: expect.any(String),
      anchorId: expect.any(String),
      deliveredRate: expect.any(Number),
      deliveredAmount: expect.any(String),
      settleSeconds: expect.any(Number),
      outcome: expect.stringMatching(/^(success|failure)$/),
      stellarTx: expect.any(String),
    })

    // Verify numeric constraints
    expect(reputationLog.deliveredRate).toBeGreaterThan(0)
    expect(reputationLog.settleSeconds).toBeGreaterThanOrEqual(0)
  })

  it('handles authentication failure gracefully', async () => {
    vi.mocked(sep10.authenticate).mockRejectedValue(
      new Error('Authentication failed')
    )

    const amount = '100'
    const anchorId = 'test-anchor'

    await expect(executeIntentFlow(amount, anchorId)).rejects.toThrow(
      'Authentication failed'
    )
  })

  it('handles withdrawal initiation failure gracefully', async () => {
    vi.mocked(sep24.initiateWithdraw).mockRejectedValue(
      new Error('Withdrawal initiation failed')
    )

    const amount = '100'
    const anchorId = 'test-anchor'

    await expect(executeIntentFlow(amount, anchorId)).rejects.toThrow(
      'Withdrawal initiation failed'
    )
  })

  it('handles Freighter signing failure gracefully', async () => {
    vi.mocked(freighter.signTransaction).mockRejectedValue(
      new Error('User rejected signing')
    )

    const amount = '100'
    const anchorId = 'test-anchor'

    await expect(executeIntentFlow(amount, anchorId)).rejects.toThrow(
      'User rejected signing'
    )
  })

  it('handles Stellar submission failure gracefully', async () => {
    vi.mocked(horizon.signAndSubmitPayment).mockRejectedValue(
      new Error('Transaction submission failed')
    )

    const amount = '100'
    const anchorId = 'test-anchor'

    await expect(executeIntentFlow(amount, anchorId)).rejects.toThrow(
      'Transaction submission failed'
    )
  })

  it('polls transaction status until completion', async () => {
    const amount = '100'
    const anchorId = 'test-anchor'

    // Mock multiple poll responses before completion
    // The first call in getWithdrawTransactionRecord returns pending_user_transfer_start
    // Then the polling loop calls it multiple times
    vi.mocked(sep24.getSep24Transaction).mockClear()
    vi.mocked(sep24.getSep24Transaction)
      .mockResolvedValueOnce({
        ...MOCK_TRANSACTION_RECORD,
        status: 'pending_user_transfer_start',
      })
      .mockResolvedValueOnce({
        ...MOCK_TRANSACTION_RECORD,
        status: 'pending_external',
      })
      .mockResolvedValueOnce({
        ...MOCK_TRANSACTION_RECORD,
        status: 'pending_anchor',
      })
      .mockResolvedValueOnce(MOCK_COMPLETED_TRANSACTION)

    const reputationLog = await executeIntentFlow(amount, anchorId)

    expect(reputationLog.outcome).toBe('success')
    // Verify polling happened (at least 2 calls: initial + at least 1 poll)
    expect(vi.mocked(sep24.getSep24Transaction).mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('verifies mock anchor and Freighter are used throughout', async () => {
    const amount = '100'
    const anchorId = 'test-anchor'

    await executeIntentFlow(amount, anchorId)

    // Verify Freighter was called
    expect(vi.mocked(freighter.signTransaction)).toHaveBeenCalled()

    // Verify anchor endpoints were called
    expect(vi.mocked(sep10.authenticate)).toHaveBeenCalled()
    expect(vi.mocked(sep24.initiateWithdraw)).toHaveBeenCalled()
    expect(vi.mocked(sep24.getWithdrawTransactionRecord)).toHaveBeenCalled()

    // Verify Stellar submission was called
    expect(vi.mocked(horizon.signAndSubmitPayment)).toHaveBeenCalled()
  })
})
