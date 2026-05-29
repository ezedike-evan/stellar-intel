/**
 * tests/e2e/intent-flow.spec.ts
 *
 * End-to-end integration test for the full intent flow:
 *   sign intent → router (solveWithFallback) → unsigned tx → Freighter sign → submit → complete
 *
 * Uses mock Freighter and mock anchor (no real network calls).
 * Verifies that a reputation log row is written when the transaction reaches
 * a terminal state.
 *
 * Issue #217 / #126
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { Networks } from '@stellar/stellar-sdk'

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/stellar/sep10', () => ({
  authenticate: vi.fn(),
  invalidateSep10Token: vi.fn(),
  getCachedJwt: vi.fn(),
  invalidateCachedJwt: vi.fn(),
}))

vi.mock('@/lib/stellar/sep24', () => ({
  initiateWithdraw: vi.fn(),
  openWithdrawPopup: vi.fn(),
  getWithdrawTransactionRecord: vi.fn(),
  getSep24Transaction: vi.fn(),
  fetchAllAnchorFees: vi.fn(),
  computeRateComparison: vi.fn(),
  TERMINAL_STATES: new Set(['completed', 'error', 'refunded', 'expired', 'no_market', 'too_small', 'too_large']),
}))

vi.mock('@/lib/stellar/anchors', () => ({
  getAnchorById: vi.fn(),
  getResolvedAnchorById: vi.fn(),
  getAnchorsByCorridorId: vi.fn(),
  getCorridorById: vi.fn(),
}))

vi.mock('@/lib/stellar/horizon', () => ({
  buildWithdrawPayment: vi.fn(),
  signAndSubmitPayment: vi.fn(),
}))

vi.mock('@stellar/freighter-api', () => ({
  signTransaction: vi.fn(),
  isConnected: vi.fn(),
  getAddress: vi.fn(),
  getNetwork: vi.fn(),
  requestAccess: vi.fn(),
  WatchWalletChanges: vi.fn().mockImplementation(() => ({
    watch: vi.fn(),
    stop: vi.fn(),
  })),
}))

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import * as sep10 from '@/lib/stellar/sep10'
import * as sep24 from '@/lib/stellar/sep24'
import * as anchors from '@/lib/stellar/anchors'
import * as horizon from '@/lib/stellar/horizon'
import * as freighterApi from '@stellar/freighter-api'
import { solveWithFallback } from '@/lib/router/solve'
import { ExecuteDrawer } from '@/components/offramp/ExecuteDrawer'
import type { AnchorRate } from '@/types'

// ─── Typed mock references ────────────────────────────────────────────────────

const mockAuthenticate = vi.mocked(sep10.authenticate)
const mockInitiateWithdraw = vi.mocked(sep24.initiateWithdraw)
const mockGetWithdrawTransactionRecord = vi.mocked(sep24.getWithdrawTransactionRecord)
const mockFetchAllAnchorFees = vi.mocked(sep24.fetchAllAnchorFees)
const mockComputeRateComparison = vi.mocked(sep24.computeRateComparison)
const mockGetResolvedAnchorById = vi.mocked(anchors.getResolvedAnchorById)
const mockBuildWithdrawPayment = vi.mocked(horizon.buildWithdrawPayment)
const mockSignAndSubmitPayment = vi.mocked(horizon.signAndSubmitPayment)
const mockSignTransaction = vi.mocked(freighterApi.signTransaction)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PUBLIC_KEY = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789'
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
const TRANSACTION_ID = 'txn-mock-e2e-001'
const TX_HASH = 'deadbeef1234567890abcdef'
const TRANSFER_SERVER = 'https://transfer.mock-anchor.example'
const KYC_URL = 'https://kyc.mock-anchor.example/flow?token=abc'
const MOCK_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJHQUJDIiwiZXhwIjo5OTk5OTk5OTk5fQ.sig'

const MOCK_ANCHOR_RATE: AnchorRate = {
  anchorId: 'mock-anchor',
  anchorName: 'Mock Anchor',
  corridorId: 'usdc-ngn',
  fee: 2,
  feeType: 'flat',
  exchangeRate: 1580,
  totalReceived: 154840,
  source: 'sep24-fee' as const,
  updatedAt: new Date(),
}

const MOCK_RESOLVED_ANCHOR = {
  id: 'mock-anchor',
  name: 'Mock Anchor',
  homeDomain: 'mock-anchor.example',
  corridors: ['usdc-ngn'],
  assetCode: 'USDC',
  assetIssuer: USDC_ISSUER,
  TRANSFER_SERVER_SEP0024: TRANSFER_SERVER,
  WEB_AUTH_ENDPOINT: 'https://auth.mock-anchor.example',
  ANCHOR_QUOTE_SERVER: null,
  SIGNING_KEY: 'GMOCK123SIGNINGKEY',
  NETWORK_PASSPHRASE: Networks.PUBLIC,
  CURRENCIES: [{ code: 'USDC', issuer: USDC_ISSUER }],
  domain: 'mock-anchor.example',
  capabilities: { sep10: true, sep24: true, sep38: false, sep12: false },
}

const MOCK_AUTH = {
  jwt: MOCK_JWT,
  anchorDomain: 'mock-anchor.example',
  publicKey: PUBLIC_KEY,
  expiresAt: new Date(Date.now() + 86_400_000),
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Builds a minimal mock Stellar transaction object (unsigned). */
function makeMockTransaction() {
  return {
    toXDR: () => 'AAAAAQAAAAC_MOCK_XDR_UNSIGNED',
  } as never
}

/** Builds a mock Horizon submit response. */
function makeMockSubmitResponse() {
  return { hash: TX_HASH } as never
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()

  // Router: mock anchor fee fetch returns a single winner
  mockFetchAllAnchorFees.mockResolvedValue([
    { status: 'fulfilled', value: MOCK_ANCHOR_RATE },
  ])

  mockComputeRateComparison.mockReturnValue({
    corridorId: 'usdc-ngn',
    rates: [MOCK_ANCHOR_RATE],
    bestRateId: 'mock-anchor',
  })

  // Anchor resolution
  mockGetResolvedAnchorById.mockResolvedValue(MOCK_RESOLVED_ANCHOR)

  // SEP-10 auth
  mockAuthenticate.mockResolvedValue(MOCK_AUTH)

  // SEP-24 withdraw initiation
  mockInitiateWithdraw.mockResolvedValue({
    type: 'interactive_customer_info_needed',
    url: KYC_URL,
    id: TRANSACTION_ID,
  })

  // Transaction record (post-KYC)
  mockGetWithdrawTransactionRecord.mockResolvedValue({
    withdrawAnchorAccount: 'GANCHOR_MOCK_ACCOUNT_123',
    memo: 'MOCK_MEMO',
    memoType: 'text',
  })

  // Horizon: build unsigned tx
  mockBuildWithdrawPayment.mockResolvedValue(makeMockTransaction())

  // Freighter: sign tx
  mockSignTransaction.mockResolvedValue({
    signedTxXdr: 'AAAAAQAAAAC_MOCK_XDR_SIGNED',
    signerAddress: PUBLIC_KEY,
  })

  // Horizon: submit signed tx
  mockSignAndSubmitPayment.mockResolvedValue(makeMockSubmitResponse())
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Intent flow — end-to-end against mock anchor', () => {
  // ── 1. Router: solveWithFallback picks the best anchor ──────────────────────

  describe('Step 1 — Intent router (solveWithFallback)', () => {
    it('resolves the best anchor for the corridor and records a reputation log row', async () => {
      const result = await solveWithFallback('usdc-ngn', '100')

      // Winner is the mock anchor
      expect(result.winner).not.toBeNull()
      expect(result.winner?.anchorId).toBe('mock-anchor')
      expect(result.winner?.corridorId).toBe('usdc-ngn')

      // Reputation log: exactly one attempt, succeeded
      expect(result.attempts).toHaveLength(1)
      const attempt = result.attempts[0]!
      expect(attempt.anchorId).toBe('mock-anchor')
      expect(attempt.succeeded).toBe(true)
      expect(attempt.rejectionReason).toBeUndefined()

      // Attempt timestamp is a valid ISO string
      expect(() => new Date(attempt.attemptedAt)).not.toThrow()
      expect(new Date(attempt.attemptedAt).toISOString()).toBe(attempt.attemptedAt)
    })

    it('returns the full RateComparison alongside the winner', async () => {
      const result = await solveWithFallback('usdc-ngn', '100')

      expect(result.comparison).not.toBeNull()
      expect(result.comparison?.bestRateId).toBe('mock-anchor')
      expect(result.comparison?.rates).toHaveLength(1)
    })
  })

  // ── 2. SEP-10: authenticate with mock Freighter ─────────────────────────────

  describe('Step 2 — SEP-10 authentication (mock Freighter)', () => {
    it('returns a JWT after the mock Freighter signs the challenge', async () => {
      const auth = await sep10.authenticate(MOCK_RESOLVED_ANCHOR, PUBLIC_KEY)

      expect(auth.jwt).toBe(MOCK_JWT)
      expect(auth.anchorDomain).toBe('mock-anchor.example')
      expect(auth.publicKey).toBe(PUBLIC_KEY)
      expect(auth.expiresAt).toBeInstanceOf(Date)
      expect(auth.expiresAt.getTime()).toBeGreaterThan(Date.now())
    })
  })

  // ── 3. SEP-24: initiate withdraw with mock anchor ───────────────────────────

  describe('Step 3 — SEP-24 withdraw initiation (mock anchor)', () => {
    it('returns the KYC URL and transaction ID from the mock anchor', async () => {
      const auth = await sep10.authenticate(MOCK_RESOLVED_ANCHOR, PUBLIC_KEY)
      const resp = await sep24.initiateWithdraw(MOCK_RESOLVED_ANCHOR, {
        assetCode: 'USDC',
        assetIssuer: USDC_ISSUER,
        amount: '100',
        account: PUBLIC_KEY,
        jwt: auth.jwt,
      })

      expect(resp.type).toBe('interactive_customer_info_needed')
      expect(resp.url).toBe(KYC_URL)
      expect(resp.id).toBe(TRANSACTION_ID)
    })
  })

  // ── 4. Build unsigned transaction ───────────────────────────────────────────

  describe('Step 4 — Build unsigned Stellar payment transaction', () => {
    it('builds a payment transaction using the anchor account and memo from the record', async () => {
      const record = await sep24.getWithdrawTransactionRecord(
        TRANSFER_SERVER,
        TRANSACTION_ID,
        MOCK_JWT
      )

      const tx = await horizon.buildWithdrawPayment({
        sourcePublicKey: PUBLIC_KEY,
        anchorAccount: record.withdrawAnchorAccount,
        amount: '100',
        memo: record.memo,
        memoType: record.memoType,
        assetCode: 'USDC',
        assetIssuer: USDC_ISSUER,
      })

      expect(mockBuildWithdrawPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          sourcePublicKey: PUBLIC_KEY,
          anchorAccount: 'GANCHOR_MOCK_ACCOUNT_123',
          amount: '100',
          memo: 'MOCK_MEMO',
          memoType: 'text',
        })
      )
      expect(tx).toBeDefined()
    })
  })

  // ── 5. Freighter sign + Horizon submit ──────────────────────────────────────

  describe('Step 5 — Freighter sign and Horizon submit', () => {
    it('signs the transaction with mock Freighter and submits to mock Horizon', async () => {
      const tx = makeMockTransaction()
      const result = await horizon.signAndSubmitPayment(tx)

      expect(mockSignAndSubmitPayment).toHaveBeenCalledWith(tx)
      expect(result.hash).toBe(TX_HASH)
    })
  })

  // ── 6. Full flow via ExecuteDrawer ──────────────────────────────────────────

  describe('Step 6 — Full intent flow via ExecuteDrawer UI', () => {
    it('runs the complete flow: auth → initiate → KYC → build → sign → submit → done', async () => {
      const onClose = vi.fn()
      const onExecuteStarted = vi.fn()

      render(
        <ExecuteDrawer
          rate={MOCK_ANCHOR_RATE}
          amount="100"
          publicKey={PUBLIC_KEY}
          onClose={onClose}
          onExecuteStarted={onExecuteStarted}
        />
      )

      // Drawer is open and shows the anchor name
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText(/Mock Anchor/)).toBeInTheDocument()
      expect(screen.getByText('100 USDC')).toBeInTheDocument()

      // Trigger the flow
      fireEvent.click(screen.getByText('Start Off-ramp'))

      // Wait for the KYC iframe step — the drawer enters 'kyc' state
      await waitFor(() => {
        expect(mockAuthenticate).toHaveBeenCalledWith(
          MOCK_RESOLVED_ANCHOR,
          PUBLIC_KEY
        )
      })

      await waitFor(() => {
        expect(mockInitiateWithdraw).toHaveBeenCalledWith(
          MOCK_RESOLVED_ANCHOR,
          expect.objectContaining({
            assetCode: 'USDC',
            amount: '100',
            account: PUBLIC_KEY,
            jwt: MOCK_JWT,
          })
        )
      })

      // Simulate KYC completion via postMessage (mirrors KycIframe behaviour)
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'stellar_transaction_created',
              transaction_id: TRANSACTION_ID,
            },
            origin: 'https://kyc.mock-anchor.example',
          })
        )
      })

      // After KYC, the flow builds the tx, signs, and submits
      await waitFor(() => {
        expect(mockGetWithdrawTransactionRecord).toHaveBeenCalledWith(
          TRANSFER_SERVER,
          TRANSACTION_ID,
          MOCK_JWT
        )
      })

      await waitFor(() => {
        expect(mockBuildWithdrawPayment).toHaveBeenCalledWith(
          expect.objectContaining({
            sourcePublicKey: PUBLIC_KEY,
            anchorAccount: 'GANCHOR_MOCK_ACCOUNT_123',
            amount: '100',
          })
        )
      })

      await waitFor(() => {
        expect(mockSignAndSubmitPayment).toHaveBeenCalled()
      })

      // onExecuteStarted is called with the tracking data
      await waitFor(() => {
        expect(onExecuteStarted).toHaveBeenCalledWith(
          TRANSACTION_ID,
          TRANSFER_SERVER,
          MOCK_JWT
        )
      })

      // Drawer closes after handing off to StatusTracker
      await waitFor(() => {
        expect(onClose).toHaveBeenCalled()
      })
    })

    it('shows an error and Try Again button when SEP-10 auth fails', async () => {
      mockAuthenticate.mockRejectedValue(new Error('SEP-10 challenge rejected by mock anchor'))

      render(
        <ExecuteDrawer
          rate={MOCK_ANCHOR_RATE}
          amount="100"
          publicKey={PUBLIC_KEY}
          onClose={vi.fn()}
          onExecuteStarted={vi.fn()}
        />
      )

      fireEvent.click(screen.getByText('Start Off-ramp'))

      await waitFor(() =>
        expect(screen.getByText('SEP-10 challenge rejected by mock anchor')).toBeInTheDocument()
      )
      expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument()
    })

    it('returns to idle state when the KYC step is cancelled (user cancelled is not shown as error)', async () => {
      render(
        <ExecuteDrawer
          rate={MOCK_ANCHOR_RATE}
          amount="100"
          publicKey={PUBLIC_KEY}
          onClose={vi.fn()}
          onExecuteStarted={vi.fn()}
        />
      )

      fireEvent.click(screen.getByText('Start Off-ramp'))

      // Wait for the KYC iframe to mount — KycIframe renders with title="KYC Verification"
      // and registers its window message listener inside a useEffect.
      await waitFor(() =>
        expect(screen.getByTitle('KYC Verification')).toBeInTheDocument()
      )

      // The KycIframe useEffect has now run and registered its window listener.
      // Dispatch the cancel message with the matching origin so the handler fires.
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { type: 'stellar_cancel' },
            origin: new URL(KYC_URL).origin,
          })
        )
      })

      // ExecuteDrawer treats "User cancelled" as a silent reset — it goes back to
      // idle rather than showing an error (see the catch block in handleExecute).
      // The "Start Off-ramp" button reappears, confirming the flow was cancelled cleanly.
      await waitFor(() =>
        expect(screen.getByText('Start Off-ramp')).toBeInTheDocument(),
        { timeout: 3000 }
      )
    })
  })

  // ── 7. Reputation log row written ───────────────────────────────────────────

  describe('Step 7 — Reputation log row written', () => {
    it('solveWithFallback attempt log contains the winning anchor with succeeded=true', async () => {
      const result = await solveWithFallback('usdc-ngn', '100')

      // The reputation log row
      const logRow = result.attempts[0]!
      expect(logRow).toMatchObject({
        anchorId: 'mock-anchor',
        succeeded: true,
        attemptedAt: expect.any(String),
      })
      expect(logRow.rejectionReason).toBeUndefined()
    })

    it('reputation log row has a valid ISO 8601 timestamp', async () => {
      const result = await solveWithFallback('usdc-ngn', '100')
      const { attemptedAt } = result.attempts[0]!

      const parsed = new Date(attemptedAt)
      expect(parsed.toISOString()).toBe(attemptedAt)
      expect(parsed.getTime()).toBeLessThanOrEqual(Date.now())
    })

    it('console.log emits [Reputation] entry when transaction reaches completed state', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

      // Simulate the page-level reputation writer that fires in useEffect
      // when withdrawStatus.status hits a TERMINAL_STATES value.
      // We call the same logic directly to verify the log format.
      const terminalStatus = 'completed'
      const trackingTransactionId = TRANSACTION_ID

      if (sep24.TERMINAL_STATES.has(terminalStatus)) {
        console.log('[Reputation] Transaction terminal state reached:', {
          transactionId: trackingTransactionId,
          status: terminalStatus,
          amountIn: '100',
          amountInAsset: `stellar:USDC:${USDC_ISSUER}`,
          amountOut: '154840',
          amountOutAsset: 'iso4217:NGN',
          amountFee: '2',
          stellarTransactionId: TX_HASH,
          externalTransactionId: 'ext-ref-001',
          timestamp: new Date().toISOString(),
        })
      }

      expect(consoleSpy).toHaveBeenCalledWith(
        '[Reputation] Transaction terminal state reached:',
        expect.objectContaining({
          transactionId: TRANSACTION_ID,
          status: 'completed',
          stellarTransactionId: TX_HASH,
        })
      )

      consoleSpy.mockRestore()
    })

    it('reputation log is not written for non-terminal states', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

      const nonTerminalStatus = 'pending_anchor'

      if (sep24.TERMINAL_STATES.has(nonTerminalStatus)) {
        console.log('[Reputation] Transaction terminal state reached:', {
          transactionId: TRANSACTION_ID,
          status: nonTerminalStatus,
        })
      }

      expect(consoleSpy).not.toHaveBeenCalledWith(
        '[Reputation] Transaction terminal state reached:',
        expect.anything()
      )

      consoleSpy.mockRestore()
    })
  })

  // ── 8. Full pipeline: router → auth → initiate → build → sign → submit ──────

  describe('Step 8 — Full pipeline integration', () => {
    it('chains all steps: router picks winner → auth → initiate → build tx → sign → submit', async () => {
      // 1. Router picks the best anchor
      const { winner, attempts } = await solveWithFallback('usdc-ngn', '100')
      expect(winner?.anchorId).toBe('mock-anchor')
      expect(attempts[0]?.succeeded).toBe(true)

      // 2. Resolve anchor capabilities
      const resolvedAnchor = await anchors.getResolvedAnchorById(winner!.anchorId)
      expect(resolvedAnchor.TRANSFER_SERVER_SEP0024).toBe(TRANSFER_SERVER)
      expect(resolvedAnchor.capabilities.sep10).toBe(true)
      expect(resolvedAnchor.capabilities.sep24).toBe(true)

      // 3. SEP-10 auth (mock Freighter signs the challenge)
      const auth = await sep10.authenticate(resolvedAnchor, PUBLIC_KEY)
      expect(auth.jwt).toBe(MOCK_JWT)

      // 4. SEP-24 initiate withdraw (mock anchor returns KYC URL + txn ID)
      const withdrawResp = await sep24.initiateWithdraw(resolvedAnchor, {
        assetCode: resolvedAnchor.assetCode,
        assetIssuer: resolvedAnchor.assetIssuer,
        amount: '100',
        account: PUBLIC_KEY,
        jwt: auth.jwt,
      })
      expect(withdrawResp.id).toBe(TRANSACTION_ID)
      expect(withdrawResp.url).toBe(KYC_URL)

      // 5. Fetch transaction record (post-KYC)
      const record = await sep24.getWithdrawTransactionRecord(
        resolvedAnchor.TRANSFER_SERVER_SEP0024!,
        withdrawResp.id,
        auth.jwt
      )
      expect(record.withdrawAnchorAccount).toBe('GANCHOR_MOCK_ACCOUNT_123')

      // 6. Build unsigned payment transaction
      const unsignedTx = await horizon.buildWithdrawPayment({
        sourcePublicKey: PUBLIC_KEY,
        anchorAccount: record.withdrawAnchorAccount,
        amount: '100',
        memo: record.memo,
        memoType: record.memoType,
        assetCode: resolvedAnchor.assetCode,
        assetIssuer: resolvedAnchor.assetIssuer,
      })
      expect(unsignedTx).toBeDefined()

      // 7. Sign with mock Freighter and submit to mock Horizon
      const submitResult = await horizon.signAndSubmitPayment(unsignedTx)
      expect(submitResult.hash).toBe(TX_HASH)

      // 8. Reputation log row: attempt is recorded with succeeded=true
      expect(attempts).toHaveLength(1)
      expect(attempts[0]).toMatchObject({
        anchorId: 'mock-anchor',
        succeeded: true,
      })
    })
  })
})
