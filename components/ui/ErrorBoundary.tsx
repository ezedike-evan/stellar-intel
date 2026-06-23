'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryFallbackProps {
  error: Error;
  resetErrorBoundary: () => void;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode | ((props: ErrorBoundaryFallbackProps) => ReactNode);
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  resetKeys?: readonly unknown[];
}

interface ErrorBoundaryState {
  error: Error | null;
}

function resetKeysChanged(
  previous: readonly unknown[] = [],
  next: readonly unknown[] = []
): boolean {
  return (
    previous.length !== next.length || previous.some((key, index) => !Object.is(key, next[index]))
  );
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.onError?.(error, errorInfo);
  }

  override componentDidUpdate(previousProps: ErrorBoundaryProps): void {
    if (this.state.error && resetKeysChanged(previousProps.resetKeys, this.props.resetKeys)) {
      this.resetErrorBoundary();
    }
  }

  resetErrorBoundary = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;

    if (typeof this.props.fallback === 'function') {
      return this.props.fallback({
        error: this.state.error,
        resetErrorBoundary: this.resetErrorBoundary,
      });
    }

    return this.props.fallback;
  }
}
