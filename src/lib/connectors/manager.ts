/**
 * Runs connectors on behalf of the browser: decides what this server allows,
 * keeps MCP sessions warm between calls (and closes them when idle), and
 * routes a call to the right implementation.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import { listensOnLoopbackOnly } from '../host.ts';
import { builtinFor, type Context } from './builtin.ts';
import { CONNECTOR_HOME, CONNECTOR_WORK, connectorEnv } from './env.ts';
import { HttpTransport, McpClient, StdioTransport } from './mcp.ts';
import { LOCAL_KINDS, type Connector, type ConnectorCallResult, type ConnectorKind, type ConnectorTool } from './types.ts';

export type Mode = 'off' | 'local' | 'hosted';

/**
 * off:    NANOCLI_CONNECTORS=0
 * local:  the studio listens only on this machine (or NANOCLI_CONNECTORS=1), so running a
 *         tool the user configured is the same trust as running their own code
 * hosted: shared server; only network connectors, which can never reach private addresses
 */
export function connectorsMode(env: Record<string, string | undefined> = process.env): Mode {
  if (env.NANOCLI_CONNECTORS === '0') return 'off';
  if (env.NANOCLI_CONNECTORS === '1') return 'local';
  return listensOnLoopbackOnly(env) ? 'local' : 'hosted';
}

/** A message when this kind can't run in this mode, otherwise null */
export function modeBlocks(kind: ConnectorKind, mode: Mode): string | null {
  if (mode === 'off') return 'Connectors are turned off on this server (NANOCLI_CONNECTORS=0).';
  if (mode === 'hosted' && LOCAL_KINDS.includes(kind)) return 'This kind of connector runs programs or reads files on the server, so it is only available when the studio runs on your own machine.';
  return null;
}

interface Pooled {
  client: Promise<McpClient>;
  lastUsed: number;
}

const IDLE_MS = 5 * 60_000;
const MAX_SESSIONS = 8;

const g = globalThis as unknown as { __nanocliMcpPool?: Map<string, Pooled>; __nanocliMcpReaper?: NodeJS.Timeout };
const pool = (g.__nanocliMcpPool ??= new Map<string, Pooled>());

function reap(): void {
  const now = Date.now();
  for (const [key, entry] of pool) {
    if (now - entry.lastUsed > IDLE_MS) drop(key);
  }
}

function drop(key: string): void {
  const entry = pool.get(key);
  pool.delete(key);
  void entry?.client.then((c) => c.close()).catch(() => {});
}

export function closeAllConnectors(): void {
  for (const key of [...pool.keys()]) drop(key);
}

if (!g.__nanocliMcpReaper) {
  g.__nanocliMcpReaper = setInterval(reap, 60_000);
  g.__nanocliMcpReaper.unref();
  process.once('exit', closeAllConnectors);
}

function sessionKey(c: Connector): string {
  const identity = c.kind === 'mcp-stdio' ? { k: c.kind, command: c.command, args: c.args, env: c.env } : c.kind === 'mcp-http' ? { k: c.kind, url: c.url, headers: c.headers } : {};
  return crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

async function mcpClient(c: Connector, ctx: Context): Promise<McpClient> {
  const key = sessionKey(c);
  const existing = pool.get(key);
  if (existing) {
    existing.lastUsed = Date.now();
    try {
      const client = await existing.client;
      if (!client.isClosed) return client;
    } catch {
      // the earlier attempt failed: start over below
    }
    drop(key);
  }
  if (pool.size >= MAX_SESSIONS) {
    const oldest = [...pool.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
    if (oldest) drop(oldest[0]);
  }
  let transport;
  if (c.kind === 'mcp-stdio') {
    fs.mkdirSync(CONNECTOR_HOME, { recursive: true });
    fs.mkdirSync(CONNECTOR_WORK, { recursive: true });
    transport = new StdioTransport(c.command, c.args, connectorEnv(process.env, c.env), CONNECTOR_WORK);
  } else if (c.kind === 'mcp-http') {
    transport = new HttpTransport(c.url, c.headers, ctx.mode === 'local');
  } else {
    throw new Error('Not an MCP connector.');
  }
  const entry: Pooled = { client: McpClient.connect(transport), lastUsed: Date.now() };
  pool.set(key, entry);
  entry.client.catch(() => pool.get(key) === entry && pool.delete(key));
  return entry.client;
}

export async function listConnectorTools(connector: Connector, ctx: Context): Promise<ConnectorTool[]> {
  const blocked = modeBlocks(connector.kind, ctx.mode);
  if (blocked) throw new Error(blocked);
  if (connector.kind === 'mcp-stdio' || connector.kind === 'mcp-http') return (await mcpClient(connector, ctx)).listTools();
  const impl = builtinFor(connector, ctx);
  if (!impl) throw new Error('Unknown connector type.');
  return impl.listTools();
}

export async function callConnectorTool(connector: Connector, tool: string, args: Record<string, unknown>, ctx: Context): Promise<ConnectorCallResult> {
  const blocked = modeBlocks(connector.kind, ctx.mode);
  if (blocked) throw new Error(blocked);
  if (connector.kind === 'mcp-stdio' || connector.kind === 'mcp-http') {
    return (await mcpClient(connector, ctx)).callTool(tool, args, 90_000, ctx.signal);
  }
  const impl = builtinFor(connector, ctx);
  if (!impl) throw new Error('Unknown connector type.');
  return impl.callTool(tool, args, ctx);
}
