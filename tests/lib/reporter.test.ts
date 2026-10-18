import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reportError, configureReporter, resetReporter } from '@/lib/reporter';
import type { ErrorReporter } from '@/lib/reporter';

describe('reporter', () => {
  beforeEach(() => {
    resetReporter();
  });

  it('is a no-op by default (does not throw)', () => {
    expect(() => reportError(new Error('boom'))).not.toThrow();
  });

  it('forwards errors to a configured mock reporter', () => {
    const mockReporter: ErrorReporter = { reportError: vi.fn() };
    configureReporter(mockReporter);

    const err = new Error('something went wrong');
    reportError(err, { userId: 'abc123' });

    expect(mockReporter.reportError).toHaveBeenCalledOnce();
    expect(mockReporter.reportError).toHaveBeenCalledWith(err, { userId: 'abc123' });
  });

  it('demonstrates Sentry-compatible plug-in pattern', () => {
    // Simulate what a Sentry integration would look like
    const captureException = vi.fn();
    configureReporter({
      reportError: (error, context) => captureException(error, { extra: context }),
    });

    const err = new Error('sep error');
    reportError(err, { httpStatus: 400, code: 'INVALID_ASSET' });

    expect(captureException).toHaveBeenCalledWith(err, {
      extra: { httpStatus: 400, code: 'INVALID_ASSET' },
    });
  });

  it('resets to no-op after resetReporter()', () => {
    const mockReporter: ErrorReporter = { reportError: vi.fn() };
    configureReporter(mockReporter);
    resetReporter();

    reportError(new Error('after reset'));

    expect(mockReporter.reportError).not.toHaveBeenCalled();
  });
});
