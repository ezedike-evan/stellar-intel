import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import census from '@/constants/anchor-census-rows.json';

// #1322 (ANC054) — the committed census file must always satisfy the
// `AnchorCensus` shape from types/index.ts, even before the re-crawl workflow
// (ANC055) has ever populated it.

const AnchorCensusRowSchema = z.object({
  domain: z.string(),
  tier: z.enum(['routable', 'health-only', 'listed']),
  seps: z.object({
    sep6: z.boolean(),
    sep24: z.boolean(),
    sep31: z.boolean(),
    sep38: z.boolean(),
    sep10: z.boolean(),
  }),
  withdrawAssets: z.array(z.string()),
  depositAssets: z.array(z.string()),
  receiveAssets: z.array(z.string()),
  sources: z.array(z.string()),
  registeredAnchorId: z.string().nullable(),
  checkedAt: z.string(),
});

const AnchorCensusSchema = z.object({
  generatedAt: z.string().nullable(),
  sources: z.array(z.string()),
  counts: z.object({
    routable: z.number(),
    healthOnly: z.number(),
    listed: z.number(),
    excluded: z.number(),
  }),
  rows: z.array(AnchorCensusRowSchema),
});

describe('constants/anchor-census-rows.json', () => {
  it('satisfies the AnchorCensus shape', () => {
    expect(() => AnchorCensusSchema.parse(census)).not.toThrow();
  });

  it('is committed empty, pending the first re-crawl', () => {
    expect(census.generatedAt).toBeNull();
    expect(census.rows).toEqual([]);
    expect(census.counts).toEqual({ routable: 0, healthOnly: 0, listed: 0, excluded: 0 });
  });
});
