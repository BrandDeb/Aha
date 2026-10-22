import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { resolveUv, runPython } from '../src/lib/python.ts';
import { TEMPLATES, templateFiles } from '../src/lib/templates.ts';

const python = TEMPLATES.filter((t) => t.language === 'python');
const uv = await resolveUv();
const skipNoUv = uv ? false : 'uv is not installed';
// These install real packages from PyPI, so they only run when asked: NANOCLI_TEST_NETWORK=1 npm test
const skipNet = skipNoUv || (process.env.NANOCLI_TEST_NETWORK === '1' ? false : 'set NANOCLI_TEST_NETWORK=1 to install packages and run the Python templates');

test('there is a Python template for each AI starting point, with unique ids', () => {
  const ids = python.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ['py-llm-agent', 'py-rag', 'py-ollama', 'py-data', 'py-mcp', 'py-script']) assert.ok(ids.includes(id), id);
  for (const t of python) {
    const { files, entry } = templateFiles(t);
    assert.equal(entry, 'main.py', `${t.id}: the entry stays at the project root`);
    assert.ok(entry in files);
    if (t.id !== 'py-script') assert.match(files['pyproject.toml'], /requires-python = ">=3\.11"/, t.id);
  }
});

test('every Python template is valid Python', { skip: skipNoUv }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'py-templates-'));
  try {
    for (const t of python) {
      const root = path.join(dir, t.id);
      for (const [file, content] of Object.entries(templateFiles(t).files)) {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        writeFileSync(path.join(root, file), content);
      }
      execFileSync(uv!.bin, ['run', '--no-project', 'python', '-m', 'py_compile', 'main.py'], { cwd: root, stdio: 'pipe', timeout: 60_000 });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Behaviour, against fake local servers
// ---------------------------------------------------------------------------

type Handler = (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void;

async function serve(handler: Handler): Promise<{ url: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => handler(req, body, res));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}

const json = (res: http.ServerResponse, value: unknown) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(value));
};

async function runTemplate(id: string, env: Record<string, string>, args: string[] = []) {
  const template = python.find((t) => t.id === id)!;
  const { files, entry } = templateFiles(template);
  const chunks: string[] = [];
  const result = await runPython(
    { projectId: `tpl-${id}-0001`.slice(0, 40), action: 'run', entry, args, files, env: { NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost', ...env } },
    { onOutput: (_s, text) => void chunks.push(text) }
  );
  return { result, output: chunks.join('') };
}

test('LLM agent: calls the calculator, then reads a file, then answers', { skip: skipNet, timeout: 300_000 }, async () => {
  const requests: { auth?: string; model?: string; messages: { role: string; content?: string }[] }[] = [];
  const server = await serve((req, body, res) => {
    const parsed = JSON.parse(body);
    requests.push({ auth: req.headers.authorization, model: parsed.model, messages: parsed.messages });
    const toolResults = parsed.messages.filter((m: { role: string }) => m.role === 'tool');
    const message = toolResults.length === 0
      ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'calculate', arguments: '{"expression": "(17 * 23) + 5"}' } }] }
      : toolResults.length === 1
        ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'read_file', arguments: '{"path": "notes.txt"}' } }] }
        : { role: 'assistant', content: 'The answer is 396 and notes.txt has 3 lines.' };
    json(res, { id: 'x', object: 'chat.completion', created: 0, model: parsed.model, choices: [{ index: 0, finish_reason: 'stop', message }] });
  });
  try {
    const { result, output } = await runTemplate('py-llm-agent', { LLM_BASE_URL: `${server.url}/v1`, LLM_MODEL: 'test-model', LLM_API_KEY: 'sk-test' });
    assert.equal(result.code, 0, output);
    assert.match(output, /tool calculate\(.*\) -> 396/);
    assert.match(output, /tool read_file\(.*\) -> First line of the notes\./);
    assert.match(output, /assistant: The answer is 396 and notes\.txt has 3 lines\./);
    assert.equal(requests[0].auth, 'Bearer sk-test');
    assert.equal(requests[0].model, 'test-model');
    assert.equal(requests.length, 3, 'one request per step');
  } finally {
    server.close();
  }

  // Without configuration it explains what to set instead of failing obscurely
  const unconfigured = await runTemplate('py-llm-agent', {});
  assert.equal(unconfigured.result.code, 2);
  assert.match(unconfigured.output, /LLM_BASE_URL/);
});

test('LLM agent: the file tool cannot read outside the project', { skip: skipNet, timeout: 300_000 }, async () => {
  const server = await serve((_req, body, res) => {
    const parsed = JSON.parse(body);
    const asked = parsed.messages.some((m: { role: string }) => m.role === 'tool');
    const message = asked
      ? { role: 'assistant', content: 'done' }
      : { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'read_file', arguments: '{"path": "../../../../etc/passwd"}' } }] };
    json(res, { id: 'x', object: 'chat.completion', created: 0, model: 'm', choices: [{ index: 0, finish_reason: 'stop', message }] });
  });
  try {
    const { output } = await runTemplate('py-llm-agent', { LLM_BASE_URL: `${server.url}/v1`, LLM_MODEL: 'm' });
    assert.match(output, /error: path is outside the project/);
    assert.doesNotMatch(output, /root:/);
  } finally {
    server.close();
  }
});

test('RAG: finds the right passage with keywords alone, and with embeddings when available', { skip: skipNet, timeout: 300_000 }, async () => {
  // Nothing listens on port 9, so this exercises the keyword fallback
  const keyword = await runTemplate('py-rag', { EMBED_BASE_URL: 'http://127.0.0.1:9/v1' }, ['How do I add a dependency?']);
  assert.equal(keyword.result.code, 0, keyword.output);
  assert.match(keyword.output, /keyword score/);
  assert.match(keyword.output, /1\. \[[\d.]+\] uv\.md/);

  // Embeddings: a fake endpoint that puts "scriptc" texts and everything else in different directions
  const server = await serve((req, body, res) => {
    if (req.url?.endsWith('/embeddings')) {
      const input: string[] = JSON.parse(body).input;
      return json(res, { data: input.map((t) => ({ embedding: /scriptc|wasm|llvm/i.test(t) ? [1, 0, 0] : /uv|dependency|package/i.test(t) ? [0, 1, 0] : [0, 0, 1] })) });
    }
    json(res, { choices: [{ message: { role: 'assistant', content: 'Use uv add.' } }] });
  });
  try {
    const embedded = await runTemplate(
      'py-rag',
      { EMBED_BASE_URL: `${server.url}/v1`, LLM_BASE_URL: `${server.url}/v1`, LLM_MODEL: 'm' },
      ['Which package manager handles dependency installs?']
    );
    assert.equal(embedded.result.code, 0, embedded.output);
    assert.match(embedded.output, /search:\s+embeddings/);
    assert.match(embedded.output, /1\. \[1\.000\] uv\.md/);
    assert.match(embedded.output, /answer: Use uv add\./);
  } finally {
    server.close();
  }
});

test('Ollama: streams a local model’s answer, and explains when Ollama is not running', { skip: skipNet, timeout: 300_000 }, async () => {
  const server = await serve((req, _body, res) => {
    if (req.url === '/api/tags') return json(res, { models: [{ name: 'tiny:latest' }, { name: 'other:1b' }] });
    res.setHeader('Content-Type', 'application/x-ndjson');
    for (const piece of ['Roses ', 'are ', 'red']) res.write(`${JSON.stringify({ message: { role: 'assistant', content: piece }, done: false })}\n`);
    res.end(`${JSON.stringify({ message: { role: 'assistant', content: '' }, done: true })}\n`);
  });
  try {
    const ok = await runTemplate('py-ollama', { OLLAMA_HOST: server.url }, ['write', 'a', 'poem']);
    assert.equal(ok.result.code, 0, ok.output);
    assert.match(ok.output, /model: tiny:latest/);
    assert.match(ok.output, /Roses are red/);
  } finally {
    server.close();
  }
  const down = await runTemplate('py-ollama', { OLLAMA_HOST: 'http://127.0.0.1:9' });
  assert.equal(down.result.code, 1);
  assert.match(down.output, /Could not reach Ollama/);
});

test('Data analysis: summarises the CSV and writes report.md and summary.csv into the project', { skip: skipNet, timeout: 600_000 }, async () => {
  const { result, output } = await runTemplate('py-data', {}, ['--top', '2']);
  assert.equal(result.code, 0, output);
  assert.match(output, /20 orders/);
  assert.match(output, /Top 2 products/);
  assert.match(result.changed['report.md'], /# Sales report/);
  assert.match(result.changed['report.md'], /Total revenue/);
  assert.match(result.changed['summary.csv'], /^product,units,revenue/);
  assert.ok('uv.lock' in result.changed, 'the lock file comes back to the project');
});

test('MCP server: lists its tools and calls them', { skip: skipNet, timeout: 600_000 }, async () => {
  const { result, output } = await runTemplate('py-mcp', {});
  assert.equal(result.code, 0, output);
  assert.match(output, /add: Add two integers\./);
  assert.match(output, /word_count: Count the words/);
  assert.match(output, /add\(2, 3\)\s+= 5/);
  assert.match(output, /greeting\('Ada'\)\s+= Hello, Ada!/);
});

test('Single-file script: dependencies come from the inline block, with no pyproject', { skip: skipNet, timeout: 300_000 }, async () => {
  const { result, output } = await runTemplate('py-script', {});
  assert.equal(result.code, 0, output);
  assert.match(output, /uv in one file/);
  assert.ok(!('pyproject.toml' in result.changed));
});
