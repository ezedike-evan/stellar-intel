'use client';
import { useEffect, useState } from 'react';
import { WifiOff, X } from 'lucide-react';

export function OfflineBar() {
  const [offline, setOffline] = useState(() =>
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const handleOffline = () => {
      setOffline(true);
      setDismissed(false);
    };
    const handleOnline = () => {
      setOffline(false);
      setDismissed(false);
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  if (!offline || dismissed) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 bg-yellow-500/90 px-4 py-2 text-sm font-medium text-yellow-950 backdrop-blur-sm">
      <WifiOff className="h-4 w-4 shrink-0" />
      <span>You are offline</span>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="ml-auto rounded p-0.5 hover:bg-yellow-600/30"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
