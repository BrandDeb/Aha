/**
 * Built-in field kits. Each one runs offline as soon as it opens (sample data,
 * a dry run, tests), so the first thing you see is it working; then the
 * playbook takes you to the real system.
 */

import type { Kit } from './kits.ts';

export interface LibraryKit {
  kit: Kit;
  files: Record<string, string>;
}

// ---------------------------------------------------------------------------
// FDE: integrate a customer's API
// ---------------------------------------------------------------------------

const apiIntegration: LibraryKit = {
  kit: {
    format: 1,
    id: 'customer-api-integration',
    name: 'Customer API integration',
    version: '1.0.0',
    publisher: 'NanoCLI',
    audience: 'fde',
    summary: 'Pull records from a customer’s REST API into your shape: retries, rate limits, pagination, field mapping with tests, and a dry run on sample data.',
    entry: 'src/index.js',
    focus: 'A reliable sync from the customer’s API into our record format, with every field mapped and tested',
    env: [
      { name: 'CUSTOMER_API_BASE_URL', description: 'The customer’s API, up to the version', required: true, secret: false, example: 'https://api.example.com/v1' },
      { name: 'CUSTOMER_API_KEY', description: 'Their API key (sent as a Bearer token)', required: true, secret: true },
    ],
    connectors: [{ name: 'Web pages', description: 'Lets the agent read the customer’s API documentation', config: { kind: 'web-fetch' } }],
    steps: [
      { title: 'See it work on sample data', detail: 'Run the dry run: it reads fixtures/ instead of the network, maps every record and writes out/records.json.' },
      {
        title: 'Learn their API',
        detail: 'Give the agent the documentation URL; it writes docs/api-notes.md (auth, pagination, rate limits, the objects and fields you need).',
        agent: 'Read the customer’s API documentation (ask me for the URL if docs/ has none) and write docs/api-notes.md: authentication, pagination, rate limits and error codes, and for each object we need, its fields and types. Do not change any code.',
      },
      { title: 'Add credentials', detail: 'Set CUSTOMER_API_BASE_URL and CUSTOMER_API_KEY below. They stay in this browser and are never exported with the kit.' },
      {
        title: 'Map the fields',
        detail: 'The agent maps what docs/api-notes.md describes, with a fixture and a test per field.',
        agent: 'Update src/mapping.js so every field in docs/api-notes.md that we need is mapped into our record format. For each change add a record to fixtures/ and a test in test/mapping.test.js, then run the tests and the dry run.',
      },
      { title: 'Run it for real', detail: 'Run `sync` without --dry-run against their API. Errors name the record and the field.' },
      {
        title: 'Hand it over',
        detail: 'A HANDOFF.md the customer’s team can run it from.',
        agent: 'Write HANDOFF.md for the customer’s engineers: what the sync does, how to configure and run it, what happens on errors and rate limits, and known limits. Keep it under a page and do not include any secret values.',
      },
    ],
    checks: [
      { label: 'Dry run maps the sample data', entry: 'src/index.js', args: ['sync', '--dry-run'], expect: 'Synced 3 records' },
      { label: 'Mapping tests pass', entry: 'test/mapping.test.js', args: [], expect: '\\bfail 0\\b' },
    ],
  },
  files: {
    'package.json': JSON.stringify({ name: 'customer-api-integration', private: true, type: 'module', scripts: { sync: 'node src/index.js sync', 'dry-run': 'node src/index.js sync --dry-run', test: 'node --test' } }, null, 2) + '\n',
    'src/index.js': `// Sync records from the customer's API into our format.
//   node src/index.js sync            against CUSTOMER_API_BASE_URL
//   node src/index.js sync --dry-run  on fixtures/ (no network, no key)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createClient } from './client.js';
import { mapRecord } from './mapping.js';

const [command = 'sync', ...flags] = process.argv.slice(2);
const dryRun = flags.includes('--dry-run');

function fixtureFetch(url) {
  // Serves fixtures/page-N.json for ?page=N, like the real API would
  const page = new URL(url).searchParams.get('page') ?? '1';
  const body = readFileSync(new URL(\`../fixtures/page-\${page}.json\`, import.meta.url), 'utf8');
  return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }));
}

async function sync() {
  const client = dryRun
    ? createClient({ baseUrl: 'https://fixtures.invalid', apiKey: 'dry-run', fetchImpl: fixtureFetch })
    : createClient({ baseUrl: process.env.CUSTOMER_API_BASE_URL, apiKey: process.env.CUSTOMER_API_KEY });
  const records = [];
  const problems = [];
  for await (const raw of client.paginate('/customers')) {
    const result = mapRecord(raw);
    if (result.ok) records.push(result.record);
    else problems.push(\`\${raw.id ?? '?'}: \${result.errors.join('; ')}\`);
  }
  mkdirSync('out', { recursive: true });
  writeFileSync('out/records.json', JSON.stringify(records, null, 2) + '\\n');
  console.log(\`Synced \${records.length} records\${dryRun ? ' (dry run)' : ''} to out/records.json\`);
  if (problems.length) {
    console.error(\`\${problems.length} record(s) could not be mapped:\\n  \${problems.join('\\n  ')}\`);
    process.exitCode = 1;
  }
}

if (command === 'sync') await sync();
else {
  console.error(\`Unknown command: \${command}. Try: sync [--dry-run]\`);
  process.exitCode = 2;
}
`,
    'src/client.js': `// The one place that talks to the customer's API: auth, retries with backoff
// (honouring Retry-After), and cursor pagination. Keys are never logged.

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createClient({ baseUrl, apiKey, fetchImpl = fetch, maxRetries = 4 }) {
  if (!baseUrl) throw new Error('Set CUSTOMER_API_BASE_URL (or use --dry-run)');
  if (!apiKey) throw new Error('Set CUSTOMER_API_KEY (or use --dry-run)');
  const root = baseUrl.replace(/\\/+$/, '');

  async function get(path, params = {}) {
    const url = new URL(root + path);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    for (let attempt = 0; ; attempt++) {
      const response = await fetchImpl(url.toString(), { headers: { authorization: \`Bearer \${apiKey}\`, accept: 'application/json' } });
      if (response.ok) return response.json();
      if (!RETRYABLE.has(response.status) || attempt >= maxRetries) {
        throw new Error(\`GET \${path} failed: \${response.status} \${response.statusText}\`);
      }
      const retryAfter = Number(response.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt);
    }
  }

  /** Every item across pages: { data: [...], next_page: n | null } */
  async function* paginate(path) {
    for (let page = 1; page; ) {
      const body = await get(path, { page });
      yield* body.data ?? [];
      page = body.next_page ?? null;
    }
  }

  return { get, paginate };
}
`,
    'src/mapping.js': `// The customer's record -> ours. Every field we rely on is checked; a record
// that can't be mapped is reported with the reason instead of being dropped.

export function mapRecord(raw) {
  const errors = [];
  if (typeof raw.id !== 'string' && typeof raw.id !== 'number') errors.push('id is missing');
  if (typeof raw.full_name !== 'string' || !raw.full_name.trim()) errors.push('full_name is missing');
  const email = typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : '';
  if (email && !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) errors.push(\`email is invalid: \${raw.email}\`);
  const created = raw.created_at ? new Date(raw.created_at) : null;
  if (created && Number.isNaN(created.getTime())) errors.push(\`created_at is not a date: \${raw.created_at}\`);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    record: {
      externalId: String(raw.id),
      name: raw.full_name.trim(),
      email: email || null,
      createdAt: created ? created.toISOString() : null,
      plan: raw.subscription?.plan ?? 'none',
    },
  };
}
`,
    'test/mapping.test.js': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapRecord } from '../src/mapping.js';

test('maps a complete record', () => {
  const result = mapRecord({ id: 7, full_name: ' Ada Lovelace ', email: 'ADA@example.com', created_at: '2024-03-01T10:00:00Z', subscription: { plan: 'pro' } });
  assert.deepEqual(result, { ok: true, record: { externalId: '7', name: 'Ada Lovelace', email: 'ada@example.com', createdAt: '2024-03-01T10:00:00.000Z', plan: 'pro' } });
});

test('optional fields may be missing', () => {
  const result = mapRecord({ id: 'c_1', full_name: 'Grace Hopper' });
  assert.equal(result.ok, true);
  assert.equal(result.record.email, null);
  assert.equal(result.record.plan, 'none');
});

test('a bad record says why', () => {
  const result = mapRecord({ full_name: '', email: 'not-an-email' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ['id is missing', 'full_name is missing', 'email is invalid: not-an-email']);
});
`,
    'fixtures/page-1.json': JSON.stringify({ data: [{ id: 1, full_name: 'Ada Lovelace', email: 'ada@example.com', created_at: '2024-01-05T09:00:00Z', subscription: { plan: 'pro' } }, { id: 2, full_name: 'Alan Turing', email: 'alan@example.com', created_at: '2024-02-11T12:30:00Z' }], next_page: 2 }, null, 2) + '\n',
    'fixtures/page-2.json': JSON.stringify({ data: [{ id: 3, full_name: 'Katherine Johnson', email: null, created_at: '2024-03-20T08:15:00Z', subscription: { plan: 'team' } }], next_page: null }, null, 2) + '\n',
    '.env.example': 'CUSTOMER_API_BASE_URL=https://api.example.com/v1\nCUSTOMER_API_KEY=\n',
    'agent/prompt.md': `This is a customer integration. Work like a careful forward-deployed engineer:

- All network access goes through src/client.js. Never call fetch anywhere else.
- Never print, log or write API keys or customer personal data beyond what the task needs. Fixtures are anonymised.
- Every mapping change gets a fixture record and a test in test/mapping.test.js. Run the tests and the dry run (node src/index.js sync --dry-run) before you finish.
- A record that can't be mapped is reported with the reason, never dropped silently.
- Prefer small, reviewable changes; explain anything about the customer's API you had to assume.
`,
    'agent/skills/add-endpoint.md': `# Add an endpoint

1. Note the endpoint in docs/api-notes.md: path, auth, pagination, rate limit.
2. Add a fixture page for it under fixtures/ (anonymised, 2-3 records).
3. Add a mapping function next to mapRecord with its own tests.
4. Call it from src/index.js through client.paginate.
5. Run the tests and the dry run; show the output.
`,
    'README.md': `# Customer API integration

\`node src/index.js sync --dry-run\` runs on fixtures/ with no network. Set CUSTOMER_API_BASE_URL and CUSTOMER_API_KEY to run it against the real API. \`node --test\` runs the tests.

The kit's playbook (Kit tab) walks through the engagement; .nanocli/kit.json describes it.
`,
  },
};

// ---------------------------------------------------------------------------
// ISV: let AI agents use your product (an MCP server)
// ---------------------------------------------------------------------------

const mcpServer: LibraryKit = {
  kit: {
    format: 1,
    id: 'product-mcp-server',
    name: 'MCP server for your product',
    version: '1.0.0',
    publisher: 'NanoCLI',
    audience: 'isv',
    summary: 'Let AI agents (Claude, Cursor, this studio) use your product through MCP. A dependency-free server with two example tools, a self-test, and the rules for tools agents use well.',
    entry: 'server.js',
    focus: 'An MCP server that exposes our product’s most common tasks as well-described, safe tools',
    env: [
      { name: 'PRODUCT_API_BASE_URL', description: 'Your product’s API (the tools fall back to sample data without it)', required: false, secret: false, example: 'https://api.yourproduct.com' },
      { name: 'PRODUCT_API_KEY', description: 'A key the server uses to call your API', required: false, secret: true },
    ],
    connectors: [],
    steps: [
      { title: 'Run the self-test', detail: 'It speaks MCP to the server in-process: initialize, list tools, call each one.' },
      {
        title: 'Pick the tasks to expose',
        detail: 'The agent proposes the tools from your docs: what customers most often ask an assistant to do.',
        agent: 'Read docs/ and README.md, then write docs/tools-plan.md: the 3-6 tasks customers most often need from our product, one MCP tool per task, each with a name, a one-sentence description, its inputs and whether it only reads. Do not write code yet.',
      },
      {
        title: 'Build the tools',
        detail: 'One tool at a time, each with a self-test case.',
        agent: 'Implement the tools in docs/tools-plan.md in tools.js following agent/skills/add-tool.md, one at a time, each with a case in selftest.js. Run the self-test after each one.',
      },
      { title: 'Connect your API', detail: 'Set PRODUCT_API_BASE_URL and PRODUCT_API_KEY; the tools call it instead of the sample data.' },
      {
        title: 'Write the install guide',
        detail: 'How your customers add it to Claude Desktop, Cursor and other MCP clients.',
        agent: 'Write INSTALL.md for our customers: how to add this MCP server to Claude Desktop (claude_desktop_config.json), Cursor and other MCP clients, which environment variables it needs, and what each tool does. No real keys.',
      },
    ],
    checks: [{ label: 'MCP self-test passes', entry: 'selftest.js', args: [], expect: 'Self-test passed' }],
  },
  files: {
    'package.json': JSON.stringify({ name: 'product-mcp-server', private: true, type: 'module', bin: { 'product-mcp': 'server.js' }, scripts: { start: 'node server.js', test: 'node selftest.js' } }, null, 2) + '\n',
    'server.js': `#!/usr/bin/env node
// A Model Context Protocol server over stdio, with no dependencies: one JSON-RPC
// message per line. Add tools in tools.js; this file is the protocol.
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { TOOLS } from './tools.js';

const PROTOCOL = '2025-06-18';
const INFO = { name: 'product-mcp', version: '1.0.0' };

/** Handle one message; returns the reply, or null for notifications */
export async function handle(message) {
  const { id, method, params = {} } = message;
  if (id === undefined) return null; // notifications (initialized, cancelled) need no reply
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  const error = (code, text) => ({ jsonrpc: '2.0', id, error: { code, message: text } });
  switch (method) {
    case 'initialize':
      return reply({ protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: INFO });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({
        tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: t.readOnly } })),
      });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return error(-32602, \`Unknown tool: \${params.name}\`);
      try {
        const text = await tool.run(params.arguments ?? {});
        return reply({ content: [{ type: 'text', text }] });
      } catch (e) {
        // Tool failures are results the model can read and recover from, not protocol errors
        return reply({ content: [{ type: 'text', text: \`Error: \${e.message}\` }], isError: true });
      }
    }
    default:
      return error(-32601, \`Method not found: \${method}\`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const lines = createInterface({ input: process.stdin });
  lines.on('line', async (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\\n');
    }
    const answer = await handle(message);
    if (answer) process.stdout.write(JSON.stringify(answer) + '\\n');
  });
}
`,
    'tools.js': `// The tools agents can call. Good tools: a verb_noun name, a description that
// says when to use it, a strict input schema, and an honest readOnly flag.

const SAMPLE_PROJECTS = [
  { id: 'p1', name: 'Website relaunch', status: 'active', owner: 'ada' },
  { id: 'p2', name: 'Billing migration', status: 'blocked', owner: 'grace' },
  { id: 'p3', name: 'Mobile app', status: 'done', owner: 'alan' },
];

async function api(path) {
  const base = process.env.PRODUCT_API_BASE_URL;
  if (!base) return null; // no API configured: callers use sample data
  const response = await fetch(base.replace(/\\/+$/, '') + path, { headers: { authorization: \`Bearer \${process.env.PRODUCT_API_KEY ?? ''}\` } });
  if (!response.ok) throw new Error(\`The API answered \${response.status} for \${path}\`);
  return response.json();
}

export const TOOLS = [
  {
    name: 'list_projects',
    description: 'List projects, optionally only those with a given status. Use it to find a project before asking about it.',
    readOnly: true,
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['active', 'blocked', 'done'], description: 'Only projects with this status' } } },
    async run({ status }) {
      const projects = (await api('/projects')) ?? SAMPLE_PROJECTS;
      const shown = status ? projects.filter((p) => p.status === status) : projects;
      return shown.length ? shown.map((p) => \`\${p.id}  \${p.name}  [\${p.status}]  owner: \${p.owner}\`).join('\\n') : 'No projects match.';
    },
  },
  {
    name: 'get_project',
    description: 'Get one project by id (from list_projects).',
    readOnly: true,
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'The project id, like p1' } }, required: ['id'] },
    async run({ id }) {
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error('id must be a project id like p1');
      const project = (await api(\`/projects/\${encodeURIComponent(id)}\`)) ?? SAMPLE_PROJECTS.find((p) => p.id === id);
      if (!project) throw new Error(\`No project with id \${id}. Use list_projects to find it.\`);
      return JSON.stringify(project, null, 2);
    },
  },
];
`,
    'selftest.js': `// Speaks MCP to the server in-process and checks every answer.
import assert from 'node:assert/strict';
import { handle } from './server.js';

let id = 0;
const call = (method, params) => handle({ jsonrpc: '2.0', id: ++id, method, params });

const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'selftest', version: '1' } });
assert.ok(init.result.capabilities.tools, 'advertises tools');

const { tools } = (await call('tools/list')).result;
for (const tool of tools) {
  assert.match(tool.name, /^[a-z][a-z0-9_]*$/, \`\${tool.name}: snake_case name\`);
  assert.ok(tool.description.length > 20, \`\${tool.name}: a description that says when to use it\`);
  assert.equal(tool.inputSchema.type, 'object', \`\${tool.name}: an object input schema\`);
}

const listed = await call('tools/call', { name: 'list_projects', arguments: { status: 'blocked' } });
assert.match(listed.result.content[0].text, /Billing migration/);
const one = await call('tools/call', { name: 'get_project', arguments: { id: 'p1' } });
assert.match(one.result.content[0].text, /Website relaunch/);
const missing = await call('tools/call', { name: 'get_project', arguments: { id: 'nope' } });
assert.equal(missing.result.isError, true, 'a failed call is a readable error result');
assert.equal((await call('nope/nope')).error.code, -32601);
assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);

console.log(\`Self-test passed: \${tools.length} tools (\${tools.map((t) => t.name).join(', ')})\`);
`,
    'docs/product.md': `# Your product

Replace this with a short description of your product and its API: the objects (projects, users, invoices…), the common tasks customers do, and links to your API reference. The agent reads this when it designs tools.
`,
    'agent/prompt.md': `This is an MCP server that lets AI agents use our product. Work like an API designer whose users are models:

- One tool per task a customer actually has, not one per endpoint. Name tools verb_noun in snake_case.
- The description says what it does and when to use it; parameter descriptions give an example value.
- readOnly is true only if the tool cannot change anything.
- Validate every input; failures return a readable error result (isError) that tells the model how to recover.
- Never return secrets, tokens or more personal data than the task needs. Keep outputs short and structured.
- Add a self-test case for every tool and run node selftest.js before you finish.
`,
    'agent/skills/add-tool.md': `# Add a tool

1. Add an entry to TOOLS in tools.js: name, description, readOnly, inputSchema, run.
2. Call the product API through api(); fall back to sample data when PRODUCT_API_BASE_URL is unset.
3. Validate inputs at the top of run() and throw an Error with a helpful message on bad input.
4. Add a call to selftest.js for the happy path and one failure.
5. Run node selftest.js and show the output.
`,
    'README.md': `# MCP server for your product

\`node selftest.js\` checks the server in-process. \`node server.js\` runs it over stdio for MCP clients.

The Kit tab walks through designing the tools, connecting your API and writing the install guide for your customers.
`,
  },
};

// ---------------------------------------------------------------------------
// FDE: a data pipeline proof of concept (Python, standard library only)
// ---------------------------------------------------------------------------

const dataPipeline: LibraryKit = {
  kit: {
    format: 1,
    id: 'data-pipeline-poc',
    name: 'Data pipeline proof of concept',
    version: '1.0.0',
    publisher: 'NanoCLI',
    audience: 'fde',
    summary: 'Load a customer’s CSV export into a warehouse table with validation and a rejects report. Runs on SQLite with sample data; point it at their Postgres when ready.',
    entry: 'pipeline.py',
    focus: 'A validated load of the customer’s export into the warehouse, with a clear rejects report',
    env: [{ name: 'DATABASE_URL', description: 'The customer’s Postgres (optional: the proof of concept uses SQLite)', required: false, secret: true, example: 'postgresql://user@host:5432/warehouse' }],
    connectors: [{ name: 'Customer warehouse', description: 'Lets the agent inspect the customer’s tables (asks you before each query)', config: { kind: 'postgres', url: '${DATABASE_URL}' } }],
    steps: [
      { title: 'Load the sample', detail: 'pipeline.py loads data/orders.csv into out/warehouse.db and prints what it rejected and why.' },
      {
        title: 'Profile their export',
        detail: 'Drop the customer’s CSV into data/ and let the agent describe it.',
        agent: 'Profile every CSV in data/: columns, types, null rates, odd values and likely keys. Write docs/data-profile.md and propose changes to schema.py for anything the current schema would reject. Do not change code yet.',
      },
      {
        title: 'Fit the schema',
        detail: 'The agent updates the schema and tests from the profile.',
        agent: 'Update schema.py from docs/data-profile.md, add a test in test_pipeline.py for each rule you add or change, and run the tests and the pipeline.',
      },
      { title: 'Point it at their warehouse', detail: 'Set DATABASE_URL and add the warehouse connector so the agent can look at the target tables (each query asks you first).' },
      {
        title: 'Write the results up',
        detail: 'A one-page summary for the customer.',
        agent: 'Write RESULTS.md for the customer: what was loaded, how many rows were rejected and the main reasons, data quality issues they should fix at the source, and next steps to production.',
      },
    ],
    checks: [
      { label: 'Pipeline loads the sample', entry: 'pipeline.py', args: [], expect: 'Loaded 5 rows, rejected 1' },
      { label: 'Tests pass', entry: 'test_pipeline.py', args: [], expect: '\\bOK\\b' },
    ],
  },
  files: {
    'pipeline.py': `"""Load a CSV export into the warehouse table, validating every row.

    python pipeline.py [path/to.csv]   (default: data/orders.csv)
"""
import csv
import os
import sqlite3
import sys

from schema import COLUMNS, validate

SOURCE = sys.argv[1] if len(sys.argv) > 1 else "data/orders.csv"


def load(path: str, db_path: str = "out/warehouse.db") -> tuple[int, list[str]]:
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    rejected: list[str] = []
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        for line_no, raw in enumerate(csv.DictReader(f), start=2):
            row, errors = validate(raw)
            if errors:
                rejected.append(f"line {line_no}: {'; '.join(errors)}")
            else:
                rows.append(row)
    with sqlite3.connect(db_path) as db:
        db.execute(f"CREATE TABLE IF NOT EXISTS orders ({', '.join(f'{c} {t}' for c, t in COLUMNS)}, PRIMARY KEY (order_id))")
        db.executemany(
            f"INSERT OR REPLACE INTO orders VALUES ({', '.join('?' for _ in COLUMNS)})",
            [tuple(r[c] for c, _ in COLUMNS) for r in rows],
        )
    return len(rows), rejected


if __name__ == "__main__":
    loaded, rejected = load(SOURCE)
    print(f"Loaded {loaded} rows, rejected {len(rejected)} from {SOURCE}")
    for reason in rejected:
        print(f"  rejected {reason}")
`,
    'schema.py': `"""The warehouse table, and the rules a row must pass to get into it."""
from datetime import date

COLUMNS = [("order_id", "TEXT"), ("customer", "TEXT"), ("amount_cents", "INTEGER"), ("currency", "TEXT"), ("ordered_on", "TEXT")]
CURRENCIES = {"USD", "EUR", "GBP"}


def validate(raw: dict) -> tuple[dict, list[str]]:
    errors = []
    order_id = (raw.get("order_id") or "").strip()
    if not order_id:
        errors.append("order_id is empty")
    customer = (raw.get("customer") or "").strip()
    if not customer:
        errors.append("customer is empty")
    try:
        amount_cents = round(float(raw.get("amount") or "") * 100)
        if amount_cents < 0:
            errors.append("amount is negative")
    except ValueError:
        amount_cents = 0
        errors.append(f"amount is not a number: {raw.get('amount')!r}")
    currency = (raw.get("currency") or "").strip().upper()
    if currency not in CURRENCIES:
        errors.append(f"currency {currency!r} is not one of {sorted(CURRENCIES)}")
    try:
        ordered_on = date.fromisoformat((raw.get("ordered_on") or "").strip()).isoformat()
    except ValueError:
        ordered_on = ""
        errors.append(f"ordered_on is not a date: {raw.get('ordered_on')!r}")
    row = {"order_id": order_id, "customer": customer, "amount_cents": amount_cents, "currency": currency, "ordered_on": ordered_on}
    return row, errors
`,
    'test_pipeline.py': `import os
import tempfile
import unittest

from pipeline import load
from schema import validate


class SchemaTest(unittest.TestCase):
    def test_good_row(self):
        row, errors = validate({"order_id": "A1", "customer": "acme", "amount": "12.50", "currency": "usd", "ordered_on": "2024-05-01"})
        self.assertEqual(errors, [])
        self.assertEqual(row["amount_cents"], 1250)
        self.assertEqual(row["currency"], "USD")

    def test_bad_row_says_why(self):
        _, errors = validate({"order_id": "", "customer": "x", "amount": "abc", "currency": "XYZ", "ordered_on": "yesterday"})
        self.assertEqual(len(errors), 4)


class PipelineTest(unittest.TestCase):
    def test_sample_loads(self):
        with tempfile.TemporaryDirectory() as tmp:
            loaded, rejected = load("data/orders.csv", os.path.join(tmp, "w.db"))
        self.assertEqual((loaded, len(rejected)), (5, 1))


if __name__ == "__main__":
    unittest.main()
`,
    'data/orders.csv': `order_id,customer,amount,currency,ordered_on
A100,acme,120.00,USD,2024-05-01
A101,globex,89.99,EUR,2024-05-02
A102,initech,15.5,usd,2024-05-02
A103,umbrella,abc,USD,2024-05-03
A104,hooli,42.00,GBP,2024-05-04
A105,acme,7.25,USD,2024-05-05
`,
    'agent/prompt.md': `This is a data proof of concept for a customer. Work like a careful data engineer:

- Every validation rule lives in schema.py and has a test in test_pipeline.py.
- Rows that fail are rejected with a reason, never silently fixed or dropped.
- Never copy customer data into code, docs or tests: use made-up rows that have the same shape.
- Queries against the customer's warehouse are read-only unless I ask otherwise.
- Run python test_pipeline.py and python pipeline.py before you finish, and show the counts.
`,
    'README.md': `# Data pipeline proof of concept

\`python pipeline.py\` loads data/orders.csv into out/warehouse.db and reports rejected rows. \`python test_pipeline.py\` runs the tests. Standard library only.
`,
  },
};

export const KIT_LIBRARY: LibraryKit[] = [apiIntegration, mcpServer, dataPipeline];

export const AUDIENCE_LABEL: Record<Kit['audience'], string> = { fde: 'Forward-deployed', isv: 'ISV', team: 'Team' };
