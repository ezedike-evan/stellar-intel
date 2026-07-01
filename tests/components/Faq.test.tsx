import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { Faq } from '@/components/landing/Faq';

describe('Faq', () => {
  it('renders all FAQ questions', () => {
    const { getByText } = render(<Faq />);
    expect(getByText(/Is this custodial/i)).toBeTruthy();
    expect(getByText(/anchor fails/i)).toBeTruthy();
    expect(getByText(/block explorer/i)).toBeTruthy();
    expect(getByText(/anchor X not show up/i)).toBeTruthy();
    expect(getByText(/corridors and anchors are supported/i)).toBeTruthy();
    expect(getByText(/AI agent off-ramp/i)).toBeTruthy();
    expect(getByText(/Is there an SDK/i)).toBeTruthy();
    expect(getByText(/How do I contribute/i)).toBeTruthy();
  });

  it('all panels are initially collapsed', () => {
    const { getAllByRole } = render(<Faq />);
    const buttons = getAllByRole('button');
    buttons.forEach((btn) => {
      expect(btn.getAttribute('aria-expanded')).toBe('false');
    });
  });

  it('clicking a question expands its panel', () => {
    const { getAllByRole } = render(<Faq />);
    const [first] = getAllByRole('button');
    fireEvent.click(first!);
    expect(first!.getAttribute('aria-expanded')).toBe('true');
  });

  it('clicking the same question again collapses it', () => {
    const { getAllByRole } = render(<Faq />);
    const [first] = getAllByRole('button');
    fireEvent.click(first!);
    fireEvent.click(first!);
    expect(first!.getAttribute('aria-expanded')).toBe('false');
  });

  it('opening one item closes the previously open item', () => {
    const { getAllByRole } = render(<Faq />);
    const [first, second] = getAllByRole('button');
    fireEvent.click(first!);
    fireEvent.click(second!);
    expect(first!.getAttribute('aria-expanded')).toBe('false');
    expect(second!.getAttribute('aria-expanded')).toBe('true');
  });

  it('expanded panel is not hidden', () => {
    const { getAllByRole, container } = render(<Faq />);
    const [first] = getAllByRole('button');
    const panelId = first!.getAttribute('aria-controls') as string;
    fireEvent.click(first!);
    const panel = container.querySelector(`#${panelId}`) as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.hidden).toBe(false);
  });

  it('ArrowDown moves focus to the next button', () => {
    const { getAllByRole } = render(<Faq />);
    const buttons = getAllByRole('button');
    buttons[0]!.focus();
    fireEvent.keyDown(buttons[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(buttons[1]);
  });

  it('ArrowUp moves focus to the previous button', () => {
    const { getAllByRole } = render(<Faq />);
    const buttons = getAllByRole('button');
    buttons[1]!.focus();
    fireEvent.keyDown(buttons[1]!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('Home moves focus to the first button', () => {
    const { getAllByRole } = render(<Faq />);
    const buttons = getAllByRole('button');
    buttons[3]!.focus();
    fireEvent.keyDown(buttons[3]!, { key: 'Home' });
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('End moves focus to the last button', () => {
    const { getAllByRole } = render(<Faq />);
    const buttons = getAllByRole('button');
    buttons[0]!.focus();
    fireEvent.keyDown(buttons[0]!, { key: 'End' });
    expect(document.activeElement).toBe(buttons.at(-1));
  });

  it('ArrowDown wraps from last to first', () => {
    const { getAllByRole } = render(<Faq />);
    const buttons = getAllByRole('button');
    const last = buttons.at(-1)!;
    last.focus();
    fireEvent.keyDown(last, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(buttons[0]);
  });
});
