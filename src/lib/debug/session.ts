/**
 * Debug sessions: one program under a debugger each, kept until it ends, is stopped or sits idle. The browser polls
 * for state (like dev servers) and sends commands; the debugger itself only ever listens on 127.0.0.1.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import { KEEP, RUN_PROJECTS, runEnv, type RunRequest } from '../polyglot.ts';
import { writeProject } from '../proc.ts';
import { childEnv, resolveUv } from '../python.ts';
import { launchNode } from './node.ts';
import { launchPython } from './python.ts';
import type { DebugState, Debuggee, StepKind } from './types.ts';

export const MAX_SESSIONS = 3;
const IDLE_MS = 15 * 60 * 1000;
const MAX_OUTPUT = 2000;
const MAX_OUTPUT_TEXT = 8000;

/** Which debugger an entry file needs, or null when the studio can't debug it yet */
export function debugLanguage(entry: string): 'node' | 'python' | null {
  if (/\.py$/i.test(entry)) return 'python';
  if (/\.(m|c)?(t|j)s$/i.test(entry) && !/\.d\.ts$/i.test(entry)) return 'node';
  return null;
}

/** Breakpoints from the browser: project paths to line numbers */
export function parseBreakpoints(input: unknown, files: Record<string, string>): Record<string, number[]> | { error: string } {
  if (input === undefined) return {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'breakpoints must be an object of file -> lines' };
  const out: Record<string, number[]> = {};
  for (const [file, lines] of Object.entries(input as Record<string, unknown>)) {
    if (!(file in files)) continue;
    if (!Array.isArray(lines) || lines.length > 200 || lines.some((l) => !Number.isInteger(l) || l < 1 || l > 1_000_000)) return { error: `Breakpoints in ${file} must be line numbers` };
    out[file] = [...new Set(lines as number[])].sort((a, b) => a - b);
  }
  return out;
}

interface Session {
  state: DebugState;
  debuggee: Debuggee | null;
  seq: number;
  touched: number;
  files: Set<string>;
}

const sessions = new Map<string, Session>();

setInterval(() => {
  for (const [id, s] of sessions) if (Date.now() - s.touched > IDLE_MS) stopSession(id);
}, 60_000).unref();

const say = (s: Session, stream: 'stdout' | 'stderr' | 'info', text: string) => {
  s.state.output.push({ seq: ++s.seq, stream, text: text.length > MAX_OUTPUT_TEXT ? `${text.slice(0, MAX_OUTPUT_TEXT)}…` : text });
  if (s.state.output.length > MAX_OUTPUT) s.state.output.splice(0, s.state.output.length - MAX_OUTPUT);
};

export async function startSession(request: RunRequest, breakpoints: Record<string, number[]>): Promise<DebugState> {
  const language = debugLanguage(request.entry);
  if (!language) throw new Error('The debugger works with TypeScript, JavaScript and Python entry files for now.');
  // Leave room by ending finished sessions first, then the oldest
  for (const [id, s] of sessions) if (s.state.status === 'exited' || s.state.status === 'failed') sessions.delete(id);
  if (sessions.size >= MAX_SESSIONS) stopSession([...sessions.keys()][0]);
  const id = crypto.randomUUID();
  const session: Session = {
    state: { id, language, status: 'starting', frames: [], scopes: [], breakpoints: {}, output: [] },
    debuggee: null,
    seq: 0,
    touched: Date.now(),
    files: new Set(Object.keys(request.files)),
  };
  sessions.set(id, session);
  const projectDir = path.join(RUN_PROJECTS, `debug-${request.projectId}`);
  await writeProject(projectDir, request.files, { keep: KEEP });

  const events = {
    paused: (frames: DebugState['frames'], reason: string) => {
      const top = frames.find((f) => f.file) ?? frames[0];
      session.state = { ...session.state, status: 'paused', reason, frames, frameId: top?.id, scopes: [] };
      if (top && session.debuggee) {
        void session.debuggee
          .scopes(top.id)
          .then((scopes) => {
            if (session.state.frameId === top.id) session.state = { ...session.state, scopes };
          })
          .catch(() => {});
      }
    },
    resumed: () => {
      if (session.state.status === 'paused') session.state = { ...session.state, status: 'running', reason: undefined, frames: [], scopes: [], frameId: undefined };
    },
    output: (stream: 'stdout' | 'stderr', text: string) => say(session, stream, text),
    exited: (code: number | null) => {
      if (session.state.status !== 'failed') session.state = { ...session.state, status: 'exited', exitCode: code, frames: [], scopes: [], frameId: undefined, reason: undefined };
      say(session, 'info', `Exited with code ${code ?? 'none (stopped)'}\n`);
    },
  };

  try {
    if (language === 'node') {
      session.debuggee = await launchNode({ projectDir, entry: request.entry, args: request.args, env: runEnv(process.env, projectDir, request.env) }, events);
    } else {
      const uv = await resolveUv();
      if (!uv) throw new Error('Python debugging needs uv. Install it from the Python panel, then try again.');
      say(session, 'info', 'Starting Python with debugpy (the first time, uv downloads it)…\n');
      session.debuggee = await launchPython({ projectDir, entry: request.entry, args: request.args, env: childEnv(process.env, projectDir, request.env), uv: uv.bin }, events);
    }
    for (const [file, lines] of Object.entries(breakpoints)) {
      session.state.breakpoints[file] = await session.debuggee.setBreakpoints(file, lines);
    }
    session.state = { ...session.state, status: 'running' };
    await session.debuggee.start();
  } catch (error) {
    session.debuggee?.stop();
    session.state = { ...session.state, status: 'failed', error: (error as Error).message };
  }
  return session.state;
}

function get(id: string): Session {
  const s = sessions.get(id);
  if (!s) throw Object.assign(new Error('That debug session has ended'), { status: 404 });
  s.touched = Date.now();
  return s;
}

/** The state, with only the output after `since` */
export function sessionState(id: string, since = 0): DebugState {
  const s = get(id);
  return { ...s.state, output: s.state.output.filter((o) => o.seq > since) };
}

const live = (s: Session) => {
  if (!s.debuggee || s.state.status === 'exited' || s.state.status === 'failed') throw Object.assign(new Error('The program is not running'), { status: 409 });
  return s.debuggee;
};

export type DebugCommand =
  | { action: 'continue' | 'pause' | 'stop' }
  | { action: 'step'; kind: StepKind }
  | { action: 'breakpoints'; file: string; lines: number[] }
  | { action: 'frame'; frameId: string }
  | { action: 'children'; ref: string }
  | { action: 'evaluate'; expression: string; frameId?: string };

export async function command(id: string, cmd: DebugCommand): Promise<unknown> {
  const s = get(id);
  switch (cmd.action) {
    case 'stop':
      stopSession(id);
      return { ok: true };
    case 'continue':
      await live(s).resume();
      return { ok: true };
    case 'pause':
      await live(s).pause();
      return { ok: true };
    case 'step':
      await live(s).step(cmd.kind);
      return { ok: true };
    case 'breakpoints': {
      if (!s.files.has(cmd.file)) throw Object.assign(new Error('Not a file of this project'), { status: 400 });
      const landed = await live(s).setBreakpoints(cmd.file, cmd.lines);
      s.state.breakpoints = { ...s.state.breakpoints, [cmd.file]: landed };
      return { lines: landed };
    }
    case 'frame': {
      if (s.state.status !== 'paused' || !s.state.frames.some((f) => f.id === cmd.frameId)) throw Object.assign(new Error('That frame is gone'), { status: 409 });
      const scopes = await live(s).scopes(cmd.frameId);
      s.state = { ...s.state, frameId: cmd.frameId, scopes };
      return { scopes };
    }
    case 'children':
      return { variables: await live(s).children(cmd.ref) };
    case 'evaluate': {
      const frameId = cmd.frameId ?? s.state.frameId;
      if (s.state.status !== 'paused' || !frameId) throw Object.assign(new Error('Values can be read while the program is paused'), { status: 409 });
      return { result: await live(s).evaluate(cmd.expression, frameId) };
    }
  }
}

export function stopSession(id: string): void {
  const s = sessions.get(id);
  if (!s) return;
  s.debuggee?.stop();
  if (s.state.status !== 'exited' && s.state.status !== 'failed') s.state = { ...s.state, status: 'exited', exitCode: null, frames: [], scopes: [] };
  // Kept briefly so the last poll sees it end
  setTimeout(() => sessions.delete(id), 30_000).unref();
}

/** A command from the browser, checked */
export function parseCommand(body: Record<string, unknown>): DebugCommand | { error: string } {
  const action = body.action;
  if (action === 'continue' || action === 'pause' || action === 'stop') return { action };
  if (action === 'step') return body.kind === 'over' || body.kind === 'into' || body.kind === 'out' ? { action, kind: body.kind } : { error: 'kind is over, into or out' };
  if (action === 'breakpoints') {
    if (typeof body.file !== 'string' || !Array.isArray(body.lines) || body.lines.length > 200 || body.lines.some((l) => !Number.isInteger(l) || (l as number) < 1)) return { error: 'file and lines are required' };
    return { action, file: body.file, lines: body.lines as number[] };
  }
  if (action === 'frame') return typeof body.frameId === 'string' && body.frameId.length < 200 ? { action, frameId: body.frameId } : { error: 'frameId is required' };
  if (action === 'children') return typeof body.ref === 'string' && body.ref.length < 200 ? { action, ref: body.ref } : { error: 'ref is required' };
  if (action === 'evaluate') {
    if (typeof body.expression !== 'string' || !body.expression.trim() || body.expression.length > 2000) return { error: 'expression is required (up to 2000 characters)' };
    return { action, expression: body.expression, ...(typeof body.frameId === 'string' ? { frameId: body.frameId } : {}) };
  }
  return { error: 'Unknown action' };
}
