import { describe, expect, it } from 'vitest';
import { buildProbeCoverageReport, formatProbeCoverageReport } from '@/lib/reputation/aggregate';
import { buildDemoProbeSamples } from '../scripts/probe-coverage-report';
import { ANCHORS } from '@/constants/anchors';
import { anchorProbeDomains } from '@/lib/reputation/aggregate';

/**
 * #703 asks that the report's acceptance criterion be "grep for old framing
 * strings in report output returns zero hits". A grep run once passes once;
 * this asserts it against the rendered output on every commit.
 *
 * The rule is about the *headline*, not about banning a vocabulary. "Reputation"
 * is the correct word for a reputation score and this must not stop anyone
 * writing it — so the assertions below are anchored to the first lines, which
 * are what frames the report.
 */
describe('probe coverage report leads with anchor health', () => {
  const now = new Date('2026-08-05T00:00:00.000Z');
  const rendered = formatProbeCoverageReport(
    buildProbeCoverageReport(buildDemoProbeSamples(now), anchorProbeDomains(ANCHORS), { now })
  );
  const [headline, threshold] = rendered.split('\n');

  it('names anchor health in the headline', () => {
    expect(headline).toMatch(/anchor health/i);
  });

  it('does not frame the headline as reputation or intent', () => {
    // The two words the issue calls out. Checked on the framing lines only.
    for (const line of [headline, threshold]) {
      expect(line).not.toMatch(/\breputation\b/i);
      expect(line).not.toMatch(/\bintent\b/i);
    }
  });

  it('still reports the numbers it did before — copy only, no behaviour change', () => {
    expect(headline).toContain('2026-08-05');
    expect(threshold).toMatch(/\d+ continuous days/);
    expect(rendered).toMatch(/continuous days: \d+/);
    expect(rendered).toMatch(/covered calendar days: \d+/);
  });

  it('renders every configured anchor', () => {
    for (const domain of anchorProbeDomains(ANCHORS)) {
      expect(rendered).toContain(domain.domain);
    }
  });
});
