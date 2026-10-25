import { describe, it, expect } from 'vitest';
import sitemap from '@/app/sitemap';

describe('sitemap (#1482)', () => {
  const entries = sitemap();
  const urls = entries.map((e) => e.url);

  it('lists /onramp as a daily entry right after /offramp', () => {
    const offramp = urls.findIndex((u) => u.endsWith('/offramp'));
    const onramp = urls.findIndex((u) => u.endsWith('/onramp'));

    expect(onramp).toBeGreaterThan(-1);
    expect(onramp).toBe(offramp + 1);
    expect(entries[onramp]!.changeFrequency).toBe('daily');
  });

  it('lists each URL once', () => {
    expect(new Set(urls).size).toBe(urls.length);
  });
});
