import { TransactionBuilder, Networks, Asset, Operation, Memo, BASE_FEE } from '@stellar/stellar-sdk'
import { fetchAccount, horizonServer } from './horizon'

export interface BuildIntentCommitmentParams {
  sourcePublicKey: string
  anchorAccount: string
  amount: string
  assetCode: string
  assetIssuer: string
  intentHash: string
  deadline: number // Unix timestamp in seconds
}

export async function buildIntentCommitmentTx(
  params: BuildIntentCommitmentParams
): Promise<ReturnType<TransactionBuilder['build']>> {
  const { sourcePublicKey, anchorAccount, amount, assetCode, assetIssuer, intentHash, deadline } = params

  const account = await fetchAccount(sourcePublicKey)
  const asset = new Asset(assetCode, assetIssuer)

  let recommendedFee = parseInt(BASE_FEE, 10)
  try {
    recommendedFee = await horizonServer.fetchBaseFee()
  } catch {
    // fallback to BASE_FEE
  }

  const fee = Math.min(recommendedFee, 10000).toString()

  const builder = new TransactionBuilder(account, {
    fee,
    networkPassphrase: Networks.PUBLIC,
    timebounds: { minTime: 0, maxTime: deadline.toString() },
  })

  builder.addOperation(
    Operation.payment({
      destination: anchorAccount,
      asset,
      amount,
    })
  )

  builder.addMemo(Memo.hash(intentHash))

  return builder.build()
}
