/**
 * Node and TypeScript under the inspector (Chrome DevTools Protocol). The program starts with --inspect-brk on a
 * free local port, so it waits for us: breakpoints are set before its first line runs. TypeScript runs through
 * Node's type stripping, which keeps line numbers, so breakpoints land on the lines you see.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { killTree } from '../proc.ts';
import { shortValue, type DebugFrame, type DebugScope, type DebugVariable, type Debuggee, type DebuggeeEvents, type StepKind } from './types.ts';

interface RemoteObject {
  type: string;
  subtype?: string;
  value?: unknown;
  description?: string;
  objectId?: string;
  className?: string;
}

interface CallFrame {
  callFrameId: string;
  functionName: string;
  url: string;
  location: { scriptId: string; lineNumber: number; columnNumber: number };
  scopeChain: { type: string; name?: string; object: RemoteObject }[];
}

/** One line of a value, the way a debugger shows it */
export function describeRemote(o: RemoteObject): string {
  if (o.type === 'undefined') return 'undefined';
  if (o.type === 'string') return shortValue(JSON.stringify(o.value));
  if (o.subtype === 'null') return 'null';
  if (o.type === 'number' || o.type === 'boolean') return String(o.description ?? o.value);
  if (o.type === 'bigint') return `${o.description ?? o.value}n`.replace(/nn$/, 'n');
  if (o.type === 'function') return `ƒ ${(o.description ?? '').split('\n')[0].replace(/\s*\{.*$/, '').slice(0, 120)}`;
  return shortValue(o.description ?? o.className ?? o.type);
}

const SCOPE_NAMES: Record<string, string> = { local: 'Local', block: 'Block', closure: 'Closure', module: 'Module', script: 'Script', catch: 'Catch', with: 'With' };

/** A resolve hook so imports without an extension find their .ts file, as the editor and scriptc do */
const RESOLVE_HOOK = `export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !/^\\.{1,2}\\//.test(specifier) || /\\.[cm]?[jt]s$/.test(specifier)) throw error;
    for (const suffix of ['.ts', '.mts', '.js', '/index.ts', '/index.js']) {
      try { return await next(specifier + suffix, context); } catch {}
    }
    throw error;
  }
}`;

export interface NodeLaunch {
  projectDir: string;
  entry: string;
  args: string[];
  env: Record<string, string>;
}

export async function launchNode(launch: NodeLaunch, events: DebuggeeEvents): Promise<Debuggee> {
  const root = fs.realpathSync(launch.projectDir);
  const hookDir = path.join(root, '.home');
  fs.mkdirSync(hookDir, { recursive: true });
  const hook = path.join(hookDir, 'aha-resolve.mjs');
  fs.writeFileSync(hook, RESOLVE_HOOK);
  const register = `data:text/javascript,import{register}from'node:module';register(${JSON.stringify(pathToFileURL(hook).href)});`;
  const child: ChildProcess = spawn(process.execPath, ['--inspect-brk=127.0.0.1:0', '--experimental-strip-types', '--no-warnings', '--import', register, launch.entry, ...launch.args], {
    cwd: root,
    env: launch.env as NodeJS.ProcessEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    // Its own process group, so stopping it also stops what it started
    detached: process.platform !== 'win32',
  });

  // The inspector prints its address on stderr; the rest of stderr is the program's
  const wsUrl = await new Promise<string>((resolve, reject) => {
    let early = '';
    const timer = setTimeout(() => reject(new Error(`Node did not start its debugger.\n${early}`)), 20_000);
    const onData = (chunk: Buffer) => {
      early += chunk.toString();
      const m = /Debugger listening on (ws:\/\/\S+)/.exec(early);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    };
    child.stderr!.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Node exited before the debugger started (code ${code}).\n${early}`));
    });
  });

  child.stdout!.on('data', (d: Buffer) => events.output('stdout', d.toString()));
  child.stderr!.on('data', (d: Buffer) => {
    const text = d
      .toString()
      .split('\n')
      .filter((l) => !/^(Debugger listening on|For help, see: https:\/\/nodejs\.org|Debugger attached\.|Waiting for the debugger to disconnect)/.test(l.trim()))
      .join('\n');
    if (text.trim()) events.output('stderr', text);
  });

  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', () => reject(new Error('Could not connect to the Node inspector')), { once: true });
  });

  let seq = 1;
  const pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  const send = <T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}): Promise<T> =>
    new Promise((resolve, reject) => {
      const id = seq++;
      pending.set(id, { resolve: resolve as (v: Record<string, unknown>) => void, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  const scripts = new Map<string, string>();
  let frames: CallFrame[] = [];
  let started = false;
  let skippedStart = false;

  const fileOf = (url: string): string | null => {
    if (!url.startsWith('file://')) return null;
    const abs = fileURLToPath(url);
    const rel = path.relative(root, abs);
    return rel.startsWith('..') || path.isAbsolute(rel) || rel.startsWith('.home') ? null : rel.split(path.sep).join('/');
  };

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message: string } };
    if (message.id !== undefined) {
      const waiting = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiting?.reject(new Error(message.error.message));
      else waiting?.resolve(message.result ?? {});
      return;
    }
    const params = message.params ?? {};
    if (message.method === 'Debugger.scriptParsed') scripts.set(String(params.scriptId), String(params.url));
    else if (message.method === 'Debugger.paused') {
      frames = params.callFrames as CallFrame[];
      // --inspect-brk stops before the first line: that stop is ours, not the user's
      if (!skippedStart) {
        skippedStart = true;
        void send('Debugger.resume');
        return;
      }
      const reason = (params.hitBreakpoints as string[] | undefined)?.length ? 'breakpoint' : String(params.reason ?? 'pause');
      events.paused(frames.map(toFrame), reason === 'other' ? 'step' : reason);
    } else if (message.method === 'Debugger.resumed') events.resumed();
    else if (message.method === 'Runtime.executionContextDestroyed') {
      // The program has finished: Node waits for the debugger to leave before it exits
      ws.close();
    }
  });
  ws.addEventListener('close', () => {
    for (const [, waiting] of pending) waiting.reject(new Error('The debugger disconnected'));
    pending.clear();
  });
  child.once('exit', (code) => {
    try {
      ws.close();
    } catch {
      // already closed
    }
    events.exited(code);
  });

  const toFrame = (f: CallFrame): DebugFrame => ({
    id: f.callFrameId,
    name: f.functionName || '(top level)',
    file: fileOf(f.url || scripts.get(f.location.scriptId) || ''),
    line: f.location.lineNumber + 1,
    column: f.location.columnNumber + 1,
  });

  const toVariable = (name: string, o: RemoteObject): DebugVariable => ({
    name,
    value: describeRemote(o),
    type: o.subtype ?? o.type,
    ...(o.objectId && o.type === 'object' && o.subtype !== 'null' ? { ref: o.objectId } : {}),
  });

  const properties = async (objectId: string): Promise<DebugVariable[]> => {
    const { result } = await send<{ result: { name: string; value?: RemoteObject; get?: RemoteObject }[] }>('Runtime.getProperties', { objectId, ownProperties: true, generatePreview: false });
    return result.filter((p) => p.value && p.name !== '__proto__').slice(0, 500).map((p) => toVariable(p.name, p.value!));
  };

  await send('Runtime.enable');
  await send('Debugger.enable');

  const placed = new Map<string, string[]>();
  return {
    async setBreakpoints(file, lines) {
      for (const id of placed.get(file) ?? []) await send('Debugger.removeBreakpoint', { breakpointId: id }).catch(() => {});
      const url = pathToFileURL(path.join(root, file)).href;
      const ids: string[] = [];
      const landed: number[] = [];
      for (const line of lines) {
        const r = await send<{ breakpointId: string; locations: { lineNumber: number }[] }>('Debugger.setBreakpointByUrl', { url, lineNumber: line - 1, columnNumber: 0 });
        ids.push(r.breakpointId);
        landed.push(r.locations[0] ? r.locations[0].lineNumber + 1 : line);
      }
      placed.set(file, ids);
      return landed;
    },
    async start() {
      if (started) return;
      started = true;
      await send('Runtime.runIfWaitingForDebugger');
    },
    async resume() {
      await send('Debugger.resume');
    },
    async step(kind: StepKind) {
      await send(kind === 'over' ? 'Debugger.stepOver' : kind === 'into' ? 'Debugger.stepInto' : 'Debugger.stepOut');
    },
    async pause() {
      await send('Debugger.pause');
    },
    async scopes(frameId) {
      const frame = frames.find((f) => f.callFrameId === frameId);
      if (!frame) return [];
      const out: DebugScope[] = [];
      for (const scope of frame.scopeChain) {
        // The global object holds the whole runtime: too much to be useful, and slow
        if (scope.type === 'global' || !scope.object.objectId) continue;
        out.push({ name: SCOPE_NAMES[scope.type] ?? scope.type, variables: await properties(scope.object.objectId) });
      }
      return out;
    },
    children: properties,
    async evaluate(expression, frameId) {
      const { result, exceptionDetails } = await send<{ result: RemoteObject; exceptionDetails?: { exception?: RemoteObject; text: string } }>('Debugger.evaluateOnCallFrame', {
        callFrameId: frameId,
        expression,
        silent: true,
        generatePreview: false,
      });
      if (exceptionDetails) return { name: expression, value: exceptionDetails.exception ? describeRemote(exceptionDetails.exception) : exceptionDetails.text, type: 'error' };
      return toVariable(expression, result);
    },
    stop() {
      try {
        ws.close();
      } catch {
        // already closed
      }
      killTree(child);
    },
  };
}
