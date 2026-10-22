// A minimal MCP server over stdio for tests. Env: FAKE_MCP_MARK = file that gets a line per process start.
const fs = require('fs');
const readline = require('readline');
if (process.env.FAKE_MCP_MARK) fs.appendFileSync(process.env.FAKE_MCP_MARK, `${process.pid}\n`);
console.log('fake-mcp banner (not JSON-RPC)');
const reply = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
const error = (id, code, message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);
const tools = [
  { name: 'echo', description: 'Echo the text back', inputSchema: { type: 'object', $schema: 'x', additionalProperties: false, properties: { text: { type: ['string', 'null'], description: 'what to echo' } }, required: ['text'] }, annotations: { readOnlyHint: true } },
  { name: 'write_note', description: 'Pretend to write', inputSchema: { type: 'object', properties: {} } },
  { name: 'boom', description: 'Always errors', inputSchema: { type: 'object', properties: {} } },
  { name: 'slow', description: 'Never answers', inputSchema: { type: 'object', properties: {} } },
  { name: 'env', description: 'Report an env variable', inputSchema: { type: 'object', properties: { name: { type: 'string' } } } },
];
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') return reply(m.id, { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake-mcp', version: '1' } });
  if (m.method === 'notifications/initialized') return;
  if (m.method === 'tools/list') return reply(m.id, m.params && m.params.cursor ? { tools: [tools[3]] } : { tools: tools.slice(0, 3).concat(tools[4]), nextCursor: 'page2' });
  if (m.method === 'tools/call') {
    const { name, arguments: args } = m.params;
    if (name === 'echo') return reply(m.id, { content: [{ type: 'text', text: `echo: ${args.text}` }] });
    if (name === 'write_note') return reply(m.id, { content: [{ type: 'text', text: 'written' }, { type: 'image', data: 'AAAA', mimeType: 'image/png' }] });
    if (name === 'boom') return reply(m.id, { isError: true, content: [{ type: 'text', text: 'it broke' }] });
    if (name === 'env') return reply(m.id, { content: [{ type: 'text', text: String(process.env[args.name]) }] });
    if (name === 'slow') return;
    return error(m.id, -32602, `Unknown tool: ${name}`);
  }
  if (m.id !== undefined) error(m.id, -32601, 'no such method');
});
