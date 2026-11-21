/**
 * lib/audit/record.ts
 *
 * Fire-and-forget audit event recorder (AGS013).
 */

import { getLogger } from '@/lib/logger';
import { getAuditStore } from './store';
import type { AuditEvent } from './types';

const INTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;
const ACTION_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;
const APPEND_FAIL_THROTTLE_MS = 60_000;

let lastAppendFailLog = 0;
const pendingAppends = new Set<Promise<void>>();

export function recordAuditEvent(input: Omit<AuditEvent, 'id' | 'at'> & { at?: string }): void {
  const at = input.at ?? new Date().toISOString();
  const id = globalThis.crypto.randomUUID();

  const intentHash =
    input.intentHash && INTENT_HASH_PATTERN.test(input.intentHash) ? input.intentHash : null;
  const action =
    input.action && ACTION_PATTERN.test(input.action) ? input.action : 'unknown';

  const event: AuditEvent = {
    ...input,
    id,
    at,
    intentHash,
    action,
  };

  const promise = (async () => {
    try {
      await getAuditStore().append(event);
    } catch (err) {
      const now = Date.now();
      if (now - lastAppendFailLog >= APPEND_FAIL_THROTTLE_MS) {
        lastAppendFailLog = now;
        getLogger('audit').warn(
          { event: 'audit_append_failed', error: err instanceof Error ? err.message : String(err) },
          'Failed to append audit event'
        );
      }
    }
  })();

  pendingAppends.add(promise);
  promise.finally(() => {
    pendingAppends.delete(promise);
  });
}

export async function flushAuditEvents(): Promise<void> {
  await Promise.all([...pendingAppends]);
}
