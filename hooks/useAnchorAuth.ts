import { useState, useRef, useCallback, useEffect } from "react";

type AuthResponse = {
  jwt: string;
};

type UseAnchorAuthReturn = {
  jwt: string | null;
  authenticate: (anchorUrl: string, credentials?: any) => Promise<void>;
  isAuthenticating: boolean;
  error: Error | null;
};

const authCache = new Map<string, string>();

export function useAnchorAuth(): UseAnchorAuthReturn {
  const [jwt, setJwt] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const authenticate = useCallback(
    async (anchorUrl: string, credentials?: any) => {
      setIsAuthenticating(true);
      setError(null);

      if (authCache.has(anchorUrl)) {
        setJwt(authCache.get(anchorUrl)!);
        setIsAuthenticating(false);
        return;
      }

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const res = await fetch(`${anchorUrl}/auth`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(credentials || {}),
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`Auth failed: ${res.status}`);
        }

        const data: AuthResponse = await res.json();

        authCache.set(anchorUrl, data.jwt);
        setJwt(data.jwt);
      } catch (err: any) {
        if (err.name !== "AbortError") {
          setError(err);
        }
      } finally {
        setIsAuthenticating(false);
      }
    },
    []
  );

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    jwt,
    authenticate,
    isAuthenticating,
    error,
  };
}
