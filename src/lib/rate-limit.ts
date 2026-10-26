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

/**
 * Best-effort client key. Proxies append to X-Forwarded-For, so its first entries are whatever the
 * client sent; the address our own proxy saw is TRUST_PROXY_HOPS entries from the end (default 1,
 * one reverse proxy). Without the header (direct connections) everyone shares one bucket.
 */
export function clientKey(headers: Pick<Headers, 'get'>, hops = Number(process.env.TRUST_PROXY_HOPS) || 1): string {
  const chain = headers.get('x-forwarded-for')?.split(',').map((h) => h.trim()).filter(Boolean) ?? [];
  return chain[Math.max(0, chain.length - hops)] || headers.get('x-real-ip') || 'direct';
}
