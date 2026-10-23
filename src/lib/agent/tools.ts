/**
 * The agent's built-in tools over the project. Reads see the staged view
 * (the project with the agent's pending edits), writes only change the stage,
 * and builds run against the stage, so the agent can iterate on a fix without
 * touching the user's files until they accept the result.
 */

import { lineDelta } from '../../workspace/project.ts';
import type { Stage } from './stage.ts';
import type { Tool, ToolResult } from './types.ts';

export interface HostOutcome {
  ok: boolean;
  text: string;
}

export interface PythonHostCommand {
  action: 'run' | 'add' | 'remove' | 'sync';
  entry?: string;
  args?: string[];
  packages?: string[];
}

export interface AgentHost {
  stage: Stage;
  entry: string;
  /** Type-check and compile the staged project; `text` lists any diagnostics */
  build?: (files: Record<string, string>, entry: string, signal?: AbortSignal) => Promise<HostOutcome>;
  /** Run the staged project in the browser sandbox and return what it printed */
  runProgram?: (files: Record<string, string>, entry: string, args: string[], signal?: AbortSignal) => Promise<HostOutcome>;
  /** uv commands for Python projects; files the command changes come back to be staged */
  python?: (command: PythonHostCommand, files: Record<string, string>, signal?: AbortSignal) => Promise<HostOutcome & { changed?: Record<string, string>; removed?: string[] }>;
  /** Run the staged project in its language (Go, Rust, Java, C…) on this machine; files the run changes come back to be staged */
  runCode?: (files: Record<string, string>, entry: string, args: string[], signal?: AbortSignal) => Promise<HostOutcome & { changed?: Record<string, string>; removed?: string[] }>;
  /** Name of that language, for the tool's description */
  languageName?: string;
  /** Run the project's CI file (or one job of it) on this machine against the staged files */
  runPipeline?: (files: Record<string, string>, file: string, job: string | undefined, signal?: AbortSignal) => Promise<HostOutcome>;
  /** The CI files in the project, for the tool's description */
  pipelineFiles?: string[];
  onPlan?: (plan: string) => void;
}

const fail = (content: string): ToolResult => ({ ok: false, content });
const ok = (content: string): ToolResult => ({ ok: true, content });
const str = (v: unknown) => (typeof v === 'string' ? v : '');

export const MAX_READ_LINES = 400;
const MAX_MATCHES = 60;

function numbered(content: string, from: number, to: number): string {
  const lines = content.split('\n');
  const width = String(Math.min(lines.length, to)).length;
  return lines
    .slice(from - 1, to)
    .map((line, i) => `${String(from + i).padStart(width)} | ${line}`)
    .join('\n');
}

/** When an edit's text isn't found, point at the closest line so the model can correct itself */
function closestHint(content: string, wanted: string): string {
  const first = wanted.split('\n').find((l) => l.trim())?.trim();
  if (!first) return '';
  const lines = content.split('\n');
  const index = lines.findIndex((l) => l.includes(first));
  if (index >= 0) return ` A line containing “${first.slice(0, 60)}” exists at line ${index + 1}; the text around it differs (check whitespace and the surrounding lines).`;
  const loose = lines.findIndex((l) => l.replace(/\s+/g, '') === first.replace(/\s+/g, ''));
  return loose >= 0 ? ` Line ${loose + 1} matches except for whitespace.` : ' Read the file again to copy the exact text.';
}

export function workspaceTools(host: AgentHost): Tool[] {
  const { stage } = host;

  const tools: Tool[] = [
    {
      name: 'update_plan',
      description: 'Record or update your plan as a short markdown checklist (“- [ ] step”, “- [x] done”). Call it first, and again when steps complete or the plan changes.',
      risk: 'read',
      parameters: { type: 'object', properties: { steps: { type: 'string', description: 'The checklist, one step per line' } }, required: ['steps'] },
      run: async (args) => {
        host.onPlan?.(str(args.steps));
        return ok('Plan recorded.');
      },
    },
    {
      name: 'list_files',
      description: 'List the project’s files (including your pending edits), optionally only under a folder.',
      risk: 'read',
      parameters: { type: 'object', properties: { folder: { type: 'string', description: 'Only list paths under this folder' } } },
      run: async (args) => {
        const prefix = str(args.folder).replace(/^\/+|\/+$/g, '');
        const changes = stage.changes();
        const files = Object.entries(stage.files())
          .filter(([path]) => !prefix || path === prefix || path.startsWith(`${prefix}/`))
          .sort(([a], [b]) => a.localeCompare(b));
        if (!files.length) return ok('No files.');
        return ok(files.map(([path, content]) => `${path}  (${content.split('\n').length} lines)${changes[path] ? `  [${changes[path]} by you]` : ''}${path === host.entry ? '  [entry]' : ''}`).join('\n'));
      },
    },
    {
      name: 'read_file',
      description: `Read a file with line numbers. Reads up to ${MAX_READ_LINES} lines at a time; use start_line and end_line for more.`,
      risk: 'read',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, start_line: { type: 'integer' }, end_line: { type: 'integer' } },
        required: ['path'],
      },
      run: async (args) => {
        const path = str(args.path);
        const content = stage.read(path);
        if (content === undefined) return fail(`“${path}” does not exist. Use list_files to see what does.`);
        const total = content.split('\n').length;
        const from = Math.max(1, Number(args.start_line) || 1);
        const to = Math.min(total, Number(args.end_line) || from + MAX_READ_LINES - 1, from + MAX_READ_LINES - 1);
        if (from > total) return fail(`“${path}” has only ${total} lines.`);
        const more = to < total ? `\n… ${total - to} more lines (ask for start_line=${to + 1})` : '';
        return ok(`${path} (${total} lines)\n${numbered(content, from, to)}${more}`);
      },
    },
    {
      name: 'search',
      description: 'Search every file for text (or a regular expression with regex=true). Returns path:line: text.',
      risk: 'read',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, regex: { type: 'boolean' }, folder: { type: 'string', description: 'Only search under this folder' } },
        required: ['query'],
      },
      run: async (args) => {
        const query = str(args.query);
        if (!query) return fail('The query is empty.');
        let test: (line: string) => boolean;
        if (args.regex === true) {
          try {
            const re = new RegExp(query);
            test = (line) => re.test(line);
          } catch (error) {
            return fail(`Invalid regular expression: ${(error as Error).message}`);
          }
        } else {
          const lower = query.toLowerCase();
          test = (line) => line.toLowerCase().includes(lower);
        }
        const prefix = str(args.folder).replace(/^\/+|\/+$/g, '');
        const hits: string[] = [];
        let total = 0;
        for (const [path, content] of Object.entries(stage.files()).sort(([a], [b]) => a.localeCompare(b))) {
          if (prefix && path !== prefix && !path.startsWith(`${prefix}/`)) continue;
          content.split('\n').forEach((line, i) => {
            if (!test(line)) return;
            total++;
            if (hits.length < MAX_MATCHES) hits.push(`${path}:${i + 1}: ${line.trim().slice(0, 200)}`);
          });
        }
        if (!total) return ok('No matches.');
        return ok(`${hits.join('\n')}${total > hits.length ? `\n… ${total - hits.length} more matches` : ''}`);
      },
    },
    {
      name: 'write_file',
      description: 'Create a file or replace it entirely with the given content. For small changes to an existing file, prefer edit_file.',
      risk: 'stage',
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      run: async (args) => {
        const path = str(args.path);
        const before = stage.read(path);
        const problem = stage.write(path, str(args.content));
        if (problem) return fail(problem);
        const { added, removed } = lineDelta(before ?? '', str(args.content));
        return ok(before === undefined ? `Created ${path} (${added} lines).` : `Replaced ${path} (+${added} −${removed} lines).`);
      },
    },
    {
      name: 'edit_file',
      description: 'Replace exact text in a file. “old” must match the file exactly once (include enough surrounding lines to be unique), or set replace_all=true to replace every occurrence.',
      risk: 'stage',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' }, replace_all: { type: 'boolean' } },
        required: ['path', 'old', 'new'],
      },
      run: async (args) => {
        const path = str(args.path);
        const content = stage.read(path);
        if (content === undefined) return fail(`“${path}” does not exist. Use write_file to create it.`);
        const old = str(args.old);
        const replacement = str(args.new);
        if (!old) return fail('“old” must not be empty. To create or replace a whole file use write_file.');
        if (old === replacement) return fail('“old” and “new” are identical, so nothing would change.');
        const count = content.split(old).length - 1;
        if (count === 0) return fail(`The text to replace was not found in ${path}.${closestHint(content, old)}`);
        if (count > 1 && args.replace_all !== true) return fail(`The text appears ${count} times in ${path}. Add surrounding lines to make it unique, or set replace_all=true.`);
        const next = args.replace_all === true ? content.split(old).join(replacement) : content.replace(old, () => replacement);
        const problem = stage.write(path, next);
        if (problem) return fail(problem);
        const { added, removed } = lineDelta(content, next);
        return ok(`Edited ${path} (+${added} −${removed} lines${count > 1 ? `, ${count} occurrences` : ''}).`);
      },
    },
    {
      name: 'delete_file',
      description: 'Delete a file.',
      risk: 'stage',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      run: async (args) => {
        const problem = stage.delete(str(args.path));
        return problem ? fail(problem) : ok(`Deleted ${str(args.path)}.`);
      },
    },
  ];

  if (host.build) {
    tools.push({
      name: 'build',
      description: 'Type-check and compile the project with scriptc, including your pending edits. Returns the diagnostics (file:line:col code message). Run it after changing code, and fix what it reports. Only files reachable from the entry file are checked; pass another entry to check a different file.',
      risk: 'build',
      verify: true,
      parameters: { type: 'object', properties: { entry: { type: 'string', description: `Entry file (default ${host.entry})` } } },
      run: async (args, { signal }) => {
        const entry = str(args.entry) || host.entry;
        if (!stage.has(entry)) return fail(`The entry file “${entry}” does not exist.`);
        const outcome = await host.build!(stage.files(), entry, signal);
        return { ok: outcome.ok, content: outcome.text };
      },
    });
  }

  if (host.runProgram) {
    tools.push({
      name: 'run_program',
      description: 'Build the project to WebAssembly and run it in the browser sandbox (no network, files limited to the project). Returns its output and exit code. Use it to check behaviour, not just that it compiles.',
      risk: 'build',
      verify: true,
      parameters: { type: 'object', properties: { args: { type: 'array', items: { type: 'string' }, description: 'Command-line arguments' }, entry: { type: 'string' } } },
      run: async (args, { signal }) => {
        const entry = str(args.entry) || host.entry;
        if (!stage.has(entry)) return fail(`The entry file “${entry}” does not exist.`);
        const list = Array.isArray(args.args) ? args.args.map(String) : [];
        const outcome = await host.runProgram!(stage.files(), entry, list, signal);
        return { ok: outcome.ok, content: outcome.text };
      },
    });
  }

  if (host.python) {
    tools.push({
      name: 'python',
      description: 'Run a uv command for this Python project: run the entry file (or another .py), add or remove packages, or sync the environment. This executes on the host, so the user is asked first.',
      risk: 'exec',
      verify: true,
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['run', 'add', 'remove', 'sync'] },
          entry: { type: 'string', description: 'For run: the file to run (default: the project entry)' },
          args: { type: 'array', items: { type: 'string' }, description: 'For run: program arguments' },
          packages: { type: 'array', items: { type: 'string' }, description: 'For add/remove: package names or specifiers such as "httpx>=0.27"' },
        },
        required: ['action'],
      },
      run: async (args, { signal }) => {
        const command: PythonHostCommand = {
          action: str(args.action) as PythonHostCommand['action'],
          entry: str(args.entry) || undefined,
          args: Array.isArray(args.args) ? args.args.map(String) : undefined,
          packages: Array.isArray(args.packages) ? args.packages.map(String) : undefined,
        };
        const outcome = await host.python!(command, stage.files(), signal);
        for (const [path, content] of Object.entries(outcome.changed ?? {})) stage.write(path, content);
        for (const path of outcome.removed ?? []) stage.delete(path);
        return { ok: outcome.ok, content: outcome.text };
      },
    });
  }

  if (host.runCode) {
    tools.push({
      name: 'run_code',
      description: `Run the project's entry file${host.languageName ? ` with ${host.languageName}` : ''} on this machine (compiling first if the language needs it) and return its output and exit code. This executes code on the host, so the user is asked first.`,
      risk: 'exec',
      verify: true,
      parameters: {
        type: 'object',
        properties: {
          args: { type: 'array', items: { type: 'string' }, description: 'Command-line arguments' },
          entry: { type: 'string', description: `Entry file (default ${host.entry})` },
        },
      },
      run: async (args, { signal }) => {
        const entry = str(args.entry) || host.entry;
        if (!stage.has(entry)) return fail(`The entry file “${entry}” does not exist.`);
        const outcome = await host.runCode!(stage.files(), entry, Array.isArray(args.args) ? args.args.map(String) : [], signal);
        for (const [path, content] of Object.entries(outcome.changed ?? {})) stage.write(path, content);
        for (const path of outcome.removed ?? []) stage.delete(path);
        return { ok: outcome.ok, content: outcome.text };
      },
    });
  }

  if (host.runPipeline && host.pipelineFiles?.length) {
    const files = host.pipelineFiles;
    tools.push({
      name: 'run_pipeline',
      description: `Run the project's CI pipeline on this machine, with your pending edits: the same lint, test and build steps CI runs (${files.join(', ')}). Steps that only work on the CI service (deploys, caches) are skipped. Returns each job's steps with pass/fail and the output of failures. Use it to reproduce a CI failure and to prove the fix. This executes commands on the host, so the user is asked first.`,
      risk: 'exec',
      verify: true,
      parameters: {
        type: 'object',
        properties: {
          file: { type: 'string', description: `The CI file (default ${files[0]})` },
          job: { type: 'string', description: 'Run only this job (and the jobs it needs); default all' },
        },
      },
      run: async (args, { signal }) => {
        const file = str(args.file) || files[0];
        if (!stage.has(file)) return fail(`“${file}” does not exist. CI files: ${files.join(', ')}`);
        const outcome = await host.runPipeline!(stage.files(), file, str(args.job) || undefined, signal);
        return { ok: outcome.ok, content: outcome.text };
      },
    });
  }

  return tools;
}
