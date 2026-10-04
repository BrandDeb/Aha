/**
 * Fixed-window, in-memory rate limiter for a single server process.
 * Behind a load balancer each instance keeps its own counts.
 */

interface Window {
  count: number;
  resetAt: number;
}

export function createRateLimiter(limit: number, windowMs: number) {
  const windows = new Map<string, Window>();
  return {
    /** Returns seconds to wait if the key is over its limit, otherwise 0 */
    check(key: string, now = Date.now()): number {
      if (windows.size > 10_000) {
        for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
      }
      const current = windows.get(key);
      if (!current || current.resetAt <= now) {
        windows.set(key, { count: 1, resetAt: now + windowMs });
        return 0;
      }
      current.count++;
      return current.count > limit ? Math.ceil((current.resetAt - now) / 1000) : 0;
    },
  };
}

/** Best-effort client key: first X-Forwarded-For hop (set by the reverse proxy), else a shared bucket */
export function clientKey(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0].trim() || headers.get('x-real-ip') || 'direct';
}
