import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VISIBLE_CORRIDORS } from '@/constants/anchors';

describe('CorridorSelector', () => {
  it('only renders visible corridors as options', async () => {
    const { CorridorSelector } = await import('@/components/ui/CorridorSelector');
    const visibleIds = new Set(VISIBLE_CORRIDORS.map((corridor) => corridor.id));

    render(<CorridorSelector value="usdc-ngn" onChange={vi.fn()} />);

    for (const option of screen.getAllByRole('option')) {
      expect(visibleIds.has(option.getAttribute('value') ?? '')).toBe(true);
    }
  });
});
