import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import WebhooksDocsPage, { metadata } from '@/app/docs/webhooks/page';
import { WEBHOOK_EVENT_KINDS } from '@/lib/webhooks/schema';

describe('Webhooks docs page (#1343)', () => {
  const text = () => render(<WebhooksDocsPage />).container.textContent ?? '';

  it('documents the real header, route and every event kind', () => {
    const content = text();
    expect(content).toContain('x-webhook-signature');
    expect(content).toContain('/api/webhooks/subscriptions');
    for (const kind of WEBHOOK_EVENT_KINDS) {
      expect(content).toContain(kind);
    }
  });

  it('does not describe the old, unimplemented design', () => {
    const content = text();
    expect(content).not.toContain('X-StellarIntel-Signature');
    expect(content).not.toContain('/api/admin/webhooks');
    expect(content).not.toContain('dispute.created');
    expect(content).not.toContain('publisher.tick');
  });

  it('counts the live kinds in the banner instead of stating them (WHK003)', () => {
    const content = text();
    // Five kinds have a producer today; the six added by WHK003 can only be subscribed to.
    expect(WEBHOOK_EVENT_KINDS).toHaveLength(11);
    expect(content).toContain(
      'Live for 5 of 11 kinds; the rest can be subscribed to and will start arriving as producers ship.'
    );
    expect(content).not.toContain('four of the five');
  });

  it('marks exactly the kinds without a producer as not yet emitted', () => {
    const rows = [...render(<WebhooksDocsPage />).container.querySelectorAll('tbody tr')].map(
      (row) => ({
        kind: row.querySelector('td')?.textContent ?? '',
        pending: (row.textContent ?? '').includes('(not yet emitted)'),
      })
    );

    // One row per kind, in the order subscriptions list them.
    expect(rows.map((row) => row.kind)).toEqual(WEBHOOK_EVENT_KINDS);
    expect(rows.filter((row) => row.pending).map((row) => row.kind)).toEqual([
      'intent.rejected',
      'intent.expired',
      'settlement.status_changed',
      'dispute.opened',
      'dispute.resolved',
      'oracle.published',
    ]);
  });

  it('keeps the metadata description in line with the event kinds', () => {
    expect(String(metadata.description)).not.toMatch(/dispute|onboarding|publisher/i);
  });
});
