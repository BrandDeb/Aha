/**
 * A small Model Context Protocol client: JSON-RPC 2.0 over a local process's
 * stdin/stdout, or over HTTP POST (the "Streamable HTTP" transport, where the
 * reply is JSON or a server-sent event stream). It does only what an agent
 * needs: initialize, list tools, call a tool. No SDK, so it adds nothing to
 * the install and nothing to the bundle when unused.
 */

import { spawn, execFile, type ChildProcess } from 'node:child_process';
import type { ConnectorCallResult, ConnectorTool } from './types.ts';
import { cleanSchema } from './types.ts';
import { fetchPublic } from './net.ts';

const PROTOCOL_VERSION = '2025-06-18';
const MAX_RESULT_CHARS = 100_000;

export interface Transport {
  send(message: Record<string, unknown>): Promise<void>;
  onMessage: (message: Record<string, unknown>) => void;
  onClose: (reason?: string) => void;
  close(): void;
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

export class McpClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private closed = false;
  serverName = '';

  private readonly transport: Transport;

  private constructor(transport: Transport) {
    this.transport = transport;
    transport.onMessage = (message) => this.handle(message);
    transport.onClose = (reason) => this.fail(new Error(reason || 'The MCP server closed the connection.'));
  }

  /** Connect and run the initialize handshake */
  static async connect(transport: Transport, timeoutMs = 20_000): Promise<McpClient> {
    const client = new McpClient(transport);
    try {
      const init = (await client.request('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'nanocli-studio', version: '1.0' } }, timeoutMs)) as { serverInfo?: { name?: string } };
      client.serverName = init?.serverInfo?.name ?? '';
      await transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    } catch (error) {
      client.close();
      throw error;
    }
    return client;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private handle(message: Record<string, unknown>): void {
    if (typeof message.id === 'number' && ('result' in message || 'error' in message) && !('method' in message)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      const error = message.error as { message?: string; code?: number } | undefined;
      if (error) pending.reject(new Error(error.message || `MCP error ${error.code ?? ''}`.trim()));
      else pending.resolve(message.result);
      return;
    }
    // Requests from the server: answer ping, decline the rest
    if (typeof message.method === 'string' && message.id !== undefined) {
      const reply = message.method === 'ping' ? { jsonrpc: '2.0', id: message.id, result: {} } : { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not supported by this client' } };
      void this.transport.send(reply).catch(() => {});
    }
  }

  private fail(error: Error): void {
    this.closed = true;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  request(method: string, params: unknown, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('The MCP connection is closed.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        void this.transport.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason: 'timeout' } }).catch(() => {});
        reject(new Error(`The MCP server did not answer ${method} within ${Math.round(timeoutMs / 1000)}s.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      signal?.addEventListener('abort', () => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        clearTimeout(pending.timer);
        reject(Object.assign(new Error('Stopped'), { name: 'AbortError' }));
      });
      this.transport.send({ jsonrpc: '2.0', id, method, params }).catch((error) => {
        if (this.pending.delete(id)) {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  }

  async listTools(timeoutMs = 20_000): Promise<ConnectorTool[]> {
    const tools: ConnectorTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const result = (await this.request('tools/list', cursor ? { cursor } : {}, timeoutMs)) as {
        tools?: { name?: string; description?: string; inputSchema?: unknown; annotations?: { readOnlyHint?: boolean } }[];
        nextCursor?: string;
      };
      for (const t of result?.tools ?? []) {
        if (!t.name || !/^[A-Za-z0-9_.-]{1,64}$/.test(t.name)) continue;
        tools.push({ name: t.name, description: (t.description ?? '').slice(0, 1000), inputSchema: cleanSchema(t.inputSchema), readOnly: t.annotations?.readOnlyHint === true });
      }
      cursor = result?.nextCursor;
      if (!cursor) break;
    }
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>, timeoutMs = 60_000, signal?: AbortSignal): Promise<ConnectorCallResult> {
    const result = (await this.request('tools/call', { name, arguments: args }, timeoutMs, signal)) as {
      content?: { type?: string; text?: string; resource?: { text?: string; uri?: string }; mimeType?: string }[];
      structuredContent?: unknown;
      isError?: boolean;
    };
    const parts: string[] = [];
    for (const block of result?.content ?? []) {
      if (block.type === 'text' && block.text) parts.push(block.text);
      else if (block.type === 'resource' && block.resource?.text) parts.push(block.resource.text);
      else if (block.type === 'image' || block.type === 'audio') parts.push(`[${block.type} content omitted]`);
    }
    if (!parts.length && result?.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent, null, 2));
    let text = parts.join('\n').trim() || '(no output)';
    if (text.length > MAX_RESULT_CHARS) text = `${text.slice(0, MAX_RESULT_CHARS)}\n… [truncated]`;
    return { text, isError: result?.isError === true };
  }

  close(): void {
    if (this.closed && !this.pending.size) {
      this.transport.close();
      return;
    }
    this.fail(new Error('The MCP connection was closed.'));
    this.transport.close();
  }
}

// ---------------------------------------------------------------------------
// stdio
// ---------------------------------------------------------------------------

function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  const pid = child.pid;
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }, 2000).unref();
}

/** Quote an argument for cmd.exe, which Windows needs for npx/uvx style launchers */
const winQuote = (arg: string) => (/[\s"&|<>^()%!]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg);

export class StdioTransport implements Transport {
  onMessage: Transport['onMessage'] = () => {};
  onClose: Transport['onClose'] = () => {};
  private readonly child: ChildProcess;
  private buffer = '';
  private stderr = '';
  private done = false;

  constructor(command: string, args: string[], env: Record<string, string>, cwd: string) {
    const windows = process.platform === 'win32';
    this.child = spawn(windows ? winQuote(command) : command, windows ? args.map(winQuote) : args, {
      env: env as NodeJS.ProcessEnv,
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: !windows,
      windowsHide: true,
      shell: windows, // npx.cmd and friends can't be spawned directly on Windows
    });
    this.child.stdout!.setEncoding('utf8');
    this.child.stdout!.on('data', (chunk: string) => {
      this.buffer += chunk;
      let newline: number;
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (!line.startsWith('{')) continue; // banners and logs some servers print to stdout
        try {
          this.onMessage(JSON.parse(line));
        } catch {
          // not a protocol message
        }
      }
      if (this.buffer.length > 4 * 1024 * 1024) this.buffer = '';
    });
    this.child.stderr!.setEncoding('utf8');
    this.child.stderr!.on('data', (chunk: string) => (this.stderr = (this.stderr + chunk).slice(-4000)));
    this.child.on('error', (error) => this.end(error.message.includes('ENOENT') ? `Could not start “${command}”: it was not found. Is it installed and on PATH?` : `Could not start “${command}”: ${error.message}`));
    this.child.on('exit', (code) => this.end(`The server exited (code ${code ?? 'unknown'}).${this.stderr.trim() ? ` ${this.stderr.trim().split('\n').slice(-3).join(' ')}` : ''}`));
    // The server may close its stdin early; that is reported through exit
    this.child.stdin!.on('error', () => {});
  }

  private end(reason: string): void {
    if (this.done) return;
    this.done = true;
    this.onClose(reason);
  }

  async send(message: Record<string, unknown>): Promise<void> {
    if (this.done || !this.child.stdin?.writable) throw new Error('The MCP server is not running.');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  close(): void {
    this.done = true;
    killTree(this.child);
  }
}

// ---------------------------------------------------------------------------
// Streamable HTTP
// ---------------------------------------------------------------------------

/** Pull the JSON messages out of a server-sent event stream's text */
export function parseSse(text: string): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [];
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (!data) continue;
    try {
      messages.push(JSON.parse(data));
    } catch {
      // not JSON
    }
  }
  return messages;
}

export class HttpTransport implements Transport {
  onMessage: Transport['onMessage'] = () => {};
  onClose: Transport['onClose'] = () => {};
  private sessionId: string | undefined;
  private protocol: string | undefined;

  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly allowPrivate: boolean;

  /** `allowPrivate`: whether the destination may be on a private network (the user's own server) */
  constructor(url: string, headers: Record<string, string>, allowPrivate: boolean) {
    this.url = url;
    this.headers = headers;
    this.allowPrivate = allowPrivate;
  }

  async send(message: Record<string, unknown>): Promise<void> {
    const response = await fetchPublic(this.url, {
      method: 'POST',
      body: JSON.stringify(message),
      allowPrivate: this.allowPrivate,
      timeoutMs: 60_000,
      maxBytes: 4 * 1024 * 1024,
      headers: {
        ...this.headers,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
        ...(this.protocol ? { 'MCP-Protocol-Version': this.protocol } : {}),
      },
    });
    const session = response.headers['mcp-session-id'];
    if (typeof session === 'string') this.sessionId = session;
    if (response.status === 202 || response.status === 204) return; // accepted, no reply expected
    const text = response.body.toString('utf8');
    if (response.status >= 400) {
      throw new Error(response.status === 401 || response.status === 403 ? `The MCP server refused the request (${response.status}). Check the headers or token.` : `The MCP server answered ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
    }
    const type = String(response.headers['content-type'] ?? '');
    const messages = type.includes('text/event-stream') ? parseSse(text) : [JSON.parse(text)];
    for (const reply of messages) {
      const result = reply?.result as { protocolVersion?: string } | undefined;
      if (result?.protocolVersion) this.protocol = result.protocolVersion;
      this.onMessage(reply);
    }
  }

  close(): void {
    if (!this.sessionId) return;
    void fetchPublic(this.url, { method: 'DELETE', allowPrivate: this.allowPrivate, timeoutMs: 3000, headers: { ...this.headers, 'Mcp-Session-Id': this.sessionId, ...(this.protocol ? { 'MCP-Protocol-Version': this.protocol } : {}) } }).catch(() => {});
  }
}
