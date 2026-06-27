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

describe('reportError call-site pattern', () => {
  beforeEach(() => {
    resetReporter();
  });

  it('caller decides to report only 5xx SepErrors', async () => {
    const mockReporter: ErrorReporter = { reportError: vi.fn() };
    configureReporter(mockReporter);

    const { parseSepErrorBody } = await import('@/lib/stellar/errors');

    // 400 — routine validation error, caller does NOT report
    const err400 = parseSepErrorBody({ error: 'Bad request' }, 400);
    if (err400.httpStatus >= 500) reportError(err400, { anchorDomain: 'test.anchor.com' });

    // 500 — genuine server failure, caller DOES report
    const err500 = parseSepErrorBody({ error: 'Internal server error' }, 500);
    if (err500.httpStatus >= 500) reportError(err500, { anchorDomain: 'test.anchor.com' });

    expect(mockReporter.reportError).toHaveBeenCalledOnce();
    const [capturedError, capturedContext] = (mockReporter.reportError as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    expect(capturedError.name).toBe('SepError');
    expect(capturedError.httpStatus).toBe(500);
    expect(capturedContext).toMatchObject({ anchorDomain: 'test.anchor.com' });
  });
});
