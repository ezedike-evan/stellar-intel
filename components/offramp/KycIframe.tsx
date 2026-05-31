'use client';
import type { KycPostMessage } from '@/types';
import { useEffect, useRef, useState } from 'react';

export interface KycIframeProps {
  url: string;
  origin: string;
  onComplete: (transactionId: string) => void;
  onCancel: () => void;
  onError: (error: Error) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function KycIframe({ url, origin, onComplete, onCancel, onError }: KycIframeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Verify origin for security
      if (event.origin !== origin) return;

      try {
        const data = event.data as KycPostMessage;

        if (data.type === 'stellar_transaction_created' && data.transaction_id) {
          onComplete(data.transaction_id);
        } else if (data.type === 'stellar_cancel') {
          onCancel();
        }
      } catch (err) {
        onError(err instanceof Error ? err : new Error('Unknown postMessage error'));
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [origin, onComplete, onCancel, onError]);

  const handleIframeLoad = () => {
    setIsLoading(false);
    setHasError(false);
  };

  const handleIframeError = () => {
    setIsLoading(false);
    setHasError(true);
    onError(new Error('Failed to load KYC iframe'));
  };

  const openInNewTab = () => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="relative h-full min-h-[500px] w-full">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-gray-900">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"></div>
            <p className="text-sm text-gray-600 dark:text-gray-400">Loading KYC form...</p>
          </div>
        </div>
      )}

      {hasError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white dark:bg-gray-900 p-6">
          <div className="text-center">
            <div className="mb-4 text-red-500">
              <svg
                className="mx-auto h-12 w-12"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
              Unable to load KYC form
            </h3>
            <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
              The anchor's KYC form couldn't be loaded in this frame.
            </p>
            <button
              onClick={openInNewTab}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              Open in New Tab
            </button>
          </div>
        </div>
      )}

      <iframe
        ref={iframeRef}
        src={url}
        sandbox="allow-forms allow-scripts allow-same-origin"
        className={`h-full w-full border-0 ${isLoading || hasError ? 'invisible' : ''}`}
        onLoad={handleIframeLoad}
        onError={handleIframeError}
        title="KYC Verification"
      />
    </div>
  );
}
