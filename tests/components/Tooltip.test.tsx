import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from '@/components/ui/Tooltip';

describe('Tooltip', () => {
  it('is hidden until the trigger is hovered or focused', () => {
    render(
      <Tooltip content="Breakdown text">
        <span>info</span>
      </Tooltip>
    );
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows the tooltip on keyboard focus and hides it on blur (keyboard-accessible)', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>before</button>
        <Tooltip content="Breakdown text">
          <span>info</span>
        </Tooltip>
      </>
    );

    await user.tab(); // focuses "before"
    await user.tab(); // focuses the tooltip trigger
    expect(screen.getByRole('tooltip')).toHaveTextContent('Breakdown text');

    await user.tab();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Breakdown text">
        <span>info</span>
      </Tooltip>
    );

    await user.tab();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('associates the trigger with the tooltip via aria-describedby', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Breakdown text">
        <span>info</span>
      </Tooltip>
    );

    await user.tab();
    const tooltip = screen.getByRole('tooltip');
    const trigger = screen.getByText('info').closest('[tabindex]');
    expect(trigger).toHaveAttribute('aria-describedby', tooltip.id);
  });
});
