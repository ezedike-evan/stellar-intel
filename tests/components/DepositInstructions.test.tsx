import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { DepositInstructions } from '@/components/onramp/DepositInstructions';

const INSTRUCTIONS = {
  organization_bank_number: { value: '121122676', description: 'US bank routing number' },
  reference: { value: 'REF-8841', description: '' },
};

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DepositInstructions (#1468)', () => {
  it('renders one labelled row per instruction in a definition list', () => {
    const { container } = render(<DepositInstructions instructions={INSTRUCTIONS} />);

    expect(container.querySelector('dl')).not.toBeNull();
    expect(screen.getByText('US bank routing number')).toBeTruthy();
    expect(screen.getByText('121122676')).toBeTruthy();
    // No description: the key is the label.
    expect(screen.getByText('reference')).toBeTruthy();
    expect(screen.getByText('REF-8841')).toBeTruthy();
    expect(container.querySelectorAll('dt')).toHaveLength(2);
  });

  it('shows the value in a monospace font', () => {
    render(<DepositInstructions instructions={INSTRUCTIONS} />);
    expect(screen.getByText('121122676').className).toContain('font-mono');
  });

  it('copies the value, and shows Copied for two seconds', async () => {
    vi.useFakeTimers();
    render(<DepositInstructions instructions={INSTRUCTIONS} />);

    const button = screen.getByRole('button', { name: 'Copy US bank routing number' });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(writeText).toHaveBeenCalledWith('121122676');
    expect(button.textContent).toBe('Copied');

    await act(async () => {
      vi.advanceTimersByTime(1999);
    });
    expect(button.textContent).toBe('Copied');
    await act(async () => {
      vi.advanceTimersByTime(2);
    });
    expect(button.textContent).toBe('Copy');
  });

  it('gives each copy button its own accessible name, falling back to the key', () => {
    render(<DepositInstructions instructions={INSTRUCTIONS} />);
    expect(screen.getByRole('button', { name: 'Copy reference' })).toBeTruthy();
  });

  it('does not claim a copy when the clipboard refuses', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    render(<DepositInstructions instructions={INSTRUCTIONS} />);

    const button = screen.getByRole('button', { name: 'Copy reference' });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(button.textContent).toBe('Copy');
  });

  it('links to the anchor with a safe rel and a new tab', () => {
    render(
      <DepositInstructions instructions={INSTRUCTIONS} moreInfoUrl="https://anchor.example/tx/1" />
    );

    const link = screen.getByRole('link', { name: "View full instructions on the anchor's site" });
    expect(link.getAttribute('href')).toBe('https://anchor.example/tx/1');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders the message above the list', () => {
    const { container } = render(
      <DepositInstructions instructions={INSTRUCTIONS} message="Send within 48 hours" />
    );

    const message = screen.getByText('Send within 48 hours');
    const list = container.querySelector('dl')!;
    expect(message.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the empty-state copy, and no empty list, when there is nothing to show', () => {
    const { container } = render(<DepositInstructions />);

    expect(
      screen.getByText(
        'The anchor will show payment details in its window. Keep it open until you have paid.'
      )
    ).toBeTruthy();
    expect(container.querySelector('dl')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows the empty-state copy for an empty instructions map too', () => {
    render(<DepositInstructions instructions={{}} />);
    expect(screen.getByText(/The anchor will show payment details/)).toBeTruthy();
  });

  it('shows only the link, with no empty list, when there are no instructions', () => {
    const { container } = render(<DepositInstructions moreInfoUrl="https://anchor.example/x" />);

    expect(screen.getByRole('link')).toBeTruthy();
    expect(container.querySelector('dl')).toBeNull();
    expect(screen.queryByText(/The anchor will show payment details/)).toBeNull();
  });

  it('renders markup in a value as text, never as HTML', () => {
    const hostile = '<script>alert(1)</script>';
    const { container } = render(
      <DepositInstructions
        instructions={{ x: { value: hostile, description: '<img src=x onerror=alert(1)>' } }}
        message="<b>bold</b>"
      />
    );

    expect(screen.getByText(hostile)).toBeTruthy();
    expect(screen.getByText('<b>bold</b>')).toBeTruthy();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });
});
