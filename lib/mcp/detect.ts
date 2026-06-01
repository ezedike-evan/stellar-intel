export async function detectMcp(): Promise<boolean> {
  // MCP is a local development tool — skip detection in production to avoid
  // the badge being permanently visible when the app is deployed remotely.
  if (
    typeof window !== 'undefined' &&
    !['localhost', '127.0.0.1'].includes(window.location.hostname)
  ) {
    return false;
  }
  try {
    const res = await fetch('/api/mcp/ping', {
      signal: AbortSignal.timeout(2000),
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  }
}
