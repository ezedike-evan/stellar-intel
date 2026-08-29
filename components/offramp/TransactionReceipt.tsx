import { STELLAR_EXPERT_URL } from '@/constants';

interface TransactionReceiptProps {
  transactionId: string;
  amountIn: string | undefined;
  amountInAsset: string | undefined;
  amountOut: string | undefined;
  amountOutAsset: string | undefined;
  amountFee: string | undefined;
  currencyCode: string;
  stellarTransactionId: string | undefined;
  anchorHomeDomain: string | undefined;
}

function parseAssetCode(assetStr: string | undefined): string | null {
  if (!assetStr) return null;
  if (assetStr === 'stellar:native') return 'XLM';
  return assetStr.split(':')[1] ?? null;
}

/**
 * Print-only transaction summary. Hidden on screen — only rendered visibly
 * by the `.receipt` print CSS (styles/print.css) when the user prints via
 * the 'Download receipt' button's window.print() call.
 */
export function TransactionReceipt({
  transactionId,
  amountIn,
  amountInAsset,
  amountOut,
  amountOutAsset,
  amountFee,
  currencyCode,
  stellarTransactionId,
  anchorHomeDomain,
}: TransactionReceiptProps) {
  const sentAsset = parseAssetCode(amountInAsset) || 'USDC';
  const receivedAsset = parseAssetCode(amountOutAsset) || currencyCode;
  const rate =
    amountIn && amountOut && Number(amountIn) > 0
      ? (Number(amountOut) / Number(amountIn)).toFixed(4)
      : null;

  return (
    <div className="receipt">
      <h1>Stellar Intel — Off-ramp Receipt</h1>
      <p>Date: {new Date().toLocaleString()}</p>
      <dl>
        <dt>Transaction ID</dt>
        <dd>{transactionId}</dd>
        {anchorHomeDomain && (
          <>
            <dt>Anchor</dt>
            <dd>{anchorHomeDomain}</dd>
          </>
        )}
        {amountIn && (
          <>
            <dt>Sent</dt>
            <dd>
              {amountIn} {sentAsset}
            </dd>
          </>
        )}
        {amountFee && (
          <>
            <dt>Fee</dt>
            <dd>
              {amountFee} {sentAsset}
            </dd>
          </>
        )}
        {amountOut && (
          <>
            <dt>Received</dt>
            <dd>
              {amountOut} {receivedAsset}
            </dd>
          </>
        )}
        {rate && (
          <>
            <dt>Rate</dt>
            <dd>
              1 {sentAsset} = {rate} {receivedAsset}
            </dd>
          </>
        )}
        {stellarTransactionId && (
          <>
            <dt>Stellar transaction</dt>
            <dd>
              {stellarTransactionId}
              <br />
              {STELLAR_EXPERT_URL}/tx/{stellarTransactionId}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}
