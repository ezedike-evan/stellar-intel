'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { useToastContext, type Toast } from '@/contexts/ToastContext';

function ToastItem({ toast }: { toast: Toast }) {
  const { removeToast } = useToastContext();

  return (
    <div
      role="alert"
      className={clsx(
        'flex min-w-[280px] max-w-sm items-start gap-3 rounded-xl px-4 py-3 text-sm font-medium shadow-lg',
        {
          'bg-red-600 text-white': toast.variant === 'error',
          'bg-blue-600 text-white': toast.variant === 'info',
          'bg-green-600 text-white': toast.variant === 'success',
        }
      )}
    >
      <span className="flex-1">{toast.message}</span>
      <button
        onClick={() => removeToast(toast.id)}
        aria-label="Dismiss"
        className="shrink-0 opacity-70 transition-opacity hover:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}

export function ToastPortal() {
  const { toasts } = useToastContext();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || toasts.length === 0) return null;

  return createPortal(
    <div aria-live="polite" className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>,
    document.body
  );
}
