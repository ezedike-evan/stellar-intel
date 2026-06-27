/**
 * Pluggable error reporter abstraction.
 *
 * By default this is a no-op so nothing breaks without configuration.
 * Wire up Sentry (or any compatible reporter) once at app startup:
 *
 * ```ts
 * import * as Sentry from '@sentry/nextjs'
 * import { configureReporter } from '@/lib/reporter'
 *
 * configureReporter({
 *   reportError: (error, context) => Sentry.captureException(error, { extra: context }),
 * })
 * ```
 */

export interface ErrorContext {
  /** Arbitrary key/value pairs forwarded to the reporter as extra context. */
  [key: string]: unknown;
}

export interface ErrorReporter {
  reportError(error: Error, context?: ErrorContext): void;
}

/** No-op reporter used until a real one is configured. */
const noopReporter: ErrorReporter = {
  reportError: () => undefined,
};

let activeReporter: ErrorReporter = noopReporter;

/**
 * Replace the active reporter with a custom implementation.
 * Call this once during app initialisation (e.g. in `instrumentation.ts`).
 */
export function configureReporter(reporter: ErrorReporter): void {
  activeReporter = reporter;
}

/**
 * Report an error through the currently configured reporter.
 * Safe to call anywhere — falls back to a no-op when no reporter is set.
 */
export function reportError(error: Error, context?: ErrorContext): void {
  activeReporter.reportError(error, context);
}

/**
 * Reset to the no-op reporter. Useful in tests to avoid state leaking
 * between test cases.
 */
export function resetReporter(): void {
  activeReporter = noopReporter;
}
