import { describe, it, expect } from 'vitest';
import robots from '@/app/robots';

// #1099 — the AI crawler policy has to be a stated decision, not a default.
//
// The failure this guards is silent: app/robots.ts previously carried a single
// wildcard rule, so the answer for GPTBot or CCBot was "whatever that vendor
// decides on our behalf". These assertions fail if a named crawler is dropped,
// or if a rule is added that quietly opens /api/ or /admin/ to it.

const NAMED_AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Perplexity-User',
  'CCBot',
  'Google-Extended',
];

const WITHHELD = ['/api/', '/admin/', '/_next/'];

function ruleList() {
  const { rules } = robots();
  return Array.isArray(rules) ? rules : [rules];
}

describe('robots.txt AI crawler policy (#1099)', () => {
  const rules = ruleList();

  it('keeps the wildcard rule, still withholding the private paths', () => {
    const wildcard = rules.find((r) => r.userAgent === '*');
    expect(wildcard).toBeDefined();
    expect(wildcard!.allow).toBe('/');
    for (const path of WITHHELD) {
      expect(wildcard!.disallow).toContain(path);
    }
  });

  it.each(NAMED_AI_CRAWLERS)('names %s explicitly', (userAgent) => {
    const rule = rules.find((r) => r.userAgent === userAgent);
    expect(rule, `${userAgent} has no rule of its own`).toBeDefined();
  });

  it('gives every named crawler an unambiguous verdict', () => {
    for (const userAgent of NAMED_AI_CRAWLERS) {
      const rule = rules.find((r) => r.userAgent === userAgent)!;
      // Either the public pages are open (with the private paths withheld) or
      // the whole site is closed. "Allowed everything" is never a valid verdict.
      if (rule.allow === undefined) {
        expect(rule.disallow).toBe('/');
      } else {
        expect(rule.allow).toBe('/');
        for (const path of WITHHELD) {
          expect(rule.disallow).toContain(path);
        }
      }
    }
  });

  it('publishes the sitemap', () => {
    expect(robots().sitemap).toMatch(/\/sitemap\.xml$/);
  });
});
