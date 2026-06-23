export type ScoreBand = 'green' | 'amber' | 'red';

// Single source of truth for score thresholds
export const SCORE_THRESHOLDS = {
  GREEN: 95,
  AMBER: 80,
};

/**
 * Determines the color band based on the numerical score.
 * Green ≥ 95%, Amber 80–94%, Red < 80%
 */
export function getScoreBand(score: number): ScoreBand {
  if (score >= SCORE_THRESHOLDS.GREEN) return 'green';
  if (score >= SCORE_THRESHOLDS.AMBER) return 'amber';
  return 'red';
}

/**
 * Provides an accessible fallback label for each band.
 */
export function getBandLabel(band: ScoreBand): string {
  switch (band) {
    case 'green':
      return 'Excellent';
    case 'amber':
      return 'Needs Improvement';
    case 'red':
      return 'Critical';
  }
}
