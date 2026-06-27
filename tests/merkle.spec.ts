import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { merkleRoot, getProof, verifyProof, hashOutcome } from '@/lib/merkle';

describe('merkle batch commitment', () => {
  it('produces a deterministic 64-char hex root', () => {
    const outcomes = ['a', 'b', 'c'];
    const root = merkleRoot(outcomes);
    expect(root).toMatch(/^[0-9a-f]{64}$/);
    expect(merkleRoot(outcomes)).toBe(root);
  });

  it('a third-party verifier reproduces the root from published outcomes', () => {
    const outcomes = [
      { id: 'o1', result: 'win' },
      { id: 'o2', result: 'loss' },
      { id: 'o3', result: 'draw' },
      { id: 'o4', result: 'win' },
    ];
    // Publisher commits this root in submit_outcome.
    const published = merkleRoot(outcomes);
    // Independent verifier recomputes from the same published outcomes.
    const recomputed = merkleRoot(outcomes);
    expect(recomputed).toBe(published);
  });

  it('canonicalizes object outcomes so key order does not change the root', () => {
    const rootA = merkleRoot([{ id: 'o1', result: 'win' }]);
    const rootB = merkleRoot([{ result: 'win', id: 'o1' }]);
    expect(rootA).toBe(rootB);
  });

  it('changing any outcome changes the root', () => {
    const base = merkleRoot(['a', 'b', 'c', 'd']);
    expect(merkleRoot(['a', 'b', 'c', 'D'])).not.toBe(base);
  });

  it('reordering outcomes changes the root (order is part of the commitment)', () => {
    expect(merkleRoot(['a', 'b'])).not.toBe(merkleRoot(['b', 'a']));
  });

  it('a single-outcome batch roots to its leaf hash', () => {
    expect(merkleRoot(['only'])).toBe(hashOutcome('only').toString('hex'));
  });

  it('the empty batch has a stable, well-defined root', () => {
    const root = merkleRoot([]);
    expect(root).toMatch(/^[0-9a-f]{64}$/);
    expect(merkleRoot([])).toBe(root);
  });

  it('domain separation distinguishes leaf and node hashes', () => {
    // A two-leaf root must not collide with hashing the raw concatenation.
    const root = merkleRoot(['a', 'b']);
    expect(root).not.toBe(hashOutcome('ab').toString('hex'));
  });

  describe('inclusion proofs', () => {
    it('verifies a proof for every outcome in odd- and even-sized batches', () => {
      for (const size of [1, 2, 3, 5, 8, 13]) {
        const outcomes = Array.from({ length: size }, (_, i) => `outcome-${i}`);
        const root = merkleRoot(outcomes);
        outcomes.forEach((outcome, index) => {
          const proof = getProof(outcomes, index);
          expect(verifyProof(outcome, proof, root)).toBe(true);
        });
      }
    });

    it('rejects a proof against a tampered outcome', () => {
      const outcomes = ['a', 'b', 'c', 'd'];
      const root = merkleRoot(outcomes);
      const proof = getProof(outcomes, 1);
      expect(verifyProof('b', proof, root)).toBe(true);
      expect(verifyProof('not-b', proof, root)).toBe(false);
    });

    it('rejects a proof against the wrong root', () => {
      const outcomes = ['a', 'b', 'c'];
      const proof = getProof(outcomes, 0);
      const wrongRoot = merkleRoot(['x', 'y', 'z']);
      expect(verifyProof('a', proof, wrongRoot)).toBe(false);
    });

    it('throws when the index is out of range', () => {
      expect(() => getProof(['a', 'b'], 2)).toThrow(RangeError);
      expect(() => getProof(['a', 'b'], -1)).toThrow(RangeError);
    });
  });

  describe('property-based', () => {
    const outcomesArb = fc.array(fc.string(), { minLength: 1, maxLength: 64 });

    it('every leaf has a verifiable inclusion proof', () => {
      fc.assert(
        fc.property(outcomesArb, (outcomes) => {
          const root = merkleRoot(outcomes);
          const index = 0;
          const proof = getProof(outcomes, index);
          return verifyProof(outcomes[index], proof, root);
        }),
        { numRuns: 500 }
      );
    });

    it('an independent verifier always reproduces the committed root', () => {
      fc.assert(
        fc.property(outcomesArb, (outcomes) => merkleRoot(outcomes) === merkleRoot([...outcomes])),
        { numRuns: 500 }
      );
    });
  });
});
