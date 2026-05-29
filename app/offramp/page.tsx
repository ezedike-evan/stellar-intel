'use client'
import { useState, useCallback, useEffect } from 'react'
import { TERMINAL_STATES } from '@/lib/stellar/sep24'
import { WalletButton } from '@/components/ui/WalletButton'
import { AmountInput } from '@/components/ui/AmountInput'
import { CorridorSelector } from '@/components/ui/CorridorSelector'
import { RateTable } from '@/components/offramp/RateTable'
import { ExecuteDrawer } from '@/components/offramp/ExecuteDrawer'
import { StatusTracker } from '@/components/offramp/StatusTracker'
import { useAnchorRates } from '@/hooks/useAnchorRates'
import { useFreighter } from '@/hooks/useFreighter'
import { useWithdrawStatus } from '@/hooks/useWithdrawStatus'
import type { AnchorRate } from '@/types'

export default function OfframpPage() {
  const [corridorId, setCorridorId] = useState('usdc-ngn')
  const [amount, setAmount] = useState('100')
  const [selectedRate, setSelectedRate] = useState<AnchorRate | null>(null)

  // Post-execute status tracking
  const [trackingTransactionId, setTrackingTransactionId] = useState<string | null>(null)
  const [trackingTransferServer, setTrackingTransferServer] = useState<string | null>(null)
  const [trackingJwt, setTrackingJwt] = useState<string | null>(null)

  const { isConnected, publicKey } = useFreighter()
  const { rates, isLoading, error, mutate, refreshInflight } = useAnchorRates(corridorId, amount)

  const withdrawStatus = useWithdrawStatus(
    trackingTransferServer,
    trackingTransactionId,
    trackingJwt
  )

  const handleSelectAnchor = useCallback((rate: AnchorRate) => {
    setSelectedRate(rate)
  }, [])

  const handleDrawerClose = useCallback(() => {
    setSelectedRate(null)
  }, [])

  const handleExecuteStarted = useCallback(
    (transactionId: string, transferServer: string, jwt: string) => {
      setTrackingTransactionId(transactionId)
      setTrackingTransferServer(transferServer)
      setTrackingJwt(jwt)
    },
    []
  )

  // Reputation writer hook: trigger when transaction reaches terminal state
  useEffect(() => {
    if (withdrawStatus.status && TERMINAL_STATES.has(withdrawStatus.status)) {
      console.log('[Reputation] Transaction terminal state reached:', {
        transactionId: trackingTransactionId,
        status: withdrawStatus.status,
        amountIn: withdrawStatus.amountIn,
        amountInAsset: withdrawStatus.amountInAsset,
        amountOut: withdrawStatus.amountOut,
        amountOutAsset: withdrawStatus.amountOutAsset,
        amountFee: withdrawStatus.amountFee,
        stellarTransactionId: withdrawStatus.stellarTransactionId,
        externalTransactionId: withdrawStatus.externalTransactionId,
        timestamp: new Date().toISOString(),
      })
    }
  }, [withdrawStatus.status, withdrawStatus.amountIn, withdrawStatus.amountOut, withdrawStatus.amountFee, withdrawStatus.stellarTransactionId, withdrawStatus.externalTransactionId, trackingTransactionId])

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Off-ramp Comparator</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Compare USDC withdrawal rates across Stellar anchors in real time
          </p>
        </div>
        <WalletButton />
      </div>

      {/* Inputs row */}
      <div className="grid grid-cols-1 gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50 sm:grid-cols-2">
        <CorridorSelector value={corridorId} onChange={setCorridorId} />
        <AmountInput value={amount} onChange={setAmount} />
      </div>

      {/* Not connected notice */}
      {!isConnected && (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800 dark:border-yellow-800/40 dark:bg-yellow-950/20 dark:text-yellow-300">
          Connect your Freighter wallet to execute an off-ramp.
        </div>
      )}

      {/* Rate table */}
      <div>
        <RateTable
          rates={rates}
          isLoading={isLoading}
          refreshInflight={refreshInflight}
          error={error}
          onSelectAnchor={handleSelectAnchor}
          onRefresh={() => mutate()}
        />
      </div>

      {/* Status tracker — shown after execute */}
      {trackingTransactionId && (
        <StatusTracker
          transactionId={trackingTransactionId}
          status={withdrawStatus.status}
          amountIn={withdrawStatus.amountIn}
          amountInAsset={withdrawStatus.amountInAsset}
          amountOut={withdrawStatus.amountOut}
          amountOutAsset={withdrawStatus.amountOutAsset}
          amountFee={withdrawStatus.amountFee}
          currencyCode={corridorId.split('-')[1]?.toUpperCase() ?? 'USD'}
          stellarTransactionId={withdrawStatus.stellarTransactionId}
          externalTransactionId={withdrawStatus.externalTransactionId}
          isLoading={withdrawStatus.isLoading}
          error={withdrawStatus.error}
        />
      )}

      {/* Execute drawer */}
      <ExecuteDrawer
        rate={selectedRate}
        amount={amount}
        publicKey={publicKey ?? ''}
        onClose={handleDrawerClose}
        onExecuteStarted={handleExecuteStarted}
      />
    </div>
  )
}
