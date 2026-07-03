import { createHash } from 'crypto';

/**
 * Merkle commitment helpers for batch outcome submissions.
 *
 * Each batch submission publishes a single Merkle root computed over the SHA-256
 * hashes of the underlying outcomes. A third party can later reproduce the root
 * from the published outcomes (acceptance criterion) and, given an inclusion
 * proof, verify that any individual outcome was part of the committed batch.
 *
 * Domain separation follows the RFC 6962 (Certificate Transparency) convention:
 * leaf hashes are prefixed with 0x00 and internal node hashes with 0x01. This
 * prevents second-preimage attacks where an internal node could be presented as
 * a leaf (or vice versa).
 */

// ─── Domain-separation prefixes ────────────────────────────────────────────────

const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);

// ─── Hashing primitives ────────────────────────────────────────────────────────

/**
 * Hashes a single outcome into its leaf digest.
 *
 * Outcomes are canonicalized to bytes before hashing:
 *   - `Buffer` / `Uint8Array` are hashed as-is.
 *   - `string` is encoded as UTF-8.
 *   - Any other value is canonicalized to JSON with sorted top-level keys so the
 *     same logical outcome always produces the same leaf regardless of key order.
 */
export function hashOutcome(outcome: unknown): Buffer {
  let bytes: Buffer;
  if (Buffer.isBuffer(outcome)) {
    bytes = outcome;
  } else if (outcome instanceof Uint8Array) {
    bytes = Buffer.from(outcome);
  } else if (typeof outcome === 'string') {
    bytes = Buffer.from(outcome, 'utf8');
  } else {
    bytes = Buffer.from(canonicalize(outcome), 'utf8');
  }
  return createHash('sha256').update(LEAF_PREFIX).update(bytes).digest();
}

/** Hashes two child node digests into their parent digest. */
function hashNodes(left: Buffer, right: Buffer): Buffer {
  return createHash('sha256').update(NODE_PREFIX).update(left).update(right).digest();
}

/**
 * Produces a deterministic JSON string with top-level keys sorted alphabetically,
 * mirroring the canonicalization used by the signed-intent envelope so the same
 * outcome always hashes to the same bytes regardless of insertion order.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return JSON.stringify(value);
  }
  const sorted = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
  );
  return JSON.stringify(sorted);
}

// ─── Tree construction ─────────────────────────────────────────────────────────

/**
 * Computes the Merkle root over an ordered list of outcomes and returns it as a
 * lowercase hex string. This is the value embedded in the batch `submit_outcome`
 * commitment.
 *
 * The empty batch commits to the SHA-256 of the empty string, giving a stable,
 * well-defined root rather than throwing.
 *
 * @throws if any computed level is malformed (should never happen for valid input).
 */
export function merkleRoot(outcomes: readonly unknown[]): string {
  return computeRoot(outcomes.map(hashOutcome)).toString('hex');
}

/**
 * Computes the Merkle root over already-hashed leaves. Odd levels promote the
 * final unpaired node to the next level unchanged (Bitcoin-style duplication is
 * intentionally avoided to keep proofs unambiguous).
 */
function computeRoot(leaves: Buffer[]): Buffer {
  if (leaves.length === 0) {
    return createHash('sha256').update(Buffer.alloc(0)).digest();
  }

  let level = leaves;
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      if (left === undefined) continue; // unreachable: i is always in bounds
      const right = level[i + 1];
      next.push(right === undefined ? left : hashNodes(left, right));
    }
    level = next;
  }

  const root = level[0];
  if (root === undefined) {
    throw new Error('merkle: non-empty batch produced no root');
  }
  return root;
}

// ─── Inclusion proofs ──────────────────────────────────────────────────────────

/** A single step in a Merkle inclusion proof. */
export interface ProofStep {
  /** Sibling digest, hex-encoded. */
  hash: string;
  /** Whether the sibling sits to the left of the current node. */
  left: boolean;
}

/**
 * Builds an inclusion proof for the outcome at `index` within `outcomes`.
 * The returned steps, replayed against the leaf hash, reproduce the root.
 *
 * @throws RangeError if `index` is out of bounds.
 */
export function getProof(outcomes: readonly unknown[], index: number): ProofStep[] {
  if (index < 0 || index >= outcomes.length) {
    throw new RangeError(`index ${index} out of range for batch of ${outcomes.length}`);
  }

  let level = outcomes.map(hashOutcome);
  let position = index;
  const proof: ProofStep[] = [];

  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      if (left === undefined) continue; // unreachable: i is always in bounds
      const right = level[i + 1];
      if (right !== undefined) {
        next.push(hashNodes(left, right));
        if (i === position) {
          proof.push({ hash: right.toString('hex'), left: false });
        } else if (i + 1 === position) {
          proof.push({ hash: left.toString('hex'), left: true });
        }
      } else {
        next.push(left);
        // Unpaired node is promoted unchanged; no proof step is added.
      }
    }
    position = Math.floor(position / 2);
    level = next;
  }

  return proof;
}

/**
 * Reproduces the Merkle root from a published outcome and its inclusion proof,
 * then compares it against the committed root. This is the third-party verifier
 * entry point: it needs only the outcome, the proof, and the published root.
 */
export function verifyProof(outcome: unknown, proof: readonly ProofStep[], root: string): boolean {
  let acc = hashOutcome(outcome);
  for (const step of proof) {
    const sibling = Buffer.from(step.hash, 'hex');
    acc = step.left ? hashNodes(sibling, acc) : hashNodes(acc, sibling);
  }
  return acc.toString('hex') === root;
}
