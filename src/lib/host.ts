/**
 * DNS-rebinding defence. A page on evil.example can point its own domain at
 * 127.0.0.1, after which the browser treats requests to this server as
 * "same origin" and the Origin and Host headers agree. The Host header still
 * names evil.example, so refusing unknown hosts closes the hole.
 */

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function hostnameOf(host: string): string {
  // "example.com:3000" -> "example.com"; "[::1]:3000" -> "[::1]"
  return host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.replace(/:\d+$/, '');
}

/**
 * Whether the request's Host header names this machine or the site the
 * operator configured (NEXT_PUBLIC_BASE_URL, ALLOWED_HOSTS).
 */
export function isTrustedHost(hostHeader: string | null, baseUrl: string, allowedHosts = ''): boolean {
  if (!hostHeader) return false;
  const name = hostnameOf(hostHeader.toLowerCase());
  if (LOCAL.has(name)) return true;
  const allowed = allowedHosts.split(',').map((h) => hostnameOf(h.trim().toLowerCase())).filter(Boolean);
  if (allowed.includes(name)) return true;
  try {
    return new URL(baseUrl).hostname.toLowerCase() === name;
  } catch {
    return false;
  }
}
