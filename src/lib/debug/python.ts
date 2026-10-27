/**
 * Python under debugpy, driven over the Debug Adapter Protocol. uv runs the program with debugpy added for this run
 * only (the project's own dependencies are untouched), listening on a free local port and waiting for us, so
 * breakpoints are in place before the first line runs.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { killTree } from '../proc.ts';
import { DapClient, type DapMessage } from './dap.ts';
import { shortValue, type DebugFrame, type DebugScope, type DebugVariable, type Debuggee, type DebuggeeEvents, type StepKind } from './types.ts';

/** A free local port: bind to 0, read it, let it go */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/** debugpy groups these under one entry each; they are noise next to your own variables */
const GROUPS = new Set(['special variables', 'function variables', 'class variables', 'protected variables']);

export interface PythonLaunch {
  projectDir: string;
  entry: string;
  args: string[];
  env: Record<string, string>;
  uv: string;
}

export function debugpyCommand(launch: Pick<PythonLaunch, 'entry' | 'args'>, port: number, hasPyproject: boolean): string[] {
  return ['run', ...(hasPyproject ? [] : ['--no-project']), '--with', 'debugpy', 'python', '-Xfrozen_modules=off', '-m', 'debugpy', '--listen', `127.0.0.1:${port}`, '--wait-for-client', launch.entry, ...launch.args];
}

export async function launchPython(launch: PythonLaunch, events: DebuggeeEvents): Promise<Debuggee> {
  const root = fs.realpathSync(launch.projectDir);
  const port = await freePort();
  const hasPyproject = fs.existsSync(path.join(root, 'pyproject.toml'));
  const child: ChildProcess = spawn(launch.uv, debugpyCommand(launch, port, hasPyproject), {
    cwd: root,
    env: { ...launch.env, PYDEVD_DISABLE_FILE_VALIDATION: '1' } as unknown as NodeJS.ProcessEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  let exited = false;
  let early = '';
  child.stdout!.on('data', (d: Buffer) => events.output('stdout', d.toString()));
  child.stderr!.on('data', (d: Buffer) => {
    early += d.toString();
    // uv's own progress and debugpy's start-up notes are not the program's output
    const text = d
      .toString()
      .split('\n')
      .filter((l) => !/^\s*(\d+\.\d+s - |Resolved \d+ package|Prepared \d+ package|Installed \d+ package|Downloading|Downloaded|Audited|Using CPython|Creating virtual environment|warning: `VIRTUAL_ENV`)/.test(l))
      .join('\n');
    if (text.trim()) events.output('stderr', text);
  });
  child.once('exit', (code) => {
    exited = true;
    events.exited(code);
  });

  let client: DapClient;
  try {
    // The first run downloads debugpy, which can take a while
    client = await DapClient.connect(port, { timeoutMs: 120_000 });
  } catch (error) {
    killTree(child);
    throw new Error(exited ? `Python exited before the debugger started.\n${early.slice(-2000)}` : (error as Error).message);
  }

  const toFile = (p: unknown): string | null => {
    if (typeof p !== 'string') return null;
    let abs = p;
    try {
      abs = fs.realpathSync(p);
    } catch {
      // a frame in a file that is gone
    }
    const rel = path.relative(root, abs);
    return rel.startsWith('..') || path.isAbsolute(rel) || rel.startsWith('.venv') || rel.startsWith('.home') ? null : rel.split(path.sep).join('/');
  };

  let threadId = 1;
  client.onEvent((m: DapMessage) => {
    const body = m.body ?? {};
    if (m.event === 'stopped') {
      threadId = Number(body.threadId ?? threadId);
      void client
        .request('stackTrace', { threadId, startFrame: 0, levels: 50 })
        .then((r) => {
          const frames = ((r.body?.stackFrames as { id: number; name: string; line: number; column: number; source?: { path?: string } }[]) ?? []).map(
            (f): DebugFrame => ({ id: String(f.id), name: f.name, file: toFile(f.source?.path), line: f.line, column: f.column })
          );
          events.paused(frames, String(body.reason ?? 'pause'));
        })
        .catch(() => events.paused([], String(body.reason ?? 'pause')));
    } else if (m.event === 'continued') events.resumed();
    else if (m.event === 'output' && (body.category === 'stdout' || body.category === 'stderr')) {
      // With a terminal attached debugpy forwards output here too; the pipes already carry it
    } else if (m.event === 'terminated' || m.event === 'exited') {
      client.close();
    }
  });

  await client.request('initialize', { clientID: 'aha', clientName: 'Aha!', adapterID: 'debugpy', linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path', supportsVariableType: true });
  // debugpy answers attach only after configurationDone; it asks for configuration with "initialized"
  const initialized = client.waitFor('initialized', 60_000);
  const attached = client.request('attach', { justMyCode: true, redirectOutput: false, subProcess: false }, 120_000);
  attached.catch(() => {});
  await initialized;

  const toVariable = (v: { name: string; value: string; type?: string; variablesReference?: number }): DebugVariable => ({
    name: v.name,
    value: shortValue(v.value),
    ...(v.type ? { type: v.type } : {}),
    ...(v.variablesReference ? { ref: String(v.variablesReference) } : {}),
  });
  const variables = async (ref: string) => {
    const r = await client.request('variables', { variablesReference: Number(ref) });
    return ((r.body?.variables as Parameters<typeof toVariable>[0][]) ?? []).filter((v) => !GROUPS.has(v.name)).slice(0, 500).map(toVariable);
  };

  let started = false;
  return {
    async setBreakpoints(file, lines) {
      const r = await client.request('setBreakpoints', { source: { path: path.join(root, file) }, breakpoints: lines.map((line) => ({ line })), lines });
      return ((r.body?.breakpoints as { line?: number }[]) ?? []).map((b, i) => b.line ?? lines[i]);
    },
    async start() {
      if (started) return;
      started = true;
      await client.request('configurationDone');
      await attached;
    },
    async resume() {
      await client.request('continue', { threadId });
    },
    async step(kind: StepKind) {
      await client.request(kind === 'over' ? 'next' : kind === 'into' ? 'stepIn' : 'stepOut', { threadId });
    },
    async pause() {
      await client.request('pause', { threadId });
    },
    async scopes(frameId) {
      const r = await client.request('scopes', { frameId: Number(frameId) });
      const out: DebugScope[] = [];
      for (const scope of (r.body?.scopes as { name: string; variablesReference: number }[]) ?? []) {
        out.push({ name: scope.name, variables: await variables(String(scope.variablesReference)) });
      }
      return out;
    },
    children: variables,
    async evaluate(expression, frameId) {
      try {
        const r = await client.request('evaluate', { expression, frameId: Number(frameId), context: 'watch' });
        return toVariable({ name: expression, value: String(r.body?.result ?? ''), type: r.body?.type as string | undefined, variablesReference: r.body?.variablesReference as number | undefined });
      } catch (error) {
        return { name: expression, value: (error as Error).message, type: 'error' };
      }
    },
    stop() {
      void client.request('disconnect', { terminateDebuggee: true }, 2000).catch(() => {});
      setTimeout(() => {
        client.close();
        if (!exited) killTree(child);
      }, 300);
    },
  };
}
