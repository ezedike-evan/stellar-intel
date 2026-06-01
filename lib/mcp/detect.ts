export async function detectMcp(): Promise<boolean> {
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
