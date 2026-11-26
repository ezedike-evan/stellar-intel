import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withRequestLogger } from '@/lib/logger';
import { enforceRateLimit, apiSuccessResponse, withApiHeaders } from '@/lib/api/response';
import { RefundAckPayloadSchema, hashRefundAck } from '@/lib/refunds/ack';
import { getRefundStore } from '@/lib/refunds/store';
import { verifyIntentSignature } from '@/lib/intent/verify';
import { compareDecimals } from '@/lib/decimal';
import { verifyRefundPayments } from '@/lib/refunds/verify-onchain';
import type { RefundOnChainCheck } from '@/lib/refunds/store';

export const runtime = 'nodejs';

// ─── POST /api/refunds/ack (Issue #2117 / RFD006) ───────────────────────────
//
// Secured write route to record a user-signed refund acknowledgement.
// Only the Stellar account that signed the original transfer can acknowledge
// its refund, and the server verifies cryptographic proof over the canonical
// payload and ensures the refund amount does not exceed what was paid.

const AckRequestBodySchema = z
  .object({
    ack: RefundAckPayloadSchema,
    signature: z.string().min(1).max(256),
  })
  .strict();

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code: string;
  message: string;
}

function problemResponse(
  status: number,
  title: string,
  detail?: string,
  type?: string
): NextResponse {
  const defaultType = `https://stellar-intel.com/errors/${title.toLowerCase().replace(/\s+/g, '-')}`;
  const code = title.toUpperCase().replace(/\s+/g, '_');
  const body: ProblemDetails = {
    type: type ?? defaultType,
    title,
    status,
    ...(detail !== undefined ? { detail } : {}),
    code,
    message: detail ?? title,
  };
  return withApiHeaders(
    NextResponse.json(body, {
      status,
      headers: {
        'Content-Type': 'application/problem+json',
      },
    })
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.refunds.ack', async (logger) => {
    // Step 1: Rate limiting using bucket api.refunds.ack (maxRequests: 20)
    const limited = await enforceRateLimit(request, {
      bucket: 'api.refunds.ack',
      maxRequests: 20,
    });
    if (limited) return limited;

    // Step 2: Request parsing
    const body: unknown = await request.json().catch(() => null);
    if (body === null || typeof body !== 'object') {
      logger.warn({ event: 'refund_ack_invalid_json' });
      return problemResponse(
        400,
        'Invalid JSON',
        'Request body must be valid JSON',
        'https://stellar-intel.com/errors/invalid-json'
      );
    }

    // Step 3: Schema validation
    const parsed = AckRequestBodySchema.safeParse(body);
    if (!parsed.success) {
      logger.warn({ event: 'refund_ack_validation_failed' });
      const firstIssue = parsed.error.issues[0];
      const detail = firstIssue
        ? `${firstIssue.path.join('.')}: ${firstIssue.message}`
        : 'Validation Error';
      return problemResponse(
        422,
        'Validation Error',
        detail,
        'https://stellar-intel.com/errors/validation-error'
      );
    }

    const { ack, signature } = parsed.data;

    // Step 4: Store lookup
    const store = getRefundStore();
    const cases = await store.getByIntentHash(ack.intentHash);

    if (cases.length === 0) {
      logger.warn({ event: 'refund_ack_not_found', intentHash: ack.intentHash });
      return problemResponse(
        404,
        'No Refund Case',
        'No refund case found for this intentHash',
        'https://stellar-intel.com/errors/not-found'
      );
    }

    const nonAckedCase = cases.find((c) => c.status !== 'acknowledged');
    if (!nonAckedCase) {
      logger.warn({ event: 'refund_ack_conflict', intentHash: ack.intentHash });
      return problemResponse(
        409,
        'Already Acknowledged',
        'Refund case has already been acknowledged',
        'https://stellar-intel.com/errors/already-acknowledged'
      );
    }

    const caseRecord = nonAckedCase;

    // Step 5: Signer and Anchor validation
    if (caseRecord.signerAccount !== ack.account) {
      logger.warn({ event: 'refund_ack_signer_mismatch', intentHash: ack.intentHash });
      return problemResponse(
        403,
        'Forbidden',
        'Only the account that signed the transfer can acknowledge its refund',
        'https://stellar-intel.com/errors/forbidden'
      );
    }

    if (caseRecord.anchorId !== ack.anchorId) {
      logger.warn({ event: 'refund_ack_validation_failed', intentHash: ack.intentHash });
      return problemResponse(
        422,
        'Validation Error',
        'Anchor ID mismatch',
        'https://stellar-intel.com/errors/validation-error'
      );
    }

    // Step 6: Cryptographic signature verification
    const hash = await hashRefundAck(ack);
    const valid = verifyIntentSignature({
      intentHash: hash,
      publicKey: ack.account,
      signature,
    });

    if (!valid) {
      logger.warn({ event: 'refund_ack_signature_failed', intentHash: ack.intentHash });
      return problemResponse(
        401,
        'Unauthorized',
        'Invalid signature for refund acknowledgement',
        'https://stellar-intel.com/errors/unauthorized'
      );
    }

    // Step 7: Amount comparison
    if (compareDecimals(ack.amountRefunded, caseRecord.amountPaid) > 0) {
      logger.warn({ event: 'refund_ack_validation_failed', intentHash: ack.intentHash });
      return problemResponse(
        422,
        'Validation Error',
        'amountRefunded exceeds the amount paid',
        'https://stellar-intel.com/errors/validation-error'
      );
    }

    // Step 8: On-chain verification (Issue #2118). Withdraw refunds are paid
    // back on Stellar and can be checked on Horizon; deposit refunds are fiat.
    let onChainCheck: RefundOnChainCheck = 'unverifiable';
    if (caseRecord.direction === 'withdraw') {
      onChainCheck = await verifyRefundPayments({
        account: ack.account,
        assetCode: (caseRecord.corridor.split('-')[0] ?? '').toUpperCase(),
        payments: ack.payments,
      });
      if (onChainCheck === 'mismatch') {
        // The user's signature stands; record the ack but flag the mismatch.
        logger.warn({ event: 'refund_ack_onchain_mismatch', intentHash: ack.intentHash });
      }
    }

    // Step 9: State transition in store
    const updated = await store.acknowledge(caseRecord.id, {
      amountRefunded: ack.amountRefunded,
      refundFee: ack.refundFee,
      payments: ack.payments.map((p) => ({
        id: p.id,
        idType: p.idType,
        amount: p.amount,
        fee: '0',
      })),
      ackHash: hash,
      ackSignature: signature,
      acknowledgedAt: new Date().toISOString(),
      onChainCheck,
    });

    if (updated === null) {
      logger.warn({ event: 'refund_ack_conflict', intentHash: ack.intentHash });
      return problemResponse(
        409,
        'Already Acknowledged',
        'Refund case has already been acknowledged',
        'https://stellar-intel.com/errors/already-acknowledged'
      );
    }

    // Step 10: Sanitized response (ZERO key/signature leakage)
    logger.info({ event: 'refund_acknowledged', intentHash: ack.intentHash });

    return apiSuccessResponse({
      id: updated.id,
      intentHash: updated.intentHash,
      status: 'acknowledged' as const,
      acknowledgedAt: updated.acknowledgedAt,
      onChainCheck: updated.onChainCheck,
    });
  });
}
