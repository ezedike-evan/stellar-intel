'use client';
import { useCallback, useState } from 'react';

interface ShareData {
  text: string;
  url?: string;
}

/**
 * Shares via the Web Share API when available (mobile browsers), falling
 * back to copying the shared text (+ URL) to the clipboard otherwise.
 */
export function useShare() {
  const [copied, setCopied] = useState(false);

  const share = useCallback(async (data: ShareData) => {
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await navigator.share(data);
        return;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        // Fall through to the clipboard fallback for any other failure.
      }
    }

    const fallbackText = [data.text, data.url].filter(Boolean).join(' ');
    try {
      await navigator.clipboard.writeText(fallbackText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Best-effort — nothing more to do if the clipboard API is unavailable.
    }
  }, []);

  return { share, copied };
}
