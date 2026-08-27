import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import FaqPage from '@/app/faq/page';
import { parseFaqMarkdown, buildFaqPageJsonLd } from '@/lib/seo/jsonld';

const FAQ_SOURCE = readFileSync(join(process.cwd(), 'docs/FAQ.md'), 'utf-8');

describe('FAQ page (#1061)', () => {
  it('renders every question from docs/FAQ.md', () => {
    const { getByText } = render(<FaqPage />);
    for (const entry of parseFaqMarkdown(FAQ_SOURCE)) {
      expect(getByText(entry.question)).toBeTruthy();
    }
  });

  it('emits FAQPage JSON-LD that matches the parser output', () => {
    const { container } = render(<FaqPage />);
    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();

    const data = JSON.parse(script!.textContent ?? '{}');
    expect(data).toEqual(buildFaqPageJsonLd(parseFaqMarkdown(FAQ_SOURCE)));
  });
});
