import { createGraphQLError } from 'graphql-yoga';
import {
  ANCHORS,
  getAnchorById,
  getAnchorsByCorridorId,
  getAnchorHealth,
  getDegradedAnchorIds,
  isAnchorDegraded,
  isValidCorridorId,
} from '@/lib/stellar/anchors';
import { resolveCorridorRates } from '@/lib/api/rates-resolver';
import { getPublisherHealth, getMetricsSnapshot } from '@/lib/metrics';
import { IntentSchema, createOfframpIntent } from '@/lib/intent/offramp';
import { AMOUNT_PATTERN } from '@/lib/patterns';
import type { Anchor, AnchorRate } from '@/types';
import type { Intent } from '@/lib/intent/hash';

// ─── Shared field resolvers ────────────────────────────────────────────────────

function toGraphAnchor(anchor: Anchor) {
  return { ...anchor, degraded: isAnchorDegraded(anchor.id) };
}

function toGraphRate(rate: AnchorRate) {
  return {
    ...rate,
    updatedAt: rate.updatedAt.toISOString(),
    expiresAt: rate.expiresAt ? rate.expiresAt.toISOString() : null,
  };
}

// ─── Query ──────────────────────────────────────────────────────────────────────

function resolveAnchor(_root: unknown, args: { id: string }) {
  try {
    return toGraphAnchor(getAnchorById(args.id));
  } catch {
    return null;
  }
}

function resolveAnchors(_root: unknown, args: { corridorId?: string | null }) {
  const anchors = args.corridorId ? getAnchorsByCorridorId(args.corridorId) : ANCHORS;
  return anchors.map(toGraphAnchor);
}

async function resolveRates(
  _root: unknown,
  args: { corridor: string; amount?: string | null; forceRefresh?: boolean | null }
) {
  if (!isValidCorridorId(args.corridor)) {
    throw createGraphQLError(`Unknown corridor: "${args.corridor}"`, {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }

  const amount = args.amount ?? '100';
  if (!AMOUNT_PATTERN.test(amount) || Number(amount) <= 0) {
    throw createGraphQLError('amount must be a positive decimal string', {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }

  const { comparison } = await resolveCorridorRates(args.corridor, amount, {
    forceRefresh: args.forceRefresh ?? false,
  });

  return { ...comparison, rates: comparison.rates.map(toGraphRate) };
}

function resolveHealth() {
  const degradedAnchors = getDegradedAnchorIds().map((anchorId) => {
    const health = getAnchorHealth(anchorId);
    return {
      anchorId,
      degraded: true,
      lastCheckedAt: health?.lastCheckedAt ?? null,
      lastStatus: health?.lastStatus ?? null,
    };
  });

  const publisher = getPublisherHealth();
  const { ratesCache } = getMetricsSnapshot();

  return { degradedAnchors, publisher, ratesCache };
}

// ─── Mutation ─────────────────────────────────────────────────────────────────

async function resolveSubmitOfframpIntent(
  _root: unknown,
  args: {
    input: {
      sourceAsset: string;
      destinationAsset: string;
      amount: string;
      sender: string;
      recipient: string;
    };
  }
) {
  const parsed = IntentSchema.safeParse({ type: 'offramp', ...args.input });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw createGraphQLError(first?.message ?? 'Invalid intent payload', {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }

  const result = await createOfframpIntent(parsed.data as Intent);
  if (!result.ok) {
    throw createGraphQLError(result.message, { extensions: { code: result.code } });
  }
  return result.response;
}

export const resolvers = {
  Query: {
    anchor: resolveAnchor,
    anchors: resolveAnchors,
    rates: resolveRates,
    health: resolveHealth,
  },
  Mutation: {
    submitOfframpIntent: resolveSubmitOfframpIntent,
  },
};
