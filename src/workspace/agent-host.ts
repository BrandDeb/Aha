'use client';

/**
 * Connects the agent's tools to the studio: builds and runs go to the same
 * compiler API and WASI sandbox the toolbar uses, but on the agent's staged
 * files instead of the project's.
 */

import { compileTypeScriptBrowser, type CompileResult } from '@/lib/compiler-browser';
import type { AgentHost, HostOutcome } from '@/lib/agent/tools';
import type { Stage } from '@/lib/agent/stage';
import { isPython } from './project';
import { getPythonEnv, pythonProjectId, streamPython } from './python-client';
import { base64ToArrayBuffer, runWasm } from './runner';

const RUN_TIMEOUT_MS = 20_000;
const MAX_OUTPUT = 6000;

export function formatDiagnostics(result: CompileResult, entry: string): string {
  if (result.diagnostics?.length) {
    return result.diagnostics
      .map((d) => `${d.file ?? entry}:${d.line}:${d.column} error ${d.code}: ${d.message}${d.hint ? `\n  hint: ${d.hint}` : ''}`)
      .join('\n');
  }
  return result.error ?? 'The build failed.';
}

async function compile(files: Record<string, string>, entry: string, target: 'ir' | 'wasm'): Promise<CompileResult> {
  return compileTypeScriptBrowser({ files, entry, target });
}

export function createAgentHost(options: { stage: Stage; projectName: string; entry: string; files: Record<string, string>; onPlan: (plan: string) => void }): AgentHost {
  const { stage, entry, files, projectName } = options;
  const host: AgentHost = { stage, entry, onPlan: options.onPlan };

  if (!isPython(entry)) {
    host.build = async (staged, buildEntry) => {
      const result = await compile(staged, buildEntry, 'ir');
      return result.success ? { ok: true, text: `Build succeeded (${result.durationMs ?? 0} ms). No diagnostics.` } : { ok: false, text: formatDiagnostics(result, buildEntry) };
    };

    host.runProgram = async (staged, runEntry, args, signal): Promise<HostOutcome> => {
      const result = await compile(staged, runEntry, 'wasm');
      if (!result.success) {
        if (result.diagnostics?.some((d) => d.code === 'SC3002')) {
          return { ok: false, text: 'This program uses sockets (http or fetch), which WebAssembly cannot do in the browser, so it cannot be run here. A successful build is the check available for it.' };
        }
        return { ok: false, text: formatDiagnostics(result, runEntry) };
      }
      if (!result.output || !result.filename?.endsWith('.wasm')) return { ok: false, text: result.error ?? 'The compiler did not produce a WASM module.' };

      const lines: string[] = [];
      let size = 0;
      const handle = runWasm({ wasm: base64ToArrayBuffer(result.output), args, env: ['TERM=dumb'], files: staged }, (stream, line) => {
        if (size > MAX_OUTPUT) return;
        size += line.length + 1;
        lines.push(stream === 'stderr' ? `[stderr] ${line}` : line);
      });
      const timer = setTimeout(handle.stop, RUN_TIMEOUT_MS);
      signal?.addEventListener('abort', handle.stop);
      const done = await handle.done;
      clearTimeout(timer);
      const output = lines.join('\n') + (size > MAX_OUTPUT ? '\n… output truncated' : '');
      if (done.type === 'error') {
        const reason = done.message === 'Stopped' ? `Stopped after ${RUN_TIMEOUT_MS / 1000}s (timeout)` : `Runtime error: ${done.message}`;
        return { ok: false, text: `${reason}\n${output}`.trim() };
      }
      return { ok: done.code === 0, text: `Exit code ${done.code} in ${done.ms} ms\n${output || '(no output)'}` };
    };
  }

  if (isPython(entry) || 'pyproject.toml' in files) {
    host.python = async (command, staged, signal) => {
      const lines: string[] = [];
      let size = 0;
      const done = await streamPython(
        { ...command, entry: command.entry ?? entry, name: projectName, projectId: pythonProjectId(projectName), files: staged, env: getPythonEnv() },
        (stream, text) => {
          if (size > MAX_OUTPUT) return;
          size += text.length;
          lines.push(stream === 'stderr' ? text.replace(/^/gm, '[stderr] ') : text);
        },
        signal
      );
      const text = lines.join('').trim();
      const status = done.error ? `Failed: ${done.error}` : done.timedOut ? 'Timed out.' : `Exit code ${done.code} in ${done.ms} ms`;
      return { ok: done.code === 0 && !done.error, text: `${status}\n${text}${size > MAX_OUTPUT ? '\n… output truncated' : ''}`.trim(), changed: done.changed, removed: done.removed };
    };
  }
  return host;
}
