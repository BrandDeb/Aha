/**
 * Running a program for live values: the project's files go in its run folder
 * (shared with Run, so installed packages are there), the TypeScript and
 * JavaScript files are instrumented into .aha-live/, and the entry runs
 * with a small runtime that records hits and values per line and writes them
 * out when the program ends. Python runs under a sys.settrace tracer instead.
 * Like Run, it executes the program on the host: local only. Server only.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { KEEP, RUN_PROJECTS, runEnv } from '../polyglot.ts';
import { createJobPool, createKeyedLock, isSafeRelativePath, runStep, writeProject } from '../proc.ts';
import { instrument } from './instrument.ts';
import { PY_TRACER } from './python-tracer.ts';
import { LIVE_SOURCE, liveSupported, type LiveLine, type LiveStep, type LiveRequest, type LiveResult } from './shared.ts';

export { LIVE_SOURCE, liveSupported, type LiveLine, type LiveRequest, type LiveResult };

const PROJECT_ID = /^[A-Za-z0-9_-]{8,40}$/;

export function parseLiveRequest(body: unknown): LiveRequest | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Invalid request body' };
  const input = body as Record<string, unknown>;
  if (typeof input.projectId !== 'string' || !PROJECT_ID.test(input.projectId)) return { error: 'projectId is missing or invalid' };
  if (typeof input.entry !== 'string' || !isSafeRelativePath(input.entry) || !liveSupported(input.entry)) return { error: 'Live values work for TypeScript, JavaScript and Python entry files' };
  if (!input.files || typeof input.files !== 'object' || Array.isArray(input.files)) return { error: 'files must be an object of path -> content' };
  const files: Record<string, string> = {};
  let total = 0;
  const entries = Object.entries(input.files as Record<string, unknown>);
  if (entries.length > 300) return { error: 'Too many files' };
  for (const [name, content] of entries) {
    if (!isSafeRelativePath(name) || typeof content !== 'string') return { error: `Invalid file: ${name.slice(0, 80)}` };
    total += content.length;
    files[name] = content;
  }
  if (total > 8 * 1024 * 1024) return { error: 'Project too large' };
  if (!(input.entry in files)) return { error: 'entry must name a file in the project' };
  const args = Array.isArray(input.args) ? input.args.filter((a): a is string => typeof a === 'string').slice(0, 50) : [];
  return { projectId: input.projectId, files, entry: input.entry, args };
}

/** Records hits and values while the program runs; written out when it ends (or when it has run too much) */
const JS_RUNTIME = `'use strict';
const fs = require('fs');
const MAX_EVENTS = 300000, MAX_FIRST = 8, MAX_LEN = 72;
const data = {};
// Rewind: every line that ran, in order, with what it set (capped; the per-line summary above is not)
const MAX_STEPS = 20000;
const steps = [];
let events = 0, truncated = false, last = null;
function fmt(v, depth) {
  depth = depth || 0;
  try {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    switch (typeof v) {
      case 'string': return JSON.stringify(v.length > 60 ? v.slice(0, 60) + '…' : v);
      case 'number': case 'boolean': return String(v);
      case 'bigint': return v + 'n';
      case 'symbol': return v.toString();
      case 'function': return 'ƒ ' + (v.name || 'anonymous');
    }
    if (v instanceof Error) return v.name + ': ' + v.message;
    if (v instanceof Date) return v.toISOString();
    if (v instanceof RegExp) return String(v);
    if (typeof v.then === 'function') return 'Promise';
    if (depth > 1) return Array.isArray(v) ? '[…]' : '{…}';
    if (Array.isArray(v)) return '[' + v.slice(0, 6).map((x) => fmt(x, depth + 1)).join(', ') + (v.length > 6 ? ', … ' + v.length + ' items' : '') + ']';
    if (v instanceof Map) return 'Map(' + v.size + ') {' + [...v].slice(0, 4).map(([k, x]) => fmt(k, depth + 1) + ' => ' + fmt(x, depth + 1)).join(', ') + (v.size > 4 ? ', …' : '') + '}';
    if (v instanceof Set) return 'Set(' + v.size + ') {' + [...v].slice(0, 6).map((x) => fmt(x, depth + 1)).join(', ') + (v.size > 6 ? ', …' : '') + '}';
    const keys = Object.keys(v);
    const name = v.constructor && v.constructor.name !== 'Object' ? v.constructor.name + ' ' : '';
    return name + '{' + keys.slice(0, 5).map((k) => k + ': ' + fmt(v[k], depth + 1)).join(', ') + (keys.length > 5 ? ', …' : '') + '}';
  } catch (e) { return '‹unreadable›'; }
}
const short = (s) => (s.length > MAX_LEN ? s.slice(0, MAX_LEN - 1) + '…' : s);
function write() { try { fs.writeFileSync(process.env.AHA_LIVE_OUT, JSON.stringify({ truncated, data, steps })); } catch (e) {} }
function count() {
  if (++events > MAX_EVENTS && !truncated) { truncated = true; write(); process.stdout.write('\\n[live values: the program ran too long; showing the start of the run]\\n'); process.exit(124); }
}
globalThis.__h = (f, l) => { count(); last = f + ':' + l; const e = (data[last] ||= { hits: 0, values: {} }); e.hits++; if (steps.length < MAX_STEPS) steps.push([f, l, null]); };
function step(key, name, s) {
  // a value set by the line that just ran belongs to that moment; otherwise it is a moment of its own
  // (a loop header setting the next item, a call returning after its body ran)
  const top = steps[steps.length - 1];
  if (top && top[0] + ':' + top[1] === key) { (top[2] ||= {})[name] = s; return; }
  if (steps.length < MAX_STEPS) { const [f, l] = key.split(':'); steps.push([Number(f), Number(l), { [name]: s }]); }
}
function record(key, name, s) {
  step(key, name, s);
  const e = (data[key] ||= { hits: 0, values: {} });
  const x = (e.values[name] ||= { n: 0, first: [], last: s });
  x.n++; if (x.first.length < MAX_FIRST) x.first.push(s); x.last = s;
}
globalThis.__v = (f, l, name, v) => record(f + ':' + l, name, short(fmt(v)));
globalThis.__r = (f, l, v) => { globalThis.__v(f, l, 'return', v); return v; };
// An error nobody caught: shown on the last line that ran, where it was thrown
const threw = (error) => { if (!last) return; const [f, l] = last.split(':'); globalThis.__v(Number(f), Number(l), 'threw', error); };
process.on('uncaughtExceptionMonitor', threw);
process.on('unhandledRejection', (error) => { threw(error); process.exitCode = 1; console.error(error); });
process.on('exit', write);
// What the program printed, on the line that printed it (console calls are rewritten to this)
const util = require('util');
globalThis.__c = (f, l, m, ...a) => { record(f + ':' + l, 'out', short(util.format(...a).replace(/\\n/g, ' ⏎ '))); return console[m](...a); };
`;

/** Error output points into the instrumented copies: point it at the project's files, without the rewritten code */
export function cleanLiveOutput(output: string, liveDir: string, toOriginal: (rel: string) => string | undefined): string {
  const escaped = liveDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return output
    .replace(new RegExp(`^${escaped}[/\\\\]([^\\n:]+):(\\d+)\\n.*\\n\\s*\\^+\\n\\n?`, 'gm'), '')
    .replace(new RegExp(`${escaped}[/\\\\]([^\\s:)]+)(?::\\d+:\\d+)?`, 'g'), (whole, rel: string) => toOriginal(rel.replace(/\\/g, '/')) ?? whole)
    .replace(/^\s+at .*\(?node:[a-z_/]+:\d+:\d+\)?\n?/gm, '')
    .replace(/^\n?Node\.js v[\d.]+\n?/m, '')
    .replace(/^\s*File ".*[/\\](?:tracer\.py|runpy\.py)".*\n.*\n?/gm, '')
    .replace(/^\s*File "<frozen runpy>".*\n(?:\s{4}.*\n)?/gm, '');
}

const pool = createJobPool(Number(process.env.AHA_LIVE_JOBS) || 2, 4, 'Live values are busy with another run. Try again in a moment.');
const lock = createKeyedLock();

export async function runLive(request: LiveRequest, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<LiveResult> {
  const started = Date.now();
  return pool.run(() =>
    lock(request.projectId, async () => {
      const dir = path.join(RUN_PROJECTS, request.projectId);
      const liveDir = path.join(dir, '.aha-live');
      await writeProject(dir, request.files, { keep: new Set([...KEEP, '.aha-live', 'dist', 'build']) });
      await fs.rm(liveDir, { recursive: true, force: true });
      await fs.mkdir(liveDir, { recursive: true });
      const out = path.join(liveDir, 'result.json');
      const env: Record<string, string> = { ...runEnv(process.env, dir, {}), AHA_LIVE_OUT: out, NO_COLOR: '1' };
      const timeoutMs = options.timeoutMs ?? 10_000;
      const fileIds: string[] = [];
      const statementLines: Record<string, number[]> = {};
      let file: string;
      let args: string[];

      if (request.entry.endsWith('.py')) {
        const tracer = path.join(liveDir, 'tracer.py');
        await fs.writeFile(tracer, PY_TRACER);
        const { resolveUv } = await import('../python.ts');
        const uv = await resolveUv();
        if (uv && request.files['pyproject.toml']) {
          file = uv.bin;
          args = ['run', '--quiet', 'python', tracer, request.entry, ...request.args];
        } else {
          file = process.platform === 'win32' ? 'python' : 'python3';
          args = [tracer, request.entry, ...request.args];
        }
      } else {
        // Every JS/TS file, instrumented, in the same layout; CommonJS whatever the project's package.json says
        for (const [p, source] of Object.entries(request.files)) {
          if (!LIVE_SOURCE.test(p) || p.endsWith('.d.ts')) continue;
          const id = fileIds.push(p) - 1;
          let result;
          try {
            result = instrument(id, p, source);
          } catch (error) {
            return { ok: false, files: {}, output: '', code: null, ms: Date.now() - started, error: `Could not read ${p}: ${(error as Error).message}` };
          }
          statementLines[p] = result.statementLines;
          const target = path.join(liveDir, p.replace(/\.[cm]?[jt]s$/, '.js'));
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, result.code);
        }
        await fs.writeFile(path.join(liveDir, 'package.json'), '{ "type": "commonjs" }\n');
        await fs.writeFile(path.join(liveDir, '__live_runtime.cjs'), JS_RUNTIME);
        file = process.execPath;
        args = ['--require', path.join(liveDir, '__live_runtime.cjs'), path.join(liveDir, request.entry.replace(/\.[cm]?[jt]s$/, '.js')), ...request.args];
      }

      let output = '';
      const budget = { left: 1024 * 1024 };
      const outcome = await runStep({
        file,
        args,
        cwd: dir,
        env,
        timeoutMs,
        budget,
        maxOutputBytes: 1024 * 1024,
        onOutput: (_s, d) => {
          if (output.length < 200_000) output += d;
        },
        signal: options.signal,
      });
      const originals = new Map(fileIds.map((p) => [p.replace(/\.[cm]?[jt]s$/, '.js'), p]));
      output = cleanLiveOutput(output, liveDir, (rel) => originals.get(rel)).replaceAll(dir + path.sep, '');

      let raw: { truncated?: boolean; files?: Record<string, number[]>; data?: Record<string, LiveLine>; steps?: [number | string, number, Record<string, string> | null][] } = {};
      try {
        raw = JSON.parse(await fs.readFile(out, 'utf8'));
      } catch {
        // the program ended before it could write (killed by the time limit, or it crashed hard)
      }
      const files: LiveResult['files'] = {};
      // Python reports by file path and its own statement lines; JS by file id
      for (const [p, lines] of Object.entries(raw.files ?? statementLines)) {
        if (p in request.files) files[p] = { statementLines: lines, lines: {} };
      }
      for (const [key, line] of Object.entries(raw.data ?? {})) {
        const at = key.lastIndexOf(':');
        const ref = key.slice(0, at);
        const p = /^\d+$/.test(ref) ? fileIds[Number(ref)] : ref;
        if (!p || !(p in request.files)) continue;
        (files[p] ??= { statementLines: [], lines: {} }).lines[Number(key.slice(at + 1))] = line;
      }
      const ok = outcome.code === 0 && !outcome.timedOut && !outcome.spawnError;
      const steps: LiveStep[] = [];
      for (const [ref, line, values] of raw.steps ?? []) {
        const p = typeof ref === 'number' ? fileIds[ref] : ref;
        if (p && p in request.files) steps.push(values ? { file: p, line, values } : { file: p, line });
      }
      return {
        ok,
        files,
        steps,
        output,
        code: outcome.code,
        ms: Date.now() - started,
        ...(raw.truncated || outcome.timedOut ? { truncated: true } : {}),
        ...(outcome.spawnError ? { error: `Could not start the program: ${outcome.spawnError.message}` } : outcome.timedOut ? { error: `Stopped after ${Math.round(timeoutMs / 1000)} s: values are from the start of the run` } : {}),
      };
    })
  );
}
