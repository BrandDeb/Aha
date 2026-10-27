import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';

// The connector directories come from the environment at import time
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aha-conn-'));
process.env.AHA_HOME = home;
after(() => fs.rmSync(home, { recursive: true, force: true }));

const { cleanSchema, parseConnector, slugify } = await import('../src/lib/connectors/types.ts');
const { fetchPublic, isPrivateAddress, FetchError } = await import('../src/lib/connectors/net.ts');
const { htmlToText, decodeEntities } = await import('../src/lib/connectors/html.ts');
const { checkReadOnlySql, formatTable, stripSql } = await import('../src/lib/connectors/sql.ts');
const { HttpTransport, McpClient, StdioTransport, parseSse } = await import('../src/lib/connectors/mcp.ts');
const builtin = await import('../src/lib/connectors/builtin.ts');
const { callConnectorTool, closeAllConnectors, connectorsMode, listConnectorTools, modeBlocks } = await import('../src/lib/connectors/manager.ts');
const { connectorEnv } = await import('../src/lib/connectors/env.ts');

const base = { id: 'c1', name: 'Test', enabled: true, trustReads: false };
const ctx = { mode: 'local' as const };

async function serve(handler: http.RequestListener): Promise<{ url: string; close: () => void; port: number }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, port, close: () => server.close() };
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

test('parseConnector accepts each kind and trims what it keeps', () => {
  const stdio = parseConnector({ ...base, kind: 'mcp-stdio', command: ' npx ', args: ['-y', 'pkg'], env: { API_KEY: 'x' } });
  assert.deepEqual(stdio, { ...base, kind: 'mcp-stdio', command: 'npx', args: ['-y', 'pkg'], env: { API_KEY: 'x' } });
  assert.equal((parseConnector({ ...base, kind: 'mcp-http', url: 'https://x.test/mcp', headers: { Authorization: 'Bearer t' } }) as { kind: string }).kind, 'mcp-http');
  assert.equal((parseConnector({ ...base, kind: 'github' }) as { token: string }).token, '');
  assert.equal((parseConnector({ ...base, kind: 'web-fetch' }) as { kind: string }).kind, 'web-fetch');
  assert.equal((parseConnector({ ...base, kind: 'web-search', provider: 'brave', apiKey: ' k ' }) as { apiKey: string }).apiKey, 'k');
  assert.equal((parseConnector({ ...base, kind: 'web-search', provider: 'searxng', baseUrl: 'http://localhost:8080/' }) as { baseUrl: string }).baseUrl, 'http://localhost:8080');
  assert.equal((parseConnector({ ...base, kind: 'sqlite', path: '~/data.db' }) as { path: string }).path, '~/data.db');
  assert.equal((parseConnector({ ...base, kind: 'postgres', url: 'postgresql://u:p@localhost/db' }) as { kind: string }).kind, 'postgres');
  const command = parseConnector({ ...base, kind: 'command', tool: { name: 'run_tests', description: 'Run tests', command: 'npm', args: ['test', '{{filter}}'], params: [{ name: 'filter', description: 'pattern' }] } });
  assert.equal((command as { tool: { name: string } }).tool.name, 'run_tests');
  assert.equal((parseConnector({ ...base, kind: 'web-fetch', enabled: false }) as { enabled: boolean }).enabled, false);
  assert.equal((parseConnector({ ...base, kind: 'web-fetch', trustReads: true }) as { trustReads: boolean }).trustReads, true);
});

test('parseConnector rejects malformed or risky configuration with a useful message', () => {
  const error = (value: unknown) => (parseConnector(value) as { error: string }).error;
  assert.match(error(null), /must be an object/);
  assert.match(error({ ...base, id: '../x', kind: 'web-fetch' }), /id is invalid/);
  assert.match(error({ ...base, name: '', kind: 'web-fetch' }), /name/);
  assert.match(error({ ...base, kind: 'nope' }), /Unknown connector type/);
  assert.match(error({ ...base, kind: 'mcp-stdio', command: '' }), /command/);
  assert.match(error({ ...base, kind: 'mcp-stdio', command: 'x', args: 'a b' }), /arguments/);
  assert.match(error({ ...base, kind: 'mcp-stdio', command: 'x', env: { PATH: '/evil' } }), /PATH can’t be set/);
  assert.match(error({ ...base, kind: 'mcp-stdio', command: 'x', env: { LD_PRELOAD: '/evil.so' } }), /LD_PRELOAD/);
  assert.match(error({ ...base, kind: 'mcp-stdio', command: 'x', env: { 'a b': '1' } }), /look like API_KEY/);
  assert.match(error({ ...base, kind: 'mcp-stdio', command: 'x\0y' }), /command/);
  assert.match(error({ ...base, kind: 'mcp-http', url: 'file:///etc/passwd' }), /http:\/\//);
  assert.match(error({ ...base, kind: 'mcp-http', url: 'https://x.test', headers: { 'bad header': '1' } }), /Header names/);
  assert.match(error({ ...base, kind: 'web-search', provider: 'google' }), /Brave, Tavily or SearXNG/);
  assert.match(error({ ...base, kind: 'web-search', provider: 'brave' }), /API key/);
  assert.match(error({ ...base, kind: 'web-search', provider: 'searxng' }), /SearXNG instance URL/);
  assert.match(error({ ...base, kind: 'sqlite', path: '' }), /path/);
  assert.match(error({ ...base, kind: 'postgres', url: 'mysql://x' }), /postgres:\/\//);
  assert.match(error({ ...base, kind: 'command', tool: { name: 'Bad Name', description: 'd', command: 'x' } }), /lowercase/);
  assert.match(error({ ...base, kind: 'command', tool: { name: 'ok', description: '', command: 'x' } }), /Describe what/);
  assert.match(error({ ...base, kind: 'command', tool: { name: 'ok', description: 'd', command: 'x', params: Array.from({ length: 11 }, (_, i) => ({ name: `p${i}`, description: '' })) } }), /up to 10/);
  assert.equal(slugify('My GitHub (work)!'), 'my_github_work');
  assert.equal(slugify('***'), 'connector');
});

test('cleanSchema keeps what every provider accepts and drops the rest', () => {
  const cleaned = cleanSchema({
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    additionalProperties: false,
    properties: {
      text: { type: ['string', 'null'], description: 'd', default: 'x', minLength: 1 },
      mode: { enum: ['a', 'b'] },
      tags: { type: 'array', items: { type: 'string' } },
      nested: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n', 'ghost'] },
      anyone: { anyOf: [{ type: 'string' }, { type: 'number' }] },
    },
    required: ['text', 'missing'],
  });
  assert.deepEqual(cleaned, {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'd' },
      mode: { type: 'string', enum: ['a', 'b'] },
      tags: { type: 'array', items: { type: 'string' } },
      nested: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] },
      anyone: { type: 'string' },
    },
    required: ['text'],
  });
  assert.deepEqual(cleanSchema(undefined), { type: 'object', properties: {} });
  assert.deepEqual(cleanSchema('nonsense'), { type: 'object', properties: {} });
});

// ---------------------------------------------------------------------------
// Network safety
// ---------------------------------------------------------------------------

test('isPrivateAddress covers loopback, private ranges, metadata, mapped and unique-local addresses', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a00:1', '[::1]', 'fe80::1%eth0', 'not-an-ip']) {
    assert.ok(isPrivateAddress(ip), ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '100.63.0.1', '100.128.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8', '151.101.1.69']) {
    assert.ok(!isPrivateAddress(ip), ip);
  }
});

test('fetchPublic refuses private targets, odd schemes and credentials before connecting', async () => {
  let hits = 0;
  const server = await serve((_req, res) => (hits++, res.end('secret')));
  try {
    for (const url of [server.url, `http://localhost:${server.port}/`, `http://[::1]:${server.port}/`, 'http://169.254.169.254/latest/meta-data/', 'http://0x7f000001/', 'http://2130706433/', `http://127.1:${server.port}/`, 'http://[::ffff:127.0.0.1]/']) {
      await assert.rejects(fetchPublic(url), (e: Error) => e instanceof FetchError && /private network|find/.test(e.message), url);
    }
    await assert.rejects(fetchPublic('file:///etc/passwd'), /Only http and https/);
    await assert.rejects(fetchPublic('ftp://example.com/x'), /Only http and https/);
    await assert.rejects(fetchPublic('http://user:pass@example.com/'), /credentials/);
    await assert.rejects(fetchPublic('not a url'), /not a valid URL/);
    assert.equal(hits, 0, 'nothing reached the local server');
  } finally {
    server.close();
  }
});

test('fetchPublic (private allowed): bodies, gzip, size caps, redirects, POST bodies and credential stripping', async () => {
  const seen: { url?: string; auth?: string; length?: string; body: string }[] = [];
  const server = await serve((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization, length: req.headers['content-length'], body });
      if (req.url === '/gz') return res.writeHead(200, { 'Content-Encoding': 'gzip' }).end(zlib.gzipSync('compressed text'));
      if (req.url === '/big') return res.end('x'.repeat(3000));
      if (req.url === '/r1') return res.writeHead(302, { Location: '/r2' }).end();
      if (req.url === '/r2') return res.writeHead(301, { Location: '/final' }).end();
      if (req.url === '/final') return res.end('arrived');
      if (req.url === '/loop') return res.writeHead(302, { Location: '/loop' }).end();
      if (req.url === '/slow') return;
      res.end(`hello ${req.method}`);
    });
  });
  const open = { allowPrivate: true };
  try {
    assert.equal((await fetchPublic(`${server.url}/`, open)).body.toString(), 'hello GET');
    assert.equal((await fetchPublic(`${server.url}/gz`, open)).body.toString(), 'compressed text');
    const big = await fetchPublic(`${server.url}/big`, { ...open, maxBytes: 1000 });
    assert.equal(big.truncated, true);
    assert.ok(big.body.length <= 1000);
    const followed = await fetchPublic(`${server.url}/r1`, open);
    assert.equal(followed.body.toString(), 'arrived');
    assert.equal(followed.url, `${server.url}/final`);
    await assert.rejects(fetchPublic(`${server.url}/loop`, { ...open, maxRedirects: 3 }), /Too many redirects/);
    await assert.rejects(fetchPublic(`${server.url}/slow`, { ...open, timeoutMs: 100 }), /timed out/);
    const post = await fetchPublic(`${server.url}/`, { ...open, method: 'POST', body: '{"é":1}', headers: { Authorization: 'Bearer t' } });
    assert.equal(post.body.toString(), 'hello POST');
    const last = seen.at(-1)!;
    assert.deepEqual([last.body, last.length, last.auth], ['{"é":1}', '8', 'Bearer t']);
  } finally {
    server.close();
  }
});

test('fetchPublic: a redirect to another site keeps only headers that describe the request', async () => {
  let got: http.IncomingHttpHeaders = {};
  const other = await serve((req, res) => ((got = req.headers), res.end('ok')));
  const first = await serve((_req, res) => res.writeHead(302, { Location: `${other.url}/landing` }).end());
  try {
    const headers = { Authorization: 'Bearer a', 'Api-Key': 'k1', 'Private-Token': 'k2', 'X-Goog-Api-Key': 'k3', Accept: 'application/json', 'Content-Type': 'application/json' };
    assert.equal((await fetchPublic(`${first.url}/start`, { allowPrivate: true, headers })).body.toString(), 'ok');
    assert.deepEqual([got.authorization, got['api-key'], got['private-token'], got['x-goog-api-key']], [undefined, undefined, undefined, undefined]);
    assert.equal(got.accept, 'application/json');
  } finally {
    first.close();
    other.close();
  }
});

test('htmlToText keeps structure and links, drops scripts and styles, decodes entities', () => {
  const page = htmlToText(
    `<html><head><title>Docs &amp; Guides</title><style>p{color:red}</style></head><body>
      <script>alert(1)</script><!-- hidden -->
      <h1>Intro</h1><p>Hello&nbsp;<b>world</b> &#169; &#x1F600; &unknown;</p>
      <ul><li>one</li><li><a href="/two">two</a></li></ul>
      <a href="javascript:void 0">skip</a> <a href="#top">anchor</a> <a href="https://x.test/">abs</a>
      <table><tr><td>a</td><td>b</td></tr></table></body></html>`,
    'https://example.com/docs/'
  );
  assert.equal(page.title, 'Docs & Guides');
  assert.match(page.text, /^# Intro/);
  assert.match(page.text, /Hello world © 😀 &unknown;/);
  assert.match(page.text, /- one\n- \[two\]\(https:\/\/example\.com\/two\)/);
  assert.match(page.text, /skip anchor \[abs\]\(https:\/\/x\.test\/\)/);
  assert.doesNotMatch(page.text, /alert|color:red|hidden/);
  assert.equal(decodeEntities('&#0; &#1114112; &lt;'), '&#0; &#1114112; <');
});

// ---------------------------------------------------------------------------
// SQL guard and formatting
// ---------------------------------------------------------------------------

test('checkReadOnlySql allows one read statement and nothing else', () => {
  const sqlite = (sql: string) => checkReadOnlySql(sql, 'sqlite');
  const pg = (sql: string) => checkReadOnlySql(sql, 'postgres');
  for (const good of ['SELECT 1', ' select * from t where a = \'x;y\' ;', 'WITH x AS (SELECT 1) SELECT * FROM x', '-- hi\nSELECT 1', '/* a; b */ SELECT "a;b" FROM t', 'EXPLAIN SELECT 1', 'VALUES (1)']) assert.equal(sqlite(good), null, good);
  assert.equal(pg('SHOW server_version'), null);
  assert.equal(pg("SELECT $$a;b$$, $tag$;$tag$"), null);
  assert.equal(pg("SELECT E'it\\'s; ok'"), null);
  for (const bad of ['DROP TABLE t', 'DELETE FROM t', 'INSERT INTO t VALUES (1)', 'UPDATE t SET a=1', 'CREATE TABLE x(a)', 'SELECT 1; DROP TABLE t', 'SELECT 1;SELECT 2', 'COMMIT; DROP TABLE t', '', '   ', '-- only a comment']) {
    assert.ok(sqlite(bad), `sqlite: ${bad}`);
    assert.ok(pg(bad), `postgres: ${bad}`);
  }
  assert.match(sqlite('SELECT 1 FROM t; /* tail */ DELETE FROM t')!, /one statement/);
  assert.match(sqlite('ATTACH DATABASE "x" AS y')!, /Only read queries/);
  assert.match(sqlite('SELECT load_extension("x")')!, /not allowed/);
  assert.match(pg('SELECT pg_read_file(\'/etc/passwd\')')!, /not allowed/);
  assert.match(pg('SELECT * FROM dblink(\'x\',\'y\') t(a int)')!, /not allowed/);
  assert.match(pg('x'.repeat(30_000))!, /too long/);
  assert.equal(stripSql("a 'b;c' -- d;\n e /* f; */ \"g;h\"", 'sqlite').includes(';'), false);
});

test('formatTable renders compact tables with nulls, blobs, objects and a row-limit note', () => {
  assert.equal(formatTable(['a', 'b'], [[1, null], ['x', new Uint8Array(3)], [{ k: 1 }, 'multi\nline  text']]), 'a | b\n--- | ---\n1 | NULL\nx | <blob 3 bytes>\n{"k":1} | multi line text');
  assert.equal(formatTable(['a'], []), 'a\n---\n(no rows)');
  assert.match(formatTable(['a'], [[1]], 500), /showing 1 of at least 500 rows/);
  assert.equal(formatTable([], []), '(no columns)');
  assert.ok(formatTable(['a'], [['y'.repeat(500)]]).includes('…'));
});

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

const fakeMcp = path.join(import.meta.dirname, 'fixtures', 'fake-mcp.cjs');
const stdio = (env: Record<string, string> = {}) =>
  new StdioTransport(process.execPath, [fakeMcp], connectorEnv(process.env, env) as Record<string, string>, os.tmpdir());

test('MCP over stdio: handshake, paged tool list with cleaned schemas, calls, errors', async () => {
  const client = await McpClient.connect(stdio({ FAKE_VAR: 'visible' }));
  try {
    assert.equal(client.serverName, 'fake-mcp');
    const tools = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name), ['echo', 'write_note', 'boom', 'env', 'slow'], 'both pages, banner line ignored');
    assert.deepEqual(tools[0], {
      name: 'echo',
      description: 'Echo the text back',
      inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'what to echo' } }, required: ['text'] },
      readOnly: true,
    });
    assert.equal(tools[1].readOnly, false);
    assert.deepEqual(await client.callTool('echo', { text: 'hi' }), { text: 'echo: hi', isError: false });
    assert.deepEqual(await client.callTool('write_note', {}), { text: 'written\n[image content omitted]', isError: false });
    assert.deepEqual(await client.callTool('boom', {}), { text: 'it broke', isError: true });
    assert.equal((await client.callTool('env', { name: 'FAKE_VAR' })).text, 'visible');
    await assert.rejects(client.callTool('missing', {}), /Unknown tool: missing/);
    await assert.rejects(client.callTool('slow', {}, 150), /did not answer tools\/call within/);
    assert.equal((await client.callTool('echo', { text: 'still alive' })).text, 'echo: still alive');
  } finally {
    client.close();
  }
});

test('MCP over stdio: the server never sees the studio’s own secrets', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-secret-studio-key';
  process.env.GITHUB_CLIENT_SECRET = 'gh-secret';
  const client = await McpClient.connect(stdio());
  try {
    assert.equal((await client.callTool('env', { name: 'ANTHROPIC_API_KEY' })).text, 'undefined');
    assert.equal((await client.callTool('env', { name: 'GITHUB_CLIENT_SECRET' })).text, 'undefined');
    assert.equal((await client.callTool('env', { name: 'HOME' })).text, path.join(home, 'connectors', 'home'));
  } finally {
    client.close();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GITHUB_CLIENT_SECRET;
  }
});

test('MCP over stdio: a missing command and a crashing server give clear errors', async () => {
  await assert.rejects(McpClient.connect(new StdioTransport('definitely-not-installed-xyz', [], {}, os.tmpdir())), /not found/);
  await assert.rejects(McpClient.connect(new StdioTransport(process.execPath, ['-e', 'process.stderr.write("bad config: missing token\\n"); process.exit(3)'], connectorEnv(process.env, {}) as Record<string, string>, os.tmpdir())), /exited \(code 3\).*missing token/);
  const client = await McpClient.connect(stdio());
  client.close();
  await assert.rejects(client.callTool('echo', { text: 'x' }), /closed/);
});

test('parseSse extracts JSON messages from an event stream', () => {
  assert.deepEqual(parseSse('event: message\ndata: {"a":1}\n\ndata: {"b":\ndata: 2}\n\n: comment\n\ndata: not json\n\n'), [{ a: 1 }, { b: 2 }]);
});

test('MCP over HTTP: JSON and event-stream replies, session id, protocol header, auth header', async () => {
  const log: { method: string; session?: string; protocol?: string; auth?: string }[] = [];
  const server = await serve((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      log.push({ method: req.method!, session: req.headers['mcp-session-id'] as string, protocol: req.headers['mcp-protocol-version'] as string, auth: req.headers.authorization });
      if (req.method === 'DELETE') return res.end();
      const m = JSON.parse(body);
      const rpc = (result: unknown) => JSON.stringify({ jsonrpc: '2.0', id: m.id, result });
      if (m.method === 'initialize') return res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'sess-1' }).end(rpc({ protocolVersion: '2025-06-18', serverInfo: { name: 'http-fake' } }));
      if (m.method === 'notifications/initialized') return res.writeHead(202).end();
      if (m.method === 'tools/list') return res.writeHead(200, { 'Content-Type': 'text/event-stream' }).end(`event: message\ndata: ${rpc({ tools: [{ name: 'ping', inputSchema: { type: 'object', properties: {} } }] })}\n\n`);
      if (m.method === 'tools/call') return res.writeHead(200, { 'Content-Type': 'text/event-stream' }).end(`data: ${rpc({ content: [{ type: 'text', text: `pong ${JSON.stringify(m.params.arguments)}` }] })}\n\n`);
      res.writeHead(500).end('nope');
    });
  });
  try {
    const client = await McpClient.connect(new HttpTransport(`${server.url}/mcp`, { Authorization: 'Bearer abc' }, true));
    assert.equal(client.serverName, 'http-fake');
    assert.deepEqual((await client.listTools()).map((t) => t.name), ['ping']);
    assert.equal((await client.callTool('ping', { n: 1 })).text, 'pong {"n":1}');
    client.close();
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(log[0].session, undefined);
    assert.ok(log.slice(1).every((l) => l.session === 'sess-1' && l.protocol === '2025-06-18' && l.auth === 'Bearer abc'));
    assert.equal(log.at(-1)!.method, 'DELETE');

    // A server that answers with an error status
    const failing = await serve((_q, r) => r.writeHead(401).end('no'));
    await assert.rejects(McpClient.connect(new HttpTransport(failing.url, {}, true)), /refused the request \(401\)/);
    failing.close();
    // Private addresses are off limits unless the studio runs locally
    await assert.rejects(McpClient.connect(new HttpTransport(`${server.url}/mcp`, {}, false)), /private network/);
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------------------
// Built-in connectors
// ---------------------------------------------------------------------------

test('web pages: readable text with a provenance banner; refuses non-text and private hosts', async () => {
  const server = await serve((req, res) => {
    if (req.url === '/bin') return res.writeHead(200, { 'Content-Type': 'image/png' }).end('png');
    if (req.url === '/missing') return res.writeHead(404).end('nope');
    if (req.url === '/json') return res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"a":1}');
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<title>T</title><h1>Hi</h1><p>${'word '.repeat(5000)}</p>`);
  });
  try {
    const impl = builtin.webFetchImpl({ ...base, kind: 'web-fetch' }, true);
    assert.deepEqual((await impl.listTools())[0].readOnly, true);
    const page = await impl.callTool('fetch_url', { url: `${server.url}/page`, max_chars: 600 }, ctx);
    assert.equal(page.isError, false);
    assert.match(page.text, /^\[Content from outside the project\./);
    assert.match(page.text, /Title: T\n\n# Hi/);
    assert.match(page.text, /more characters\]$/);
    assert.equal((await impl.callTool('fetch_url', { url: `${server.url}/json` }, ctx)).text.endsWith('{"a":1}'), true);
    assert.match((await impl.callTool('fetch_url', { url: `${server.url}/bin` }, ctx)).text, /image\/png, not text/);
    assert.match((await impl.callTool('fetch_url', { url: `${server.url}/missing` }, ctx)).text, /answered 404/);
    const guarded = builtin.webFetchImpl({ ...base, kind: 'web-fetch' }, false);
    const blocked = await guarded.callTool('fetch_url', { url: `${server.url}/page` }, ctx);
    assert.equal(blocked.isError, true);
    assert.match(blocked.text, /private network/);
    assert.equal((await guarded.callTool('nope', {}, ctx)).isError, true);
  } finally {
    server.close();
  }
});

test('web search: SearXNG results are formatted, HTML stripped, errors explained', async () => {
  const server = await serve((req, res) => {
    const url = new URL(req.url!, 'http://x');
    if (url.searchParams.get('q') === 'forbidden') return res.writeHead(403).end();
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ results: [
      { title: 'scriptc <b>docs</b>', url: 'https://github.com/vercel-labs/scriptc', content: 'Compile &amp; run TypeScript' },
      { title: 'Second', url: 'https://example.com', content: 'More' },
    ] }));
  });
  try {
    const impl = builtin.searchImpl({ ...base, kind: 'web-search', provider: 'searxng', apiKey: '', baseUrl: server.url }, true);
    const found = await impl.callTool('web_search', { query: 'scriptc', count: 1 }, ctx);
    assert.match(found.text, /^\[Content from outside/);
    assert.match(found.text, /1\. scriptc docs\n {3}https:\/\/github\.com\/vercel-labs\/scriptc\n {3}Compile & run TypeScript/);
    assert.doesNotMatch(found.text, /Second/);
    assert.match((await impl.callTool('web_search', { query: 'forbidden' }, ctx)).text, /JSON output disabled/);
    assert.equal((await impl.callTool('web_search', { query: ' ' }, ctx)).isError, true);
    const hosted = builtin.searchImpl({ ...base, kind: 'web-search', provider: 'searxng', apiKey: '', baseUrl: server.url }, false);
    assert.match((await hosted.callTool('web_search', { query: 'x' }, { mode: 'hosted' })).text, /private network/);
  } finally {
    server.close();
  }
});

test('GitHub: calls the right endpoints with the right token, and explains refusals', async () => {
  const requests: { url: string; auth?: string }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, auth: (init?.headers as Record<string, string>).Authorization });
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
    if (url.includes('/search/code')) return json({ total_count: 1, items: [{ repository: { full_name: 'o/r' }, path: 'src/a.ts', html_url: 'x' }] });
    if (url.includes('/contents/src/main.ts')) return json({ type: 'file', size: 5, encoding: 'base64', content: Buffer.from('hello').toString('base64') });
    if (url.includes('/contents/src')) return json([{ name: 'main.ts', type: 'file' }, { name: 'lib', type: 'dir' }]);
    if (url.includes('/contents/big.bin')) return json({ type: 'file', size: 999_999, content: '' });
    if (url.includes('/issues/7/comments')) return json([{ user: { login: 'bob' }, body: 'me too' }]);
    if (url.includes('/issues/7')) return json({ title: 'Crash', state: 'open', body: 'It crashes', user: { login: 'amy' }, comments: 1 });
    if (url.includes('/private/')) return json({}, 404);
    if (url.includes('/limited/')) return json({}, 403);
    if (url.includes('/issues?')) return json([{ number: 1, title: 'Bug', state: 'open', user: { login: 'amy' }, labels: [{ name: 'bug' }] }, { number: 2, title: 'A PR', state: 'open', pull_request: {} }]);
    if (url.includes('/pulls?')) return json([{ number: 3, title: 'Fix', state: 'open', user: { login: 'bob' } }]);
    if (url.includes('/private/')) return json({}, 404);
    if (url.includes('/limited/')) return json({}, 403);
    return json({}, 500);
  }) as typeof fetch;
  try {
    const impl = builtin.githubImpl({ ...base, kind: 'github', token: '' });
    const tools = (await impl.listTools()).map((t) => t.name);
    assert.deepEqual(tools, ['search_code', 'get_file', 'list_issues', 'get_issue', 'list_pull_requests']);

    assert.match((await impl.callTool('search_code', { query: 'x repo:o/r' }, { ...ctx, githubToken: 'signed-in' })).text, /1 matches:\no\/r\/src\/a\.ts/);
    assert.equal(requests.at(-1)!.auth, 'Bearer signed-in');
    assert.match((await impl.callTool('search_code', { query: 'x' }, ctx)).text, /needs you to be signed in/);

    const own = builtin.githubImpl({ ...base, kind: 'github', token: 'own-token' });
    assert.match((await own.callTool('get_file', { repo: 'o/r', path: 'src/main.ts', ref: 'dev' }, { ...ctx, githubToken: 'ignored' })).text, /hello$/);
    assert.deepEqual([requests.at(-1)!.auth, requests.at(-1)!.url], ['Bearer own-token', 'https://api.github.com/repos/o/r/contents/src/main.ts?ref=dev']);
    assert.match((await impl.callTool('get_file', { repo: 'o/r', path: 'src' }, ctx)).text, /📁 lib/);
    assert.match((await impl.callTool('get_file', { repo: 'o/r', path: 'big.bin' }, ctx)).text, /too large/);
    assert.match((await impl.callTool('get_file', { repo: 'o/r', path: '../x' }, ctx)).text, /Invalid path/);

    const issues = await impl.callTool('list_issues', { repo: 'o/r' }, ctx);
    assert.match(issues.text, /#1 Bug \[open\] by amy \(bug\)/);
    assert.doesNotMatch(issues.text, /A PR/, 'pull requests are not issues');
    assert.match((await impl.callTool('list_pull_requests', { repo: 'o/r', state: 'closed' }, ctx)).text, /#3 Fix/);
    assert.match(requests.at(-1)!.url, /state=closed/);
    const issue = await impl.callTool('get_issue', { repo: 'o/r', number: 7 }, ctx);
    assert.match(issue.text, /#7 Crash \[open\] by amy\n\nIt crashes\n\n--- bob:\nme too/);

    assert.match((await impl.callTool('list_issues', { repo: 'not a repo' }, ctx)).text, /owner\/name/);
    assert.match((await impl.callTool('list_issues', { repo: 'private/x' }, ctx)).text, /Not found/);
    assert.match((await impl.callTool('list_issues', { repo: 'limited/x' }, ctx)).text, /rate limit or missing access/);
    assert.match((await impl.callTool('get_issue', { repo: 'o/r', number: 0 }, ctx)).text, /issue number/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('SQLite: read-only queries, schema tools, row limits, and every write refused', async () => {
  const { DatabaseSync } = await import('node:sqlite' as string) as { DatabaseSync: new (p: string) => { exec(sql: string): void; close(): void } };
  const file = path.join(home, 'test.db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, bio TEXT); CREATE VIEW v AS SELECT name FROM users;');
  db.exec(`INSERT INTO users (name, bio) VALUES ${Array.from({ length: 300 }, (_, i) => `('user${i}', ${i % 2 ? 'NULL' : "'hi there'"})`).join(',')}`);
  db.close();

  const impl = builtin.sqliteImpl({ ...base, kind: 'sqlite', path: file });
  assert.match((await impl.callTool('list_tables', {}, ctx)).text, /users \| table\nv \| view/);
  const described = await impl.callTool('describe_table', { table: 'users' }, ctx);
  assert.match(described.text, /id \| INTEGER \| 0 \| NULL \| 1\nname \| TEXT \| 1 \| NULL \| 0/);
  assert.match((await impl.callTool('describe_table', { table: 'x"; DROP TABLE users; --' }, ctx)).text, /\(no rows\)/);

  const rows = await impl.callTool('query', { sql: 'SELECT id, name FROM users WHERE id <= 3 ORDER BY id;' }, ctx);
  assert.equal(rows.text, 'id | name\n--- | ---\n1 | user0\n2 | user1\n3 | user2');
  const many = await impl.callTool('query', { sql: 'SELECT * FROM users' }, ctx);
  assert.equal(many.text.split('\n').length, 2 + 200 + 1);
  assert.match(many.text, /showing 200 of at least 201 rows$/);
  assert.equal((await impl.callTool('query', { sql: 'SELECT * FROM users', limit: 2 }, ctx)).text.split('\n').length, 2 + 2 + 1);
  assert.equal((await impl.callTool('query', { sql: "SELECT count(*) AS n FROM users WHERE bio IS NULL" }, ctx)).text, 'n\n---\n150');

  for (const sql of ['DELETE FROM users', 'DROP TABLE users', 'SELECT 1; DROP TABLE users', "ATTACH DATABASE ':memory:' AS m", 'PRAGMA writable_schema=1', 'INSERT INTO users(name) VALUES (1)']) {
    const result = await impl.callTool('query', { sql }, ctx);
    assert.equal(result.isError, true, sql);
  }
  // Even a statement that slips past the guard cannot write: the file is opened read-only
  const writable = await impl.callTool('query', { sql: 'WITH x AS (SELECT 1) SELECT * FROM x' }, ctx);
  assert.equal(writable.isError, false);
  assert.match((await impl.callTool('query', { sql: 'SELECT * FROM nope' }, ctx)).text, /no such table/);
  assert.equal((await impl.callTool('count', {}, ctx)).isError, true);

  const missing = builtin.sqliteImpl({ ...base, kind: 'sqlite', path: path.join(home, 'nope.db') });
  assert.match((await missing.callTool('list_tables', {}, ctx)).text, /There is no file at/);
  const dir = builtin.sqliteImpl({ ...base, kind: 'sqlite', path: home });
  assert.match((await dir.callTool('list_tables', {}, ctx)).text, /is not a file/);

  // A write-capable path cannot be reached through the tool: the data is unchanged
  assert.match((await impl.callTool('query', { sql: 'SELECT count(*) AS n FROM users' }, ctx)).text, /300/);
});

test('custom command: arguments are passed as argv entries, never through a shell', async () => {
  const impl = builtin.commandImpl({
    ...base,
    kind: 'command',
    tool: { name: 'say', description: 'Print the arguments as JSON', command: process.execPath, args: ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', 'prefix-{{word}}', '{{other}}'], params: [{ name: 'word', description: 'w' }, { name: 'other', description: 'o' }] },
  });
  const [spec] = await impl.listTools();
  assert.deepEqual([spec.name, spec.readOnly, spec.inputSchema.required], ['say', false, ['word', 'other']]);
  const hostile = '$(touch /tmp/pwned); echo `id` && rm -rf / | cat';
  const result = await impl.callTool('say', { word: hostile, other: 7 }, ctx);
  assert.equal(result.isError, false);
  assert.deepEqual(JSON.parse(result.text), [`prefix-${hostile}`, '7']);
  assert.equal(fs.existsSync('/tmp/pwned'), false);
  assert.match((await impl.callTool('say', { word: 'x' }, ctx)).text, /Missing parameter “other”/);
  assert.match((await impl.callTool('say', { word: 'x'.repeat(3000), other: 'y' }, ctx)).text, /too long/);
  assert.equal((await impl.callTool('other', {}, ctx)).isError, true);

  const failing = builtin.commandImpl({ ...base, kind: 'command', tool: { name: 'fail', description: 'd', command: process.execPath, args: ['-e', 'console.error("bad input"); process.exit(4)'], params: [] } });
  const failed = await failing.callTool('fail', {}, ctx);
  assert.equal(failed.isError, true);
  assert.match(failed.text, /Exited with code 4\.\n\[stderr\]\nbad input/);
  const absent = builtin.commandImpl({ ...base, kind: 'command', tool: { name: 'x', description: 'd', command: 'no-such-binary-xyz', args: [], params: [] } });
  assert.match((await absent.callTool('x', {}, ctx)).text, /not found on PATH/);
  const env = builtin.commandImpl({ ...base, kind: 'command', tool: { name: 'e', description: 'd', command: process.execPath, args: ['-e', 'console.log(process.env.ANTHROPIC_API_KEY, process.env.HOME)'], params: [] } });
  process.env.ANTHROPIC_API_KEY = 'sk-leak';
  assert.equal((await env.callTool('e', {}, ctx)).text, `undefined ${path.join(home, 'connectors', 'home')}`);
  delete process.env.ANTHROPIC_API_KEY;
});

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

test('modes: local by default on loopback, hosted when exposed, off on request', () => {
  assert.equal(connectorsMode({}), 'local');
  assert.equal(connectorsMode({ HOST: '127.0.0.1' }), 'local');
  assert.equal(connectorsMode({ HOST: 'localhost' }), 'local');
  assert.equal(connectorsMode({ HOST: '::1' }), 'local');
  assert.equal(connectorsMode({ HOST: '0.0.0.0' }), 'hosted');
  assert.equal(connectorsMode({ HOST: '192.168.1.5' }), 'hosted');
  assert.equal(connectorsMode({ HOST: '0.0.0.0', AHA_CONNECTORS: '1' }), 'local');
  assert.equal(connectorsMode({ AHA_CONNECTORS: '0' }), 'off');
  assert.equal(modeBlocks('mcp-stdio', 'local'), null);
  assert.match(modeBlocks('mcp-stdio', 'hosted')!, /your own machine/);
  assert.match(modeBlocks('sqlite', 'hosted')!, /your own machine/);
  assert.match(modeBlocks('command', 'hosted')!, /your own machine/);
  assert.equal(modeBlocks('github', 'hosted'), null);
  assert.equal(modeBlocks('web-fetch', 'hosted'), null);
  assert.match(modeBlocks('web-fetch', 'off')!, /turned off/);
});

test('manager: routes calls, keeps one MCP process per configuration and starts a new one when it changes', async () => {
  const mark = path.join(home, 'spawns.txt');
  const connector = { ...base, kind: 'mcp-stdio' as const, command: process.execPath, args: [fakeMcp], env: { FAKE_MCP_MARK: mark } };
  try {
    const tools = await listConnectorTools(connector, ctx);
    assert.ok(tools.some((t) => t.name === 'echo'));
    assert.equal((await callConnectorTool(connector, 'echo', { text: 'a' }, ctx)).text, 'echo: a');
    assert.equal((await callConnectorTool({ ...connector, name: 'renamed', trustReads: true }, 'echo', { text: 'b' }, ctx)).text, 'echo: b');
    assert.equal(fs.readFileSync(mark, 'utf8').trim().split('\n').length, 1, 'renaming does not respawn');

    await callConnectorTool({ ...connector, env: { FAKE_MCP_MARK: mark, EXTRA: '1' } }, 'echo', { text: 'c' }, ctx);
    assert.equal(fs.readFileSync(mark, 'utf8').trim().split('\n').length, 2, 'different configuration, new process');

    closeAllConnectors();
    await new Promise((r) => setTimeout(r, 200));
    await callConnectorTool(connector, 'echo', { text: 'd' }, ctx);
    assert.equal(fs.readFileSync(mark, 'utf8').trim().split('\n').length, 3, 'after closing, a fresh process');

    await assert.rejects(listConnectorTools(connector, { mode: 'hosted' }), /your own machine/);
    await assert.rejects(callConnectorTool({ ...base, kind: 'sqlite', path: 'x' }, 'query', {}, { mode: 'hosted' }), /your own machine/);
    assert.equal((await listConnectorTools({ ...base, kind: 'web-fetch' }, { mode: 'hosted' }))[0].name, 'fetch_url');
  } finally {
    closeAllConnectors();
  }
});

test('manager: a connector that dies mid-session is restarted on the next call', async () => {
  const mark = path.join(home, 'spawns2.txt');
  const connector = { ...base, kind: 'mcp-stdio' as const, command: process.execPath, args: [fakeMcp], env: { FAKE_MCP_MARK: mark } };
  try {
    await callConnectorTool(connector, 'echo', { text: '1' }, ctx);
    const pid = Number(fs.readFileSync(mark, 'utf8').trim().split('\n')[0]);
    process.kill(pid, 'SIGKILL');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await callConnectorTool(connector, 'echo', { text: '2' }, ctx)).text, 'echo: 2');
    assert.equal(fs.readFileSync(mark, 'utf8').trim().split('\n').length, 2);
  } finally {
    closeAllConnectors();
  }
});

// ---------------------------------------------------------------------------
// PostgreSQL against a real server (embedded, from PyPI): AHA_TEST_NETWORK=1 npm test
// ---------------------------------------------------------------------------

const wantsNetwork = process.env.AHA_TEST_NETWORK === '1';

test('PostgreSQL: schema tools, queries, limits, and writes refused', { skip: wantsNetwork ? false : 'set AHA_TEST_NETWORK=1 to run against an embedded PostgreSQL', timeout: 240_000 }, async () => {
  const { spawn } = await import('node:child_process');
  const server = spawn('uv', ['run', '--no-project', '--with', 'pgserver', 'python', path.join(import.meta.dirname, 'fixtures', 'pg-server.py'), path.join(home, 'pgdata')], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  server.stdout.on('data', (d) => (output += d));
  server.stderr.on('data', (d) => (output += d));
  try {
    for (let i = 0; i < 200 && !output.includes('READY'); i++) await new Promise((r) => setTimeout(r, 1000));
    const url = output.split('\n').find((l) => l.startsWith('postgresql://'));
    assert.ok(url && output.includes('READY'), `PostgreSQL did not start:\n${output}`);
    const impl = builtin.postgresImpl({ ...base, kind: 'postgres', url });

    assert.match((await impl.callTool('list_tables', {}, ctx)).text, /public \| widgets \| BASE TABLE/);
    assert.match((await impl.callTool('describe_table', { table: 'widgets' }, ctx)).text, /price \| numeric \| YES/);
    assert.equal((await impl.callTool('query', { sql: 'SELECT name FROM widgets ORDER BY price DESC LIMIT 2;' }, ctx)).text, 'name\n---\ngear\nbolt');
    assert.match((await impl.callTool('query', { sql: 'SELECT generate_series(1, 500) AS n', limit: 3 }, ctx)).text, /1\n2\n3\n… showing 3 of at least 500 rows$/);
    for (const sql of ['DELETE FROM widgets', 'SELECT 1; DELETE FROM widgets', 'COMMIT; DROP TABLE widgets']) assert.equal((await impl.callTool('query', { sql }, ctx)).isError, true, sql);
    // A write hidden in a CTE gets past the text guard and is stopped by the read-only transaction
    const sneaky = await impl.callTool('query', { sql: 'WITH d AS (DELETE FROM widgets RETURNING *) SELECT * FROM d' }, ctx);
    assert.match(sneaky.text, /read-only transaction/);
    assert.match((await impl.callTool('query', { sql: 'SELECT count(*) FROM widgets' }, ctx)).text, /\n3$/);
    assert.match((await impl.callTool('query', { sql: 'SELECT * FROM missing_table' }, ctx)).text, /relation "missing_table" does not exist/);
    assert.match((await impl.callTool('query', { sql: 'SELECT count(*) FROM generate_series(1, 900000000)' }, ctx)).text, /took too long/);
    const down = builtin.postgresImpl({ ...base, kind: 'postgres', url: 'postgresql://u:p@127.0.0.1:1/db' });
    assert.match((await down.callTool('list_tables', {}, ctx)).text, /Could not connect to the database/);
  } finally {
    server.kill('SIGTERM');
  }
});

test('MCP: the studio’s own Python MCP template works as a connector (real SDK, real uv)', { skip: wantsNetwork ? false : 'set AHA_TEST_NETWORK=1 to install the MCP SDK from PyPI', timeout: 300_000 }, async () => {
  const { execFileSync } = await import('node:child_process');
  const { TEMPLATES, templateFiles } = await import('../src/lib/templates.ts');
  const project = path.join(home, 'py-mcp-project');
  for (const [file, content] of Object.entries(templateFiles(TEMPLATES.find((t) => t.id === 'py-mcp')!).files)) {
    fs.mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
    fs.writeFileSync(path.join(project, file), content);
  }
  execFileSync('uv', ['sync'], { cwd: project, stdio: 'pipe', timeout: 240_000 });

  const connector = { ...base, kind: 'mcp-stdio' as const, command: 'uv', args: ['run', '--no-sync', '--directory', project, 'main.py', '--serve'], env: {} };
  try {
    const tools = await listConnectorTools(connector, ctx);
    assert.deepEqual(tools.map((t) => t.name).sort(), ['add', 'word_count']);
    const add = tools.find((t) => t.name === 'add')!;
    assert.deepEqual(add.inputSchema.required, ['a', 'b']);
    assert.equal(add.inputSchema.properties.a.type, 'integer');
    assert.equal((await callConnectorTool(connector, 'add', { a: 2, b: 3 }, ctx)).text, '5');
    assert.match((await callConnectorTool(connector, 'word_count', { text: 'a b c' }, ctx)).text, /"words": 3/);
    assert.equal((await callConnectorTool(connector, 'add', { a: 'x', b: 1 }, ctx)).isError, true);
  } finally {
    closeAllConnectors();
  }
});
