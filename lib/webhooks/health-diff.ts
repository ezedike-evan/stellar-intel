import { getHealthSnapshot, setHealthSnapshot } from '@/lib/api/shared-state';
import { getAnchorHealthLedger } from '@/lib/stellar/anchors';
import { emitWebhookEvent } from './emit';
import type { WebhookEventKind } from './types';

export type HealthState = 'healthy' | 'degraded';

export interface HealthChange {
  anchorId: string;
  from: HealthState;
  to: HealthState;
}

/**
 * The anchors whose degraded flag differs between two snapshots, sorted by id.
 *
 * An anchor that is missing from `prev` was not degraded as far as anyone was told,
 * so it counts as healthy there; a newly seen anchor that is already degraded is
 * therefore a healthy to degraded change. An anchor that has left `next` is no
 * longer tracked, which is not a recovery, so it produces no change.
 */
export function diffDegraded(
  prev: Record<string, boolean>,
  next: Record<string, boolean>
): HealthChange[] {
  const changes: HealthChange[] = [];
  for (const anchorId of Object.keys(next).sort()) {
    const was = prev[anchorId] === true;
    const now = next[anchorId] === true;
    if (was !== now) {
      changes.push({
        anchorId,
        from: was ? 'degraded' : 'healthy',
        to: now ? 'degraded' : 'healthy',
      });
    }
  }
  return changes;
}

/** What `emitHealthChanges` reads and writes, injectable so tests need no database. */
export interface HealthDiffDeps {
  ledger?: () => ReturnType<typeof getAnchorHealthLedger>;
  getSnapshot?: () => Promise<string | null>;
  setSnapshot?: (json: string) => Promise<void>;
  emit?: (kind: WebhookEventKind, payload: Record<string, unknown>) => void;
}

function parseSnapshot(json: string): Record<string, boolean> | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, boolean>;
  } catch {
    return null;
  }
}

/**
 * Emits `anchor.health_status_changed` for every anchor whose degraded flag has
 * changed since the last run, and returns how many it emitted.
 *
 * The production health source is the committed nightly ledger, so a change lands
 * with a deploy; the publisher tick runs every five minutes and diffs it against the
 * snapshot it last stored. The first run, with no snapshot, stores one and emits
 * nothing: every currently degraded anchor would otherwise look newly degraded. The
 * snapshot is stored after the events are handed over, so a failure before that
 * re-sends them on the next run instead of losing them. Without a database there is
 * no snapshot to keep, so nothing is ever emitted.
 */
export async function emitHealthChanges(deps: HealthDiffDeps = {}): Promise<number> {
  const ledger = (deps.ledger ?? getAnchorHealthLedger)();
  const getSnapshot = deps.getSnapshot ?? getHealthSnapshot;
  const setSnapshot = deps.setSnapshot ?? setHealthSnapshot;
  const emit = deps.emit ?? emitWebhookEvent;

  const next: Record<string, boolean> = {};
  for (const [anchorId, health] of Object.entries(ledger.anchors)) {
    next[anchorId] = health.degraded === true;
  }

  const stored = await getSnapshot();
  const prev = stored === null ? null : parseSnapshot(stored);
  if (prev === null) {
    await setSnapshot(JSON.stringify(next));
    return 0;
  }

  const changes = diffDegraded(prev, next);
  for (const change of changes) {
    const health = ledger.anchors[change.anchorId];
    emit('anchor.health_status_changed', {
      anchorId: change.anchorId,
      from: change.from,
      to: change.to,
      lastCheckedAt: health?.lastCheckedAt ?? null,
      lastError: health?.lastError ?? null,
    });
  }

  await setSnapshot(JSON.stringify(next));
  return changes.length;
}
