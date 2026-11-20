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

  it('keeps the metadata description in line with the event kinds', () => {
    expect(String(metadata.description)).not.toMatch(/dispute|onboarding|publisher/i);
  });
});
