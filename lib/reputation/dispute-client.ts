import {
  type DisputeCategory,
  DISPUTE_CATEGORY_LABELS,
} from '@/lib/reputation/dispute-ladder';

export interface SubmitDisputeInput {
  intentHash: string;
  publicKey: string;
  signature: string;
  anchorId: string;
  category: DisputeCategory;
  notes: string;
}

export class DisputeSubmitError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'DisputeSubmitError';
  }
}

export async function submitDispute(
  input: SubmitDisputeInput,
  fetchImpl: typeof fetch = fetch
): Promise<{ id: string; ref: string }> {
  const reason = input.notes.trim() || DISPUTE_CATEGORY_LABELS[input.category];

  const res = await fetchImpl('/api/reputation/dispute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intentHash: input.intentHash,
      publicKey: input.publicKey,
      signature: input.signature,
      anchorId: input.anchorId,
      category: input.category,
      reason,
    }),
  });

  if (res.status === 201) {
    const data = (await res.json()) as { id: string; ref: string };
    return { id: data.id, ref: data.ref };
  }

  if (res.status === 404) {
    throw new DisputeSubmitError(
      "Your transfer's outcome has not been recorded yet. Try again in a minute.",
      404
    );
  }

  if (res.status === 409) {
    throw new DisputeSubmitError('A dispute for this transfer is already open.', 409);
  }

  if (res.status === 429) {
    throw new DisputeSubmitError('Too many disputes from this wallet today.', 429);
  }

  if (res.status === 403) {
    throw new DisputeSubmitError('Only the wallet that made this transfer can dispute it.', 403);
  }

  let message = 'Could not submit the dispute.';
  try {
    const body = (await res.json()) as { message?: string };
    if (body?.message) {
      message = body.message;
    }
  } catch {
    // Keep fallback
  }

  throw new DisputeSubmitError(message, res.status);
}
