/**
 * Phone preview: the app running on a dev server, on a phone on the same Wi-Fi. Dev servers listen on 127.0.0.1 only,
 * and stay that way; turning the phone preview on opens a small proxy on the machine's network address that forwards
 * to the dev server (pages, assets and the hot-reload websocket). It answers only to a phone that opened the link with
 * its random key (the QR code carries it; a cookie keeps it after that), and it closes after 30 minutes unused, after
 * two hours in all, or when the dev server stops. Server only.
 */

import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';

const COOKIE = 'aha_phone';
const IDLE_MS = 30 * 60 * 1000;
const MAX_MS = 2 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** 10.x, 172.16–31.x, 192.168.x: addresses a phone on the same network can reach */
export function isPrivateIPv4(address: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(address);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * The machine's addresses on its local networks, Wi-Fi and Ethernet first, VPN and container bridges last.
 * AHA_PHONE_HOST names the address to use (or several, comma-separated) on networks that aren't private ranges.
 */
export function lanAddresses(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(), override = process.env.AHA_PHONE_HOST): string[] {
  const named = (override ?? '').split(',').map((a) => a.trim()).filter((a) => net.isIP(a) === 4);
  if (named.length) return named;
  const found: { address: string; rank: number }[] = [];
  for (const [name, list] of Object.entries(interfaces)) {
    for (const info of list ?? []) {
      if (info.family !== 'IPv4' || info.internal || !isPrivateIPv4(info.address)) continue;
      const virtual = /^(docker|br-|veth|virbr|vmnet|vboxnet|utun|tun|tap|wg|zt|tailscale|lo)/i.test(name);
      found.push({ address: info.address, rank: (virtual ? 2 : 0) + (info.address.startsWith('192.168.') ? 0 : 1) });
    }
  }
  return found.sort((x, y) => x.rank - y.rank).map((f) => f.address);
}

export function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

const sameToken = (a: string | undefined, b: string) => !!a && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Headers for the dev server: it is asked as itself (dev servers refuse unknown host names), without our key */
export function forwardHeaders(headers: http.IncomingHttpHeaders, target: string): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = { ...headers, host: target };
  if (headers.origin) out.origin = `http://${target}`;
  if (headers.referer) out.referer = String(headers.referer).replace(/^https?:\/\/[^/]+/, `http://${target}`);
  const cookies = (headers.cookie ?? '').split(';').map((c) => c.trim()).filter((c) => c && !c.startsWith(`${COOKIE}=`));
  if (cookies.length) out.cookie = cookies.join('; ');
  else delete out.cookie;
  return out;
}

/** May this request through? With the key in the link (then set the cookie), or with the cookie */
export function admit(url: string, cookie: string | undefined, token: string): { ok: false } | { ok: true; setCookie?: string; redirect?: string } {
  const parsed = new URL(url, 'http://phone');
  const key = parsed.searchParams.get('aha');
  if (key !== null) {
    if (!sameToken(key, token)) return { ok: false };
    parsed.searchParams.delete('aha');
    return { ok: true, setCookie: `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`, redirect: parsed.pathname + parsed.search };
  }
  return sameToken(cookieValue(cookie, COOKIE), token) ? { ok: true } : { ok: false };
}

// ---------------------------------------------------------------------------
// The proxy
// ---------------------------------------------------------------------------

interface Phone {
  server: http.Server;
  token: string;
  port: number;
  host: string;
  opened: number;
  used: number;
  timer: NodeJS.Timeout;
}

const phones: Map<string, Phone> = ((globalThis as Record<string, unknown>).__ahaPhones ??= new Map()) as Map<string, Phone>;

export interface PhoneState {
  url: string;
  /** Other addresses of this machine, when the first isn't on the phone's network */
  others: string[];
  expiresAt: number;
}

const stateOf = (p: Phone): PhoneState => ({
  url: `http://${p.host}:${p.port}/?aha=${p.token}`,
  others: lanAddresses().filter((a) => a !== p.host).map((a) => `http://${a}:${p.port}/?aha=${p.token}`),
  expiresAt: Math.min(p.used + IDLE_MS, p.opened + MAX_MS),
});

export const phoneOf = (id: string): PhoneState | null => {
  const p = phones.get(id);
  return p ? stateOf(p) : null;
};

export function closePhone(id: string): boolean {
  const p = phones.get(id);
  if (!p) return false;
  phones.delete(id);
  clearInterval(p.timer);
  p.server.closeAllConnections?.();
  p.server.close();
  return true;
}

const DENIED = '<!doctype html><meta name="viewport" content="width=device-width"><title>Aha! phone preview</title><body style="font:16px system-ui;padding:24px">This preview needs its key. Scan the QR code in the studio again.</body>';

/**
 * Open the proxy for a project's dev server. `target` gives the dev server's current address (it can move when the
 * server restarts); null means it is gone, and the proxy closes.
 */
export async function openPhone(id: string, target: () => string | null, addresses: string[] = lanAddresses()): Promise<PhoneState> {
  const existing = phones.get(id);
  if (existing) return stateOf(existing);
  const host = addresses[0];
  if (!host) throw Object.assign(new Error('This machine has no address on a local network (Wi-Fi or Ethernet), so a phone can’t reach it.'), { status: 409 });
  const token = crypto.randomBytes(18).toString('base64url');
  const hostPort = () => {
    const t = target();
    return t ? new URL(t).host : null;
  };

  const server = http.createServer((req, res) => {
    const pass = admit(req.url ?? '/', req.headers.cookie, token);
    if (!pass.ok) {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(DENIED);
      return;
    }
    phone.used = Date.now();
    if (pass.redirect) {
      res.writeHead(302, { Location: pass.redirect, 'Set-Cookie': pass.setCookie!, 'Cache-Control': 'no-store' }).end();
      return;
    }
    const to = hostPort();
    if (!to) {
      res.writeHead(503, { 'Content-Type': 'text/plain' }).end('The dev server is not running.');
      return;
    }
    const [hostname, port] = to.split(':');
    const upstream = http.request({ hostname, port: Number(port), method: req.method, path: req.url, headers: forwardHeaders(req.headers, to) }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('The dev server did not answer.');
    });
    req.pipe(upstream);
  });

  // Hot reload: websockets pass through to the dev server, with the same key check
  server.on('upgrade', (req, socket, head) => {
    const to = hostPort();
    if (!admit(req.url ?? '/', req.headers.cookie, token).ok || !to) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    phone.used = Date.now();
    const [hostname, port] = to.split(':');
    const upstream = net.connect(Number(port), hostname, () => {
      const headers = forwardHeaders(req.headers, to);
      const lines = Object.entries(headers).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => `${k}: ${x}`) : v === undefined ? [] : [`${k}: ${v}`]));
      upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`);
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    const end = () => {
      upstream.destroy();
      socket.destroy();
    };
    // When either side goes (the phone closes the page, the dev server restarts), close both: the server keeps
    // upgraded sockets half-open, so an end on one side would otherwise hold the other open for good
    for (const s of [upstream, socket]) for (const event of ['error', 'end', 'close']) s.on(event, end);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    // Every interface, so each address in `others` works too; nothing gets through without the key
    server.listen(0, '0.0.0.0', () => resolve());
  });
  const now = Date.now();
  const phone: Phone = {
    server,
    token,
    host,
    port: (server.address() as net.AddressInfo).port,
    opened: now,
    used: now,
    timer: setInterval(() => {
      const t = Date.now();
      if (t - phone.used > IDLE_MS || t - phone.opened > MAX_MS || !target()) closePhone(id);
    }, 30_000),
  };
  phone.timer.unref?.();
  phones.set(id, phone);
  return stateOf(phone);
}
