import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, CATALOG_CATEGORIES, connectorFrom, searchCatalog, setupLabel } from '../src/lib/connectors/catalog.ts';
import { parseConnector } from '../src/lib/connectors/types.ts';

test('the catalog is well formed: unique ids, every category used, inputs referenced', () => {
  assert.ok(CATALOG.length >= 45);
  assert.equal(new Set(CATALOG.map((e) => e.id)).size, CATALOG.length);
  for (const c of CATALOG_CATEGORIES) assert.ok(CATALOG.some((e) => e.category === c), c);
  for (const e of CATALOG) {
    const text = JSON.stringify(e.transport);
    for (const input of e.inputs) assert.ok(text.includes(`{${input.key}}`), `${e.id} uses {${input.key}}`);
    assert.ok(/^https:\/\//.test(e.homepage), e.id);
    if (e.auth === 'oauth') assert.equal(e.runs, 'local', `${e.id}: OAuth goes through mcp-remote on this machine`);
  }
});

test('every entry becomes a valid connector once its inputs are filled', () => {
  for (const e of CATALOG) {
    const values = Object.fromEntries(e.inputs.map((i) => [i.key, `value-${i.key}`]));
    const made = connectorFrom(e, values);
    assert.ok(!('error' in made), `${e.id}: ${'error' in made ? made.error : ''}`);
    const parsed = parseConnector({ ...made, id: 'c1' });
    assert.ok(!('error' in parsed), `${e.id}: ${'error' in parsed ? parsed.error : ''}`);
  }
});

test('inputs fill headers, environment and arguments; optional ones disappear when empty', () => {
  const gh = CATALOG.find((e) => e.id === 'github')!;
  assert.deepEqual(connectorFrom(gh, {}), { error: 'Personal access token is needed' });
  assert.deepEqual(connectorFrom(gh, { token: 'abc' }), { name: 'GitHub', enabled: true, trustReads: false, kind: 'mcp-http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer abc' } });
  const hf = CATALOG.find((e) => e.id === 'huggingface')!;
  assert.deepEqual((connectorFrom(hf, {}) as unknown as { headers: object }).headers, {});
  const supa = CATALOG.find((e) => e.id === 'supabase')!;
  const withRef = connectorFrom(supa, { token: 't', project: 'abcd' }) as unknown as { args: string[]; env: Record<string, string> };
  assert.deepEqual(withRef.args, ['-y', '@supabase/mcp-server-supabase@latest', '--read-only', '--project-ref=abcd']);
  assert.deepEqual(withRef.env, { SUPABASE_ACCESS_TOKEN: 't' });
  assert.deepEqual((connectorFrom(supa, { token: 't' }) as unknown as { args: string[] }).args, ['-y', '@supabase/mcp-server-supabase@latest', '--read-only']);
  const linear = connectorFrom(CATALOG.find((e) => e.id === 'linear')!, {}) as unknown as { command: string; args: string[] };
  assert.deepEqual([linear.command, ...linear.args], ['npx', '-y', 'mcp-remote', 'https://mcp.linear.app/mcp']);
  assert.equal((connectorFrom(CATALOG.find((e) => e.id === 'context7')!, {}) as unknown as { trustReads: boolean }).trustReads, true);
});

test('search and labels', () => {
  assert.deepEqual(searchCatalog('postgres serverless').map((e) => e.id), ['neon']);
  assert.ok(searchCatalog('', 'Web3').every((e) => e.category === 'Web3'));
  assert.ok(searchCatalog('stripe').some((e) => e.id === 'stripe'));
  assert.ok(searchCatalog('library docs').some((e) => e.id === 'context7'));
  assert.ok(searchCatalog('databases').some((e) => e.id === 'supabase'));
  assert.equal(setupLabel(CATALOG.find((e) => e.id === 'context7')!), 'Remote · no setup');
  assert.equal(setupLabel(CATALOG.find((e) => e.id === 'sentry')!), 'Sign in · runs locally');
  assert.equal(setupLabel(CATALOG.find((e) => e.id === 'firecrawl')!), 'Local · Node · key');
});
