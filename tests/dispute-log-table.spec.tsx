import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DisputeLogTable } from '@/components/disputes/DisputeLogTable';
import type { AdjudicationEntry } from '@/lib/reputation/adjudication-log';

describe('DisputeLogTable (#2134)', () => {
  it('renders empty message when no disputes exist', () => {
    render(<DisputeLogTable entries={[]} />);
    expect(screen.getByText('No disputes have been filed yet.')).toBeInTheDocument();
  });

  it('renders anchor name and category label, newest first', () => {
    const entries: AdjudicationEntry[] = [
      {
        seq: 1,
        disputeRef: 'ref-1',
        anchorId: 'cowrie',
        category: 'delayed',
        level: 'anchor',
        action: 'filed',
        rationale: 'First dispute',
        decidedAt: '2026-01-01T10:00:00Z',
        prevHash: '0'.repeat(64),
        entryHash: '1111111111111111111111111111111111111111111111111111111111111111',
      },
      {
        seq: 2,
        disputeRef: 'ref-2',
        anchorId: 'mykobo',
        category: 'wrong_amount',
        level: 'review',
        action: 'accepted',
        rationale: 'Second dispute',
        decidedAt: '2026-01-02T10:00:00Z',
        prevHash: '1111111111111111111111111111111111111111111111111111111111111111',
        entryHash: '2222222222222222222222222222222222222222222222222222222222222222',
      },
    ];

    render(<DisputeLogTable entries={entries} />);

    // Renders anchor names (Cowrie Exchange, fallback id if not registered)
    expect(screen.getAllByText('Cowrie Exchange').length).toBeGreaterThan(0);
    expect(screen.getAllByText('mykobo').length).toBeGreaterThan(0);

    // Renders category labels
    expect(screen.getAllByText('Unreasonable delay').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Wrong amount received').length).toBeGreaterThan(0);

    // Newest first check: mykobo (seq 2) appears before Cowrie Exchange (seq 1) in DOM order
    const mykoboEls = screen.getAllByText('mykobo');
    const cowrieEls = screen.getAllByText('Cowrie Exchange');
    expect(mykoboEls[0]!.compareDocumentPosition(cowrieEls[0]!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it('shows "—" for empty rationale', () => {
    const entries: AdjudicationEntry[] = [
      {
        seq: 1,
        disputeRef: 'ref-1',
        anchorId: 'cowrie',
        category: 'delayed',
        level: 'anchor',
        action: 'filed',
        rationale: '',
        decidedAt: '2026-01-01T10:00:00Z',
        prevHash: '0'.repeat(64),
        entryHash: 'abcdefabcdef1234567890abcdefabcdef1234567890abcdefabcdef1234567890',
      },
    ];

    render(<DisputeLogTable entries={entries} />);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('truncates hash to 12 chars with full hash in title', () => {
    const fullHash = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    const entries: AdjudicationEntry[] = [
      {
        seq: 1,
        disputeRef: 'ref-1',
        anchorId: 'cowrie',
        category: 'delayed',
        level: 'anchor',
        action: 'filed',
        rationale: 'Test rationale',
        decidedAt: '2026-01-01T10:00:00Z',
        prevHash: '0'.repeat(64),
        entryHash: fullHash,
      },
    ];

    render(<DisputeLogTable entries={entries} />);

    const truncated = screen.getAllByText('abcdef012345');
    expect(truncated.length).toBeGreaterThan(0);
    expect(truncated[0]).toHaveAttribute('title', fullHash);
  });
});
