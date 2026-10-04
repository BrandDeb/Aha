/**
 * Prompt construction for the studio's Claude-powered assistant - server only.
 */

import type Anthropic from '@anthropic-ai/sdk';

export const AI_MODEL = 'claude-opus-5-5';

export type AiAction = 'chat' | 'explain' | 'fix' | 'tests';

export interface AiDiagnostic {
  file?: string;
  line: number;
  column: number;
  code: string;
  message: string;
  hint?: string;
}

export interface AiRequest {
  action: AiAction;
  /** Prior turns, oldest first. Only used for `chat`. */
  history: { role: 'user' | 'assistant'; content: string }[];
  /** The user's latest message (chat) or extra instruction (other actions) */
  prompt: string;
  activeFile: string;
  /** Project files the assistant may read */
  files: Record<string, string>;
  /** Selected text in the active file, if any */
  selection?: string;
  diagnostics: AiDiagnostic[];
}

const MAX_CONTEXT_BYTES = 400 * 1024;
const MAX_HISTORY = 20;

/**
 * Stable instructions — kept byte-identical across requests so the prompt
 * cache can reuse them.
 */
export const SYSTEM_PROMPT = `You are the coding assistant inside NanoCLI Studio, a browser IDE where people write TypeScript command-line programs and compile them to native executables or WASI modules with scriptc (github.com/vercel-labs/scriptc).

About scriptc:
- It compiles ordinary TypeScript (type-checked by the real TypeScript compiler) through LLVM, with no JavaScript engine in the output.
- It supports a growing static subset of TypeScript and Node APIs (node:fs, node:path, node:http, process, console, timers, fetch, async/await, classes, generics, closures).
- Common unsupported patterns and their fixes: reading properties of an untyped catch binding (narrow with \`err instanceof Error\` or use String(err)); eval and new Function (rewrite without runtime code evaluation); module.exports / require (use ES module import/export); values whose type mixes string and number where a string is expected (convert explicitly).
- Diagnostics look like "file:line:col - error SC2020: message" followed by a hint.
- Programs are built from an entry file; relative imports between project files work.

How to answer:
- Be direct and specific to the user's code. Reference files and line numbers.
- When you change code, return complete, compilable code in fenced \`\`\`ts blocks. When a block replaces a whole file, put the file path as the first line comment, e.g. // src/main.ts
- Keep code inside the scriptc-supported surface described above.
- For tests, write a self-contained test program (no test framework) that exercises the code with assertions via a small assert helper and prints a summary; it must compile with scriptc.
- Do not invent APIs. If something cannot work under scriptc yet, say so and offer the closest alternative.`;

const ACTION_INSTRUCTIONS: Record<AiAction, string> = {
  chat: '',
  explain: 'Explain what the active file does: its purpose, control flow and anything surprising. Keep it concise and concrete.',
  fix: 'Fix the scriptc compile errors listed below. Explain each cause in one sentence, then give the corrected file(s).',
  tests: 'Write a test program for the active file (or the selection). Save it as a new file next to it, e.g. main.test.ts, importing what it tests.',
};

function isRole(value: unknown): value is 'user' | 'assistant' {
  return value === 'user' || value === 'assistant';
}

/**
 * Validate an untrusted request body.
 */
export function parseAiRequest(body: unknown): AiRequest | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Invalid request body' };
  const input = body as Record<string, unknown>;

  const action = input.action;
  if (action !== 'chat' && action !== 'explain' && action !== 'fix' && action !== 'tests') {
    return { error: 'action must be chat, explain, fix or tests' };
  }
  const prompt = typeof input.prompt === 'string' ? input.prompt.slice(0, 20_000) : '';
  if (action === 'chat' && !prompt.trim()) return { error: 'prompt is required' };

  const files: Record<string, string> = {};
  let size = 0;
  if (input.files && typeof input.files === 'object' && !Array.isArray(input.files)) {
    for (const [path, content] of Object.entries(input.files as Record<string, unknown>)) {
      if (typeof content !== 'string' || path.length > 200) continue;
      size += content.length + path.length;
      if (size > MAX_CONTEXT_BYTES) return { error: 'Project is too large to send to the assistant' };
      files[path] = content;
    }
  }
  const activeFile = typeof input.activeFile === 'string' && input.activeFile in files ? input.activeFile : Object.keys(files)[0] ?? '';

  const history = Array.isArray(input.history)
    ? (input.history as unknown[])
        .filter((m): m is { role: 'user' | 'assistant'; content: string } =>
          !!m && typeof m === 'object' && isRole((m as { role?: unknown }).role) && typeof (m as { content?: unknown }).content === 'string')
        .slice(-MAX_HISTORY)
        .map(m => ({ role: m.role, content: m.content.slice(0, 20_000) }))
    : [];

  const diagnostics = Array.isArray(input.diagnostics)
    ? (input.diagnostics as AiDiagnostic[]).slice(0, 50).filter(d => d && typeof d.message === 'string')
    : [];

  return {
    action,
    prompt,
    history,
    files,
    activeFile,
    selection: typeof input.selection === 'string' ? input.selection.slice(0, 20_000) : undefined,
    diagnostics,
  };
}

/**
 * Build the message list: earlier chat turns, then one user turn carrying
 * the project context and the request.
 */
export function buildMessages(request: AiRequest): Anthropic.Beta.BetaMessageParam[] {
  const context = Object.entries(request.files)
    .map(([path, content]) => `<file path="${path}"${path === request.activeFile ? ' active="true"' : ''}>\n${content}\n</file>`)
    .join('\n');

  const parts = [`<project>\n${context}\n</project>`];
  if (request.selection) parts.push(`<selection file="${request.activeFile}">\n${request.selection}\n</selection>`);
  if (request.diagnostics.length) {
    parts.push(`<diagnostics>\n${request.diagnostics
      .map(d => `${d.file ?? request.activeFile}:${d.line}:${d.column} ${d.code}: ${d.message}${d.hint ? `\n  hint: ${d.hint}` : ''}`)
      .join('\n')}\n</diagnostics>`);
  }
  const instruction = [ACTION_INSTRUCTIONS[request.action], request.prompt].filter(Boolean).join('\n\n');
  parts.push(instruction);

  // Prior turns are text-only, so each history message stays a plain string
  return [
    ...request.history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: parts.join('\n\n') },
  ];
}
