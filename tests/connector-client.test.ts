import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPairs, joinArgs, parsePairs, PRESETS, splitArgs } from '../src/workspace/connector-forms.ts';
import { buildConnectorTools, callConnectorTool, riskFor, toolName } from '../src/workspace/connectors-client.ts';
import { parseConnector, type Connector, type ConnectorTool } from '../src/lib/connectors/types.ts';
import { validateArgs } from '../src/lib/agent/loop.ts';

test('splitArgs and joinArgs handle quotes and round-trip', () => {
  assert.deepEqual(splitArgs('-y @scope/pkg --flag'), ['-y', '@scope/pkg', '--flag']);
  assert.deepEqual(splitArgs(`run "my file.py" 'it''s' ""`), ['run', 'my file.py', 'its', '']);
  assert.deepEqual(splitArgs('  a   b  '), ['a', 'b']);
  assert.deepEqual(splitArgs(''), []);
  for (const args of [['a', 'b c', ''], ['--path', '/tmp/my dir/x'], ['say "hi"'], []]) assert.deepEqual(splitArgs(joinArgs(args)), args, JSON.stringify(args));
});

test('parsePairs and formatPairs read KEY=value and Name: value lists', () => {
  assert.deepEqual(parsePairs('A=1\n# comment\n\nB = two = three\nbroken\n=novalue'), { A: '1', B: 'two = three' });
  assert.deepEqual(parsePairs('Authorization: Bearer abc\nX-Key:  k', ':'), { Authorization: 'Bearer abc', 'X-Key': 'k' });
  assert.equal(formatPairs({ A: '1', B: '2' }), 'A=1\nB=2');
  assert.equal(formatPairs({ Authorization: 'Bearer x' }, ':'), 'Authorization: Bearer x');
});

test('every preset starts from a configuration the server would accept once filled in', () => {
  const ids = new Set<string>();
  for (const preset of PRESETS) {
    assert.ok(!ids.has(preset.id), `duplicate preset ${preset.id}`);
    ids.add(preset.id);
    assert.ok(preset.note.length > 20, preset.id);
    const made = { ...preset.make(), id: 'c1' } as Record<string, unknown>;
    // Some fields are placeholders the user must fill in; fill the empty ones and check the rest is valid
    const filled = { ...made, apiKey: made.apiKey === '' ? 'k' : made.apiKey, path: made.path === '' ? '/x.db' : made.path, command: made.command === '' ? 'node' : made.command };
    if (preset.id === 'command') Object.assign(filled, { tool: { name: 'my_tool', description: 'Does a thing', command: 'node', args: [], params: [] } });
    assert.ok(!('error' in (parseConnector(filled) as object)), `${preset.id}: ${JSON.stringify(parseConnector(filled))}`);
  }
  // Presets that run npx/uvx only name packages from their official publishers
  const spawned = PRESETS.map((p) => p.make() as Record<string, unknown>).filter((c) => c.kind === 'mcp-stdio' && c.command !== '') as { args: string[] }[];
  const packages = spawned.map((c) => c.args.find((a) => /^(@|mcp-server)/.test(a)));
  assert.deepEqual(packages.sort(), ['@modelcontextprotocol/server-filesystem', '@modelcontextprotocol/server-memory', '@playwright/mcp@latest', '@upstash/context7-mcp', 'mcp-server-git']);
});

test('toolName gives the model a valid, unique name', () => {
  const taken = new Set<string>();
  assert.equal(toolName('GitHub (work)', 'search_code', taken), 'github_work__search_code');
  assert.equal(toolName('GitHub (work)', 'search_code', taken), 'github_work__search_code_2');
  assert.equal(toolName('X', 'weird.tool/name', taken), 'x__weird_tool_name');
  const long = toolName('A'.repeat(40), 'b'.repeat(80), taken);
  assert.ok(long.length <= 64 && /^[A-Za-z0-9_-]+$/.test(long), long);
});

const base = { id: 'c1', name: 'Docs', enabled: true, trustReads: false };
const tools: ConnectorTool[] = [
  { name: 'read_thing', description: 'Reads', inputSchema: { type: 'object' as const, properties: { id: { type: 'string' } }, required: ['id'] }, readOnly: true },
  { name: 'change_thing', description: '', inputSchema: { type: 'object' as const, properties: {} }, readOnly: false },
];

test('riskFor: read-only tools are trusted only when the user said so; commands always ask', () => {
  const github = parseConnector({ ...base, kind: 'github' }) as Connector;
  assert.equal(riskFor(github, tools[0]), 'external');
  assert.equal(riskFor({ ...github, trustReads: true }, tools[0]), 'read');
  assert.equal(riskFor({ ...github, trustReads: true }, tools[1]), 'external');
  const command = parseConnector({ ...base, kind: 'command', trustReads: true, tool: { name: 't', description: 'd', command: 'x' } }) as Connector;
  assert.equal(riskFor(command, tools[0]), 'exec');
});

test('buildConnectorTools lists enabled connectors, reports failures, and calls through the server', async () => {
  const calls: { body: Record<string, unknown> }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ body });
    const connector = body.connector as { name: string };
    if (body.action === 'tools') {
      if (connector.name === 'Broken') return new Response(JSON.stringify({ error: 'The server exited (code 1).' }), { status: 502 });
      return new Response(JSON.stringify({ ok: true, tools }));
    }
    if (body.tool === 'change_thing') return new Response(JSON.stringify({ ok: true, text: 'it failed', isError: true }));
    if (body.tool === 'explode') return new Response('<html>oops</html>', { status: 500 });
    return new Response(JSON.stringify({ ok: true, text: `read ${(body.args as { id: string }).id}`, isError: false }));
  }) as unknown as typeof fetch;
  try {
    const docs = { ...base, kind: 'web-fetch', trustReads: true } as Connector;
    const built = await buildConnectorTools([
      docs,
      { ...base, id: 'c2', name: 'Broken', kind: 'web-fetch' } as Connector,
      { ...base, id: 'c3', name: 'Off', kind: 'web-fetch', enabled: false } as Connector,
    ]);
    assert.deepEqual(built.connected, [{ name: 'Docs', tools: 2 }]);
    assert.deepEqual(built.failed, [{ name: 'Broken', error: 'The server exited (code 1).' }]);
    assert.deepEqual(built.tools.map((t) => [t.name, t.risk]), [['docs__read_thing', 'read'], ['docs__change_thing', 'external']]);
    assert.equal(built.tools[0].description, '[Docs] Reads');
    assert.equal(calls.length, 2, 'disabled connectors are not contacted');

    // The agent loop's argument validation works on connector schemas
    assert.match(validateArgs(built.tools[0], {})!, /Missing required argument “id”/);

    assert.deepEqual(await built.tools[0].run({ id: '42' }, {}), { ok: true, content: 'read 42' });
    assert.deepEqual(await built.tools[1].run({}, {}), { ok: false, content: 'it failed' });
    const sent = calls.at(-1)!.body;
    assert.deepEqual([sent.action, sent.tool], ['call', 'change_thing']);
    assert.match((await callConnectorTool(docs, 'explode', {})).content, /server answered 500/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
