import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Keypair, Networks, TransactionBuilder, Account } from '@stellar/stellar-sdk'
import { buildWithdrawPayment, signAndSubmitPayment, horizonServer } from '@/lib/stellar/horizon'

vi.mock('@stellar/freighter-api', () => ({
  signTransaction: vi.fn(),
}))

const sourceKeypair = Keypair.random()
const INTENT_FIXTURE = {
  sourcePublicKey: sourceKeypair.publicKey(),
  anchorAccount: Keypair.random().publicKey(),
  amount: '42.5',
  memo: 'intent-memo',
  memoType: 'text',
  assetCode: 'USDC',
  assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
}

const mockAccount = new Account(sourceKeypair.publicKey(), '1234567890') as unknown as Awaited<ReturnType<typeof horizonServer.loadAccount>>

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('Intent end-to-end round trip', () => {
  it('builds a withdrawal intent, signs it with Freighter, and verifies it on the server', async () => {
    vi.spyOn(horizonServer, 'loadAccount').mockResolvedValue(mockAccount)
    vi.spyOn(horizonServer, 'fetchBaseFee').mockResolvedValue(100)

    const freighter = await import('@stellar/freighter-api')
    vi.mocked(freighter.signTransaction).mockImplementation(async (transactionXdr: string, opts: { networkPassphrase: string }) => {
      const tx = TransactionBuilder.fromXDR(transactionXdr, opts.networkPassphrase)
      tx.sign(sourceKeypair)
      return {
        signedTxXdr: tx.toXDR(),
        signerAddress: sourceKeypair.publicKey(),
      }
    })

    const serverVerify = vi.spyOn(horizonServer, 'submitTransaction').mockImplementation(async (signedTx: any) => {
      const parsed = TransactionBuilder.fromXDR(signedTx.toXDR(), Networks.PUBLIC)
      const signature = (parsed.signatures[0] as any).signature()
      expect(signature).toBeDefined()
      expect(
        Keypair.fromPublicKey(sourceKeypair.publicKey()).verify(parsed.hash(), signature)
      ).toBe(true)
      expect(parsed.operations).toHaveLength(1)
      expect(parsed.operations[0].type).toBe('payment')
      expect(parsed.memo.value).toBe(INTENT_FIXTURE.memo)

      return {
        successful: true,
        hash: 'INTENT-E2E-MOCK-HASH',
        ledger: 123,
      } as any
    })

    const tx = await buildWithdrawPayment(INTENT_FIXTURE)
    expect(tx.operations[0].type).toBe('payment')
    expect(tx.memo.value).toBe(INTENT_FIXTURE.memo)

    const result = await signAndSubmitPayment(tx)
    expect(result.successful).toBe(true)
    expect(serverVerify).toHaveBeenCalledTimes(1)
  })
})
