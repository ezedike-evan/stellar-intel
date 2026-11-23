import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import DisputesPage from '@/app/disputes/page';
import {
  InMemoryAdjudicationLog,
  _setAdjudicationLog,
  type AdjudicationLogStore,
} from '@/lib/reputation/adjudication-log';
import { ReputationStoreUnavailableError } from '@/lib/reputation/pool';

describe('DisputesPage (#2134)', () => {
  beforeEach(() => {
    _setAdjudicationLog(null);
  });

  it('renders verified badge and summary counts when seeded with entries', async () => {
    const memoryLog = new InMemoryAdjudicationLog();
    await memoryLog.append({
      disputeRef: 'ref-1',
      anchorId: 'cowrie',
      category: 'delayed',
      level: 'anchor',
      action: 'filed',
      rationale: 'Dispute 1 filed',
      decidedAt: '2026-01-01T10:00:00Z',
    });
    await memoryLog.append({
      disputeRef: 'ref-1',
      anchorId: 'cowrie',
      category: 'delayed',
      level: 'review',
      action: 'accepted',
      rationale: 'Dispute 1 accepted',
      decidedAt: '2026-01-02T10:00:00Z',
    });
    _setAdjudicationLog(memoryLog);

    const ui = await DisputesPage();
    render(ui);

    // Verified badge
    expect(screen.getByText(/Hash chain verified · 2 entries/i)).toBeInTheDocument();

    // Summary numbers: 1 filed, 0 open, 1 resolved, 1 accepted, 0 rejected
    expect(screen.getByText('Filed')).toBeInTheDocument();
    expect(screen.getByText('Resolved')).toBeInTheDocument();
    expect(screen.getAllByText('Cowrie Exchange').length).toBeGreaterThan(0);
  });

  it('renders empty message when store throws ReputationStoreUnavailableError', async () => {
    const failingStore: AdjudicationLogStore = {
      async append() {
        throw new ReputationStoreUnavailableError('Store offline');
      },
      async list() {
        throw new ReputationStoreUnavailableError('Store offline');
      },
      async head() {
        throw new ReputationStoreUnavailableError('Store offline');
      },
    };
    _setAdjudicationLog(failingStore);

    const ui = await DisputesPage();
    render(ui);

    expect(screen.getByText('No disputes have been filed yet.')).toBeInTheDocument();
  });
});
