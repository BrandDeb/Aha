import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { admit, closePhone, cookieValue, forwardHeaders, isPrivateIPv4, lanAddresses, openPhone, phoneOf } from '../src/lib/phone-preview.ts';

test('only private IPv4 addresses are offered, real interfaces before virtual ones', () => {
  assert.ok(isPrivateIPv4('192.168.1.20'));
  assert.ok(isPrivateIPv4('10.0.0.5'));
  assert.ok(isPrivateIPv4('172.20.1.1'));
  assert.ok(!isPrivateIPv4('172.32.1.1'));
  assert.ok(!isPrivateIPv4('8.8.8.8'));
  assert.ok(!isPrivateIPv4('192.0.2.2'));
  const info = (address: string, internal = false) => ({ address, family: 'IPv4' as const, internal, netmask: '', mac: '', cidr: null });
  assert.deepEqual(
    lanAddresses({ lo: [info('127.0.0.1', true)], docker0: [info('172.17.0.1')], en0: [info('10.1.2.3'), { ...info('fe80::1'), family: 'IPv6' as const, scopeid: 0 }], wlan0: [info('192.168.1.20')], eth9: [info('8.8.8.8')] }, ''),
    ['192.168.1.20', '10.1.2.3', '172.17.0.1']
  );
  // Named by hand, for networks that aren't private ranges
  assert.deepEqual(lanAddresses({}, '100.64.0.7, nonsense,203.0.113.9'), ['100.64.0.7', '203.0.113.9']);
});

test('the key opens the door once, then the cookie keeps it open', () => {
  const token = 'k'.repeat(24);
  assert.deepEqual(admit('/', undefined, token), { ok: false });
  assert.deepEqual(admit('/?aha=wrong', undefined, token), { ok: false });
  const first = admit(`/about?x=1&aha=${token}`, undefined, token);
  assert.ok(first.ok && first.redirect === '/about?x=1' && first.setCookie?.startsWith(`aha_phone=${token}; HttpOnly`));
  assert.deepEqual(admit('/assets/app.js', `theme=dark; aha_phone=${token}`, token), { ok: true });
  assert.deepEqual(admit('/assets/app.js', 'aha_phone=nope', token), { ok: false });
  assert.equal(cookieValue('a=1; b = 2', 'b'), '2');
});

test('the dev server is asked as itself, without the key', () => {
  const h = forwardHeaders({ host: '192.168.1.20:51234', origin: 'http://192.168.1.20:51234', referer: 'http://192.168.1.20:51234/page', cookie: 'aha_phone=secret; session=abc', accept: 'text/html' }, '127.0.0.1:5173');
  assert.equal(h.host, '127.0.0.1:5173');
  assert.equal(h.origin, 'http://127.0.0.1:5173');
  assert.equal(h.referer, 'http://127.0.0.1:5173/page');
  assert.equal(h.cookie, 'session=abc');
  assert.equal(h.accept, 'text/html');
  assert.equal(forwardHeaders({ cookie: 'aha_phone=x' }, 't:1').cookie, undefined);
});

test('the proxy forwards pages and the hot-reload websocket to the dev server, and nothing without the key', async () => {
  // A stand-in dev server: refuses other host names (as Vite does), echoes over a websocket-style upgrade
  const dev = http.createServer((req, res) => {
    if (req.headers.host !== `127.0.0.1:${(dev.address() as net.AddressInfo).port}`) return void res.writeHead(403).end('Blocked request. This host is not allowed.');
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<h1>app</h1> cookie=${req.headers.cookie ?? ''}`);
  });
  dev.on('upgrade', (req, socket) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    socket.on('data', (d) => socket.write(`echo:${d}`));
  });
  await new Promise<void>((r) => dev.listen(0, '127.0.0.1', () => r()));
  const target = `http://127.0.0.1:${(dev.address() as net.AddressInfo).port}/`;
  let up = true;
  const phone = await openPhone('test-project-1', () => (up ? target : null), ['127.0.0.1']);
  const url = new URL(phone.url);
  const token = url.searchParams.get('aha')!;
  assert.equal(token.length, 24);
  assert.deepEqual(phoneOf('test-project-1'), phone);

  const get = (path: string, cookie?: string) =>
    new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: url.port, path, headers: cookie ? { cookie } : {} }, (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => resolve({ status: res.statusCode!, body, headers: res.headers }));
      }).on('error', reject);
    });

  assert.equal((await get('/')).status, 403);
  const opened = await get(`/?aha=${token}`);
  assert.equal(opened.status, 302);
  assert.equal(opened.headers.location, '/');
  const cookie = String(opened.headers['set-cookie']).split(';')[0];
  const page = await get('/', `${cookie}; theme=dark`);
  assert.equal(page.status, 200);
  assert.equal(page.body, '<h1>app</h1> cookie=theme=dark', 'the dev server sees its own host name, and never the key');

  // The websocket upgrade passes through with the cookie, and not without it
  const upgrade = (withCookie: boolean) =>
    new Promise<string>((resolve) => {
      const s = net.connect(Number(url.port), '127.0.0.1', () => s.write(`GET /hmr HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n${withCookie ? `Cookie: ${cookie}\r\n` : ''}\r\n`));
      let got = '';
      s.on('data', (d) => {
        got += d;
        if (got.includes('101') && !got.includes('echo')) s.write('ping');
        if (got.includes('echo') || got.includes('403')) {
          s.destroy();
          resolve(got);
        }
      });
    });
  assert.match(await upgrade(true), /101 Switching Protocols[\s\S]*echo:ping/);
  assert.match(await upgrade(false), /403/);

  // The dev server stops: the proxy says so
  up = false;
  assert.equal((await get('/', cookie)).status, 503);
  assert.ok(closePhone('test-project-1'));
  assert.equal(phoneOf('test-project-1'), null);
  await assert.rejects(get('/', cookie));
  // Kept-alive sockets (the proxy's to the dev server, the test's to the proxy) would hold the process open
  dev.closeAllConnections();
  dev.close();
  http.globalAgent.destroy();
});

test('no network address: a clear error', async () => {
  await assert.rejects(openPhone('test-project-2', () => 'http://127.0.0.1:1/', []), /no address on a local network/);
});
