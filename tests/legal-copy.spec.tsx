import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import { DISCLAIMER_SENTENCES, DISCLAIMER_TEXT, TERMS_HREF } from '@/lib/legal';
import { DisclaimerBanner } from '@/components/offramp/DisclaimerBanner';

// #738 / #739 / #742 — the Terms page carried two sentences of its own prose
// while docs/ had no ToS at all, and the banner hardcoded its own copy. A
// disclaimer that contradicts the terms it summarises is worse than either
// alone, so both now come from one source.

const TOS_RAW = readFileSync('docs/TERMS_OF_SERVICE.md', 'utf8');

// Whitespace-normalised, because prettier reflows markdown prose. Asserting on
// raw text means a phrase silently stops matching when a line wraps — which is
// exactly what happened writing these tests.
const TOS = TOS_RAW.replace(/\s+/g, ' ');

describe('Terms of Service document (#738)', () => {
  it('covers every topic the issue requires', () => {
    for (const topic of [
      'Non-custody',
      'Rates are estimates',
      'Your responsibilities',
      'Jurisdiction',
      'Limitation of liability',
    ]) {
      expect(TOS).toContain(topic);
    }
  });

  it('stays consistent with the doctrine docs by linking them', () => {
    // The issue requires internal consistency with these; linking is the
    // mechanism that makes a contradiction visible in review.
    for (const doc of [
      'NON_CUSTODY.md',
      'JURISDICTIONAL.md',
      'THREAT_MODEL.md',
      'ANCHOR_REPUTATION.md',
    ]) {
      expect(TOS).toContain(doc);
    }
  });

  it('is flagged for legal review rather than presented as reviewed', () => {
    // Acceptance criterion: "flagged for legal review before publish". This is
    // an engineering draft and must not read as though counsel approved it.
    expect(TOS).toContain('not yet reviewed by counsel');
    expect(TOS).toContain('Reviewed by a qualified lawyer');
  });

  it('says rates are indicative, matching what #720 found', () => {
    // Claiming firm quotes would be a false statement in a legal document:
    // no anchor serves a firm quote for the NGN corridor.
    expect(TOS).toMatch(/indicative/i);
    expect(TOS).toContain('not a binding quote');
  });
});

describe('short-form disclaimer (#739)', () => {
  it('is three sentences, short enough for a banner', () => {
    expect(DISCLAIMER_SENTENCES).toHaveLength(3);
    expect(DISCLAIMER_TEXT.length).toBeLessThan(160);
  });

  it('covers non-custody, user-signing and rate uncertainty', () => {
    expect(DISCLAIMER_TEXT).toContain('non-custodial');
    expect(DISCLAIMER_TEXT).toContain('sign every transaction');
    expect(DISCLAIMER_TEXT).toContain('not guarantees');
  });

  it('appears verbatim in the Terms document', () => {
    // The guard against drift: if someone edits one, this fails.
    for (const sentence of DISCLAIMER_SENTENCES) {
      expect(TOS).toContain(sentence);
    }
  });
});

describe('DisclaimerBanner (#742)', () => {
  it('renders the shared copy and links to the Terms', () => {
    render(<DisclaimerBanner />);

    expect(screen.getByText(new RegExp('non-custodial', 'i'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /terms/i })).toHaveAttribute('href', TERMS_HREF);
  });

  it('is dismissible', () => {
    render(<DisclaimerBanner />);
    expect(screen.getByRole('button', { name: /dismiss disclaimer/i })).toBeInTheDocument();
  });
});

describe('Prose pages render markdown with PROSE_CLASSES (#968)', () => {
  it('renders /terms page with PROSE_CLASSES container', async () => {
    const { default: TermsPage } = await import('@/app/terms/page');
    const { container } = render(<TermsPage />);
    expect(container.querySelector('main')).toBeInTheDocument();
    expect(container.textContent).toContain('Terms of Service');
  });

  it('renders /methodology page with PROSE_CLASSES container', async () => {
    const { default: MethodologyPage } = await import('@/app/methodology/page');
    const { container } = render(<MethodologyPage />);
    expect(container.querySelector('main')).toBeInTheDocument();
    expect(container.textContent).toContain('Anchor Reputation');
  });
});
