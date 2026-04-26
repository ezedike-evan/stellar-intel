import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AmountInput } from '@/components/ui/AmountInput';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Adversarial corpus ───────────────────────────────────────────────────────
//
// Each entry represents a class of invalid input that the browser's number
// input previously let through. The property being tested:
//   "for every string in this corpus, onChange is never called"
//
const INVALID_INPUTS: string[] = [
  // Negatives
  '-1',
  '-0.5',
  '-100',
  '-0',
  // Scientific notation — browsers pass 'e'/'E' through <input type="number">
  '1e10',
  '1E5',
  '2.5e3',
  '1e+10',
  '1e-2',
  // Non-numeric / JS special values
  'abc',
  'foo',
  'NaN',
  'Infinity',
  '-Infinity',
  'undefined',
  'null',
  // Whitespace
  ' ',
  '  ',
  '\t',
  // Zero is not a positive amount
  '0',
  '0.0',
  '0.00',
  // Too many decimal places (> 7)
  '1.12345678',
  '0.00000001',
  // Malformed decimals / stray operators
  '..',
  '1.2.3',
  '1..2',
  '+1',
  '+',
  '-',
  // Injection / unicode attempts
  '<script>',
  '🎉',
  '1 000',
  '1,000',
];

describe('[#007] property test — no invalid string triggers onChange', () => {
  it.each(INVALID_INPUTS)('input %j never calls onChange', (invalid) => {
    const onChange = vi.fn();
    const { unmount } = render(<AmountInput value="" onChange={onChange} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: invalid } });
    vi.advanceTimersByTime(1_000); // well past the 250 ms debounce

    expect(onChange).not.toHaveBeenCalled();
    unmount();
  });
});

describe('[#007] error message renders under the input on invalid entries', () => {
  it('shows an alert for letters', () => {
    render(<AmountInput value="" onChange={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'abc' } });
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows an alert for a negative value', () => {
    render(<AmountInput value="" onChange={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '-5' } });
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows an alert for zero', () => {
    render(<AmountInput value="" onChange={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '0' } });
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows an alert for too many decimal places', () => {
    render(<AmountInput value="" onChange={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '1.12345678' } });
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows an alert for scientific notation', () => {
    render(<AmountInput value="" onChange={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '1e10' } });
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('clears the error when input becomes valid', () => {
    render(<AmountInput value="" onChange={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'abc' } });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '100' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not show an alert while user is mid-decimal (trailing dot)', () => {
    render(<AmountInput value="" onChange={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '100.' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('[#007] debounce — onChange fires only after 250 ms', () => {
  it('does not call onChange immediately on valid input', () => {
    const onChange = vi.fn();
    render(<AmountInput value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '100' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('calls onChange with the validated amount after 250 ms', () => {
    const onChange = vi.fn();
    render(<AmountInput value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '100.50' } });
    vi.advanceTimersByTime(250);
    expect(onChange).toHaveBeenCalledWith('100.50');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('debounces rapid keystrokes — fires once with the last value', () => {
    const onChange = vi.fn();
    render(<AmountInput value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '1' } });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '10' } });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '100' } });
    vi.advanceTimersByTime(250);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('100');
  });

  it('does not fire for a trailing dot even after the debounce window', () => {
    const onChange = vi.fn();
    render(<AmountInput value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '100.' } });
    vi.advanceTimersByTime(1_000);
    expect(onChange).not.toHaveBeenCalled();
  });
});
