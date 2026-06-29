// ─── SEP-6 Withdraw Flow State Machine ───────────────────────────────────────
//
// Pure reducer with no side effects. The caller is responsible for all I/O
// (network calls, timers). The reducer only describes valid state transitions.

// ─── States ───────────────────────────────────────────────────────────────────

export type Sep6MachineState =
  | { type: 'idle' }
  | { type: 'collecting_info'; fields: Record<string, string> }
  | { type: 'awaiting_funds'; transactionId: string }
  | { type: 'processing'; transactionId: string; anchorStatus: string }
  | { type: 'completed'; transactionId: string }
  | { type: 'failed'; transactionId?: string; reason: string }
  | { type: 'refunded'; transactionId: string };

// ─── Events ───────────────────────────────────────────────────────────────────

export type Sep6MachineEvent =
  | { type: 'INITIATE' }
  | { type: 'NEEDS_INFO'; fields: Record<string, string> }
  | { type: 'INFO_PROVIDED' }
  | { type: 'FUNDS_REQUIRED'; transactionId: string }
  | { type: 'FUNDS_SENT'; transactionId: string }
  | { type: 'POLL_UPDATE'; transactionId: string; anchorStatus: string }
  | { type: 'CANCEL' }
  | { type: 'RESET' };

// ─── Terminal state check ─────────────────────────────────────────────────────

const TERMINAL: ReadonlySet<Sep6MachineState['type']> = new Set([
  'completed',
  'failed',
  'refunded',
]);

export function isTerminal(state: Sep6MachineState): boolean {
  return TERMINAL.has(state.type);
}

// ─── Reducer ─────────────────────────────────────────────────────────────────

const FAILED_ANCHOR_STATUSES = new Set(['error', 'expired', 'no_market', 'too_small', 'too_large']);

export function sep6Reducer(state: Sep6MachineState, event: Sep6MachineEvent): Sep6MachineState {
  if (event.type === 'RESET') return { type: 'idle' };

  switch (state.type) {
    case 'idle': {
      if (event.type === 'INITIATE') return { type: 'idle' };
      if (event.type === 'NEEDS_INFO') return { type: 'collecting_info', fields: event.fields };
      if (event.type === 'FUNDS_REQUIRED')
        return { type: 'awaiting_funds', transactionId: event.transactionId };
      return state;
    }

    case 'collecting_info': {
      if (event.type === 'INFO_PROVIDED') return { type: 'idle' };
      if (event.type === 'CANCEL') return { type: 'failed', reason: 'cancelled' };
      return state;
    }

    case 'awaiting_funds': {
      if (event.type === 'FUNDS_SENT')
        return {
          type: 'processing',
          transactionId: event.transactionId,
          anchorStatus: 'pending_stellar',
        };
      if (event.type === 'CANCEL')
        return { type: 'failed', transactionId: state.transactionId, reason: 'cancelled' };
      if (event.type === 'POLL_UPDATE') {
        return applyPollUpdate(event.transactionId, event.anchorStatus);
      }
      return state;
    }

    case 'processing': {
      if (event.type === 'POLL_UPDATE') {
        return applyPollUpdate(event.transactionId, event.anchorStatus);
      }
      if (event.type === 'CANCEL')
        return { type: 'failed', transactionId: state.transactionId, reason: 'cancelled' };
      return state;
    }

    case 'completed':
    case 'failed':
    case 'refunded':
      return state;
  }
}

function applyPollUpdate(transactionId: string, anchorStatus: string): Sep6MachineState {
  if (anchorStatus === 'completed') return { type: 'completed', transactionId };
  if (anchorStatus === 'refunded') return { type: 'refunded', transactionId };
  if (FAILED_ANCHOR_STATUSES.has(anchorStatus))
    return { type: 'failed', transactionId, reason: anchorStatus };
  return { type: 'processing', transactionId, anchorStatus };
}
