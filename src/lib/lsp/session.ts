/**
 * Language server sessions: one server per project and language, fed the project's files, spoken to over stdio
 * (JSON-RPC with Content-Length frames). The browser sends requests through /api/lsp and polls for what the server
 * publishes (diagnostics). Paths are translated both ways: the editor names files `file:///src/x.py`, the server
 * sees the real folder, and nothing outside the project can be named.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDapReader } from '../debug/dap.ts';
import { AHA_DIR, runEnv } from '../polyglot.ts';
import { isSafeRelativePath, killTree, writeProject } from '../proc.ts';
import { ensureServer, serverFor, type LspLanguage } from './servers.ts';

export const MAX_LSP_SESSIONS = 4;
const IDLE_MS = 10 * 60 * 1000;
const REQUEST_MS = 15_000;
const MAX_QUEUE = 500;

/** What the browser may ask; everything else is refused */
export const LSP_REQUESTS = new Set([
  'textDocument/completion',
  'completionItem/resolve',
  'textDocument/hover',
  'textDocument/signatureHelp',
  'textDocument/definition',
  'textDocument/typeDefinition',
  'textDocument/references',
  'textDocument/documentSymbol',
  'textDocument/prepareRename',
  'textDocument/rename',
]);
export const LSP_NOTIFICATIONS = new Set(['textDocument/didOpen', 'textDocument/didChange', 'textDocument/didClose', 'textDocument/didSave']);

export interface LspMessage {
  seq: number;
  method: string;
  params: unknown;
}

interface Session {
  id: string;
  key: string;
  language: LspLanguage;
  root: string;
  rootUri: string;
  child: ChildProcess;
  nextId: number;
  pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>;
  queue: LspMessage[];
  seq: number;
  waiters: Set<() => void>;
  touched: number;
  capabilities: Record<string, unknown>;
  exited: string | null;
}

const sessions = new Map<string, Session>();
setInterval(() => {
  for (const s of sessions.values()) if (Date.now() - s.touched > IDLE_MS) stopLsp(s.id);
}, 60_000).unref();

/** `file:///src/a.py` → the real file's URI, or null when it would leave the project */
export function toServerUri(uri: string, rootUri: string): string | null {
  if (!uri.startsWith('file:///')) return null;
  let rel: string;
  try {
    rel = decodeURIComponent(uri.slice('file:///'.length));
  } catch {
    return null;
  }
  if (!isSafeRelativePath(rel)) return null;
  return `${rootUri}/${rel.split('/').map(encodeURIComponent).join('/')}`;
}

/** The real file's URI → `file:///src/a.py`; other URIs (the standard library) are left as they are */
export function toClientUri(uri: string, rootUri: string): string {
  if (!uri.startsWith(`${rootUri}/`)) return uri;
  const rel = decodeURIComponent(uri.slice(rootUri.length + 1));
  return `file:///${rel}`;
}

/** Rewrite every URI-looking string in a message (and the keys of WorkspaceEdit.changes) */
export function mapUris(value: unknown, map: (uri: string) => string | null): unknown {
  if (typeof value === 'string') {
    if (!value.startsWith('file://')) return value;
    const mapped = map(value);
    if (mapped === null) throw Object.assign(new Error('That file is outside the project'), { status: 400 });
    return mapped;
  }
  if (Array.isArray(value)) return value.map((v) => mapUris(v, map));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const key = k.startsWith('file://') ? map(k) : k;
      if (key === null) throw Object.assign(new Error('That file is outside the project'), { status: 400 });
      out[key] = mapUris(v, map);
    }
    return out;
  }
  return value;
}

/** A JSON-RPC frame of exactly this object (no seq field: that belongs to the debug protocol) */
function frame(message: Record<string, unknown>): string {
  const json = JSON.stringify({ jsonrpc: '2.0', ...message });
  return `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`;
}

function send(s: Session, message: Record<string, unknown>) {
  if (s.exited || !s.child.stdin?.writable) return;
  s.child.stdin.write(frame(message));
}

function serverRequest(s: Session, method: string, params: unknown, timeoutMs = REQUEST_MS): Promise<unknown> {
  if (s.exited) return Promise.reject(Object.assign(new Error(`The ${serverFor(s.language)!.name} server stopped: ${s.exited}`), { status: 409 }));
  const id = s.nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      s.pending.delete(id);
      reject(Object.assign(new Error(`${method} took too long`), { status: 504 }));
    }, timeoutMs);
    s.pending.set(id, { resolve, reject, timer });
    send(s, { id, method, params });
  });
}

function publish(s: Session, method: string, params: unknown) {
  s.queue.push({ seq: ++s.seq, method, params: mapUris(params, (u) => toClientUri(u, s.rootUri)) });
  if (s.queue.length > MAX_QUEUE) s.queue.splice(0, s.queue.length - MAX_QUEUE);
  for (const wake of s.waiters) wake();
}

/** Requests the server makes of the client: answered here, so the browser never has to */
function answerServer(s: Session, id: number | string, method: string, params: Record<string, unknown> | undefined) {
  let result: unknown = null;
  if (method === 'workspace/configuration') result = ((params?.items as unknown[]) ?? []).map(() => ({}));
  else if (method === 'workspace/workspaceFolders') result = [{ uri: s.rootUri, name: 'project' }];
  else if (method === 'workspace/applyEdit') result = { applied: false, failureReason: 'Edits are applied in the editor' };
  send(s, { id, result });
}

export interface LspStart {
  projectId: string;
  language: LspLanguage;
  files: Record<string, string>;
}

/** Start (or reuse) the server for a project and language */
export async function startLsp(input: LspStart, onProgress?: (text: string) => void): Promise<{ id: string; capabilities: Record<string, unknown> }> {
  const key = `${input.projectId}:${input.language}`;
  const existing = [...sessions.values()].find((s) => s.key === key && !s.exited);
  if (existing) {
    existing.touched = Date.now();
    await syncFiles(existing, input.files);
    return { id: existing.id, capabilities: existing.capabilities };
  }
  for (const s of sessions.values()) if (s.exited) sessions.delete(s.id);
  if (sessions.size >= MAX_LSP_SESSIONS) stopLsp([...sessions.values()].sort((a, b) => a.touched - b.touched)[0].id);

  const info = serverFor(input.language)!;
  const command = await ensureServer(input.language, onProgress);
  const dir = path.join(AHA_DIR, 'lsp', `${input.projectId}-${input.language}`);
  await writeProject(dir, filesFor(input.language, input.files), { keep: new Set(['.home']) });
  const root = fs.realpathSync(dir);
  const rootUri = pathToFileURL(root).href.replace(/\/$/, '');
  const env = runEnv(process.env, root, {});
  const child = spawn(command.file, command.args, { cwd: root, env: env as NodeJS.ProcessEnv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });
  const s: Session = { id: crypto.randomUUID(), key, language: input.language, root, rootUri, child, nextId: 1, pending: new Map(), queue: [], seq: 0, waiters: new Set(), touched: Date.now(), capabilities: {}, exited: null };
  sessions.set(s.id, s);

  const read = createDapReader();
  child.stdout!.on('data', (chunk: Buffer) => {
    for (const raw of read(chunk) as unknown as { id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message: string } }[]) {
      if (raw.method && raw.id !== undefined) answerServer(s, raw.id, raw.method, raw.params);
      else if (raw.method) {
        // Diagnostics are what the editor needs; log and progress chatter is dropped
        if (raw.method === 'textDocument/publishDiagnostics') publish(s, raw.method, raw.params);
      } else if (typeof raw.id === 'number') {
        const waiting = s.pending.get(raw.id);
        if (!waiting) continue;
        s.pending.delete(raw.id);
        clearTimeout(waiting.timer);
        if (raw.error) waiting.reject(Object.assign(new Error(raw.error.message), { status: 502 }));
        else waiting.resolve(raw.result ?? null);
      }
    }
  });
  let stderr = '';
  child.stderr!.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-4000)));
  child.on('error', (e) => (s.exited = e.message));
  child.on('exit', (code) => {
    s.exited = s.exited ?? `exit code ${code}${stderr ? `: ${stderr.trim().split('\n').slice(-3).join(' ')}` : ''}`;
    for (const [, w] of s.pending) {
      clearTimeout(w.timer);
      w.reject(Object.assign(new Error(`The ${info.name} server stopped (${s.exited})`), { status: 409 }));
    }
    s.pending.clear();
    for (const wake of s.waiters) wake();
  });

  const init = (await serverRequest(
    s,
    'initialize',
    {
      processId: process.pid,
      clientInfo: { name: 'Aha!' },
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: 'project' }],
      capabilities: {
        workspace: { configuration: true, workspaceFolders: true, workspaceEdit: { documentChanges: false } },
        textDocument: {
          synchronization: { didSave: true, dynamicRegistration: false },
          completion: { completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'], resolveSupport: { properties: ['documentation', 'detail'] } }, contextSupport: true },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          signatureHelp: { signatureInformation: { documentationFormat: ['markdown', 'plaintext'] } },
          definition: { linkSupport: false },
          references: {},
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          rename: { prepareSupport: true },
          publishDiagnostics: { relatedInformation: false },
        },
      },
      initializationOptions: {},
    },
    60_000
  )) as { capabilities?: Record<string, unknown> };
  s.capabilities = init?.capabilities ?? {};
  send(s, { method: 'initialized', params: {} });
  return { id: s.id, capabilities: s.capabilities };
}

/** The files a server needs: its language's sources and manifests */
function filesFor(language: LspLanguage, files: Record<string, string>): Record<string, string> {
  const info = serverFor(language)!;
  return Object.fromEntries(Object.entries(files).filter(([p]) => info.files.test(p)));
}

/** Bring the folder up to date when the browser reconnects with newer files */
async function syncFiles(s: Session, files: Record<string, string>) {
  await writeProject(s.root, filesFor(s.language, files), { keep: new Set(['.home']) });
}

function get(id: string): Session {
  const s = sessions.get(id);
  if (!s) throw Object.assign(new Error('That language server session has ended'), { status: 404 });
  s.touched = Date.now();
  return s;
}

export async function lspRequest(id: string, method: string, params: unknown): Promise<unknown> {
  if (!LSP_REQUESTS.has(method)) throw Object.assign(new Error(`${method} is not allowed`), { status: 400 });
  const s = get(id);
  const result = await serverRequest(s, method, mapUris(params, (u) => toServerUri(u, s.rootUri)));
  return mapUris(result, (u) => toClientUri(u, s.rootUri));
}

export function lspNotify(id: string, method: string, params: unknown): void {
  if (!LSP_NOTIFICATIONS.has(method)) throw Object.assign(new Error(`${method} is not allowed`), { status: 400 });
  const s = get(id);
  const mapped = mapUris(params, (u) => toServerUri(u, s.rootUri)) as { textDocument?: { uri?: string; text?: string }; contentChanges?: { text?: string }[] };
  // Keep the folder in step with what the editor holds, for files the server reads from disk (imports, go.mod)
  const uri = mapped?.textDocument?.uri;
  const text = method === 'textDocument/didOpen' ? mapped.textDocument?.text : method === 'textDocument/didChange' ? mapped.contentChanges?.at(-1)?.text : undefined;
  if (uri && typeof text === 'string' && uri.startsWith(`${s.rootUri}/`)) {
    const rel = decodeURIComponent(uri.slice(s.rootUri.length + 1));
    if (isSafeRelativePath(rel)) {
      const file = path.join(s.root, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    }
  }
  send(s, { method, params: mapped });
}

/** What the server published after `since`, waiting up to `waitMs` for something new */
export async function lspPoll(id: string, since: number, waitMs = 20_000): Promise<{ messages: LspMessage[]; exited: string | null }> {
  const s = get(id);
  const fresh = () => s.queue.filter((m) => m.seq > since);
  if (!fresh().length && !s.exited) {
    await new Promise<void>((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        s.waiters.delete(wake);
        resolve();
      };
      const timer = setTimeout(wake, waitMs);
      s.waiters.add(wake);
    });
  }
  return { messages: fresh(), exited: s.exited };
}

export function stopLsp(id: string): void {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  if (!s.exited) {
    send(s, { id: s.nextId++, method: 'shutdown' });
    send(s, { method: 'exit' });
    setTimeout(() => s.exited === null && killTree(s.child), 2000).unref();
  }
}
