import { z } from 'zod';
import { Keypair } from '@stellar/stellar-sdk';
import {
  type StoredStandingAuthorization,
  type StandingAuthorizationStatus,
} from '@/types/recurring';

export const RecurringControlSchema = z.object({
  action: z.enum(['pause', 'resume', 'cancel']),
  timestamp: z.number().int().positive(),
  nonce: z.string().min(1),
  signature: z.string().min(1),
});

export type RecurringControl = z.infer<typeof RecurringControlSchema>;

export function applyControlAction(
  auth: StoredStandingAuthorization,
  action: 'pause' | 'resume' | 'cancel'
): { ok: true; nextStatus: StandingAuthorizationStatus } | { ok: false; message: string } {
  if (auth.status === 'cancelled') {
    return { ok: false, message: 'Cannot modify a cancelled standing authorization' };
  }
  if (auth.status === 'completed') {
    return { ok: false, message: 'Cannot modify a completed standing authorization' };
  }

  if (action === 'pause') {
    if (auth.status === 'paused') {
      return { ok: false, message: 'Standing authorization is already paused' };
    }
    return { ok: true, nextStatus: 'paused' };
  }

  if (action === 'resume') {
    if (auth.status !== 'paused') {
      return { ok: false, message: 'Standing authorization is not paused' };
    }
    return { ok: true, nextStatus: 'active' };
  }

  if (action === 'cancel') {
    return { ok: true, nextStatus: 'cancelled' };
  }

  return { ok: false, message: `Unknown control action: ${action}` };
}

export function verifyControlSignature(
  senderPublicKey: string,
  payload: { authorizationId: string; action: string; timestamp: number; nonce: string },
  signature: string
): boolean {
  try {
    const kp = Keypair.fromPublicKey(senderPublicKey);
    const text = `${payload.authorizationId}:${payload.action}:${payload.timestamp}:${payload.nonce}`;
    const dataBytes = new TextEncoder().encode(text);
    const sigBytes = Buffer.from(signature, 'base64');
    return kp.verify(dataBytes, sigBytes);
  } catch {
    return false;
  }
}
