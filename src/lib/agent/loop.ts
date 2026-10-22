/**
 * The agent loop: ask the model, run the tools it calls, feed the results
 * back, repeat. It is deliberately bounded. Every run has step, tool-call,
 * time and fix-attempt budgets; repeating the same failing call is detected
 * and stopped; when a budget runs out the model gets one last tool-free turn
 * to report honestly what it did and what is left.
 */

import { DEFAULT_BUDGET } from './types.ts';
import type { AgentEvent, AgentRun, Budget, CallModel, Message, Risk, StopReason, Tool, ToolCall, ToolResult, ToolSpec } from './types.ts';

export const MAX_TOOL_OUTPUT = 8000;
const CONTEXT_LIMIT_CHARS = 120_000;
const KEEP_RECENT = 8;

export interface AgentOptions {
  goal: string;
  system: string;
  tools: Tool[];
  callModel: CallModel;
  budget?: Partial<Budget>;
  /** Risks that run without asking. The default asks before anything that leaves the sandbox. */
  autoApprove?: Risk[];
  /** Ask the user; resolves true to allow. Without it, tools that need approval are refused. */
  approve?: (call: ToolCall, spec: ToolSpec) => Promise<boolean>;
  onEvent?: (event: AgentEvent) => void;
  signal?: AbortSignal;
  /** Earlier turns of the conversation, so a follow-up can build on them */
  history?: Message[];
  /** How many times to retry a failed model call (rate limits, brief outages) */
  modelRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export function truncate(text: string, max = MAX_TOOL_OUTPUT): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.7);
  const tail = max - head;
  return `${text.slice(0, head)}\n… [${text.length - max} characters omitted] …\n${text.slice(-tail)}`;
}

/** Check a call's arguments against the tool's schema so the model gets a precise error instead of a crash */
export function validateArgs(spec: ToolSpec, args: Record<string, unknown>): string | null {
  if ('__invalid' in args) return `The arguments were not valid JSON: ${String(args.__invalid)}`;
  for (const name of spec.parameters.required ?? []) {
    if (args[name] === undefined || args[name] === null) return `Missing required argument “${name}”.`;
  }
  for (const [name, value] of Object.entries(args)) {
    const def = spec.parameters.properties[name];
    if (!def) continue; // extra arguments are ignored
    const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    const ok = def.type === 'integer' ? Number.isInteger(value) : def.type === 'number' ? typeof value === 'number' : actual === def.type;
    if (!ok) return `Argument “${name}” must be ${def.type}, got ${actual}.`;
    if (def.enum && !def.enum.includes(String(value))) return `Argument “${name}” must be one of: ${def.enum.join(', ')}.`;
  }
  return null;
}

/** Replace the oldest tool outputs with a stub once the conversation gets large */
export function compactMessages(messages: Message[], limit = CONTEXT_LIMIT_CHARS): Message[] {
  const size = (m: Message) => m.content.length + (m.role === 'assistant' ? JSON.stringify(m.toolCalls ?? []).length : 0);
  let total = messages.reduce((n, m) => n + size(m), 0);
  if (total <= limit) return messages;
  const out = [...messages];
  for (let i = 0; i < out.length - KEEP_RECENT && total > limit; i++) {
    const m = out[i];
    if (m.role === 'tool' && m.content.length > 200) {
      const stub = '[earlier output removed to save context; call the tool again if you need it]';
      total -= m.content.length - stub.length;
      out[i] = { ...m, content: stub };
    }
  }
  return out;
}

/** A call is only a repeat if nothing has changed since the last time it failed */
const keyFor = (call: ToolCall, epoch: number) => `${epoch}:${call.name}:${JSON.stringify(call.args)}`;

export async function runAgent(options: AgentOptions): Promise<AgentRun> {
  const budget: Budget = { ...DEFAULT_BUDGET, ...options.budget };
  const emit = options.onEvent ?? (() => {});
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const auto = new Set<Risk>(options.autoApprove ?? ['read', 'stage', 'build']);
  const specs = options.tools.map(({ run: _run, ...spec }) => spec as ToolSpec);
  const byName = new Map(options.tools.map((t) => [t.name, t]));
  const started = now();

  const messages: Message[] = [...(options.history ?? []), { role: 'user', content: options.goal }];
  let steps = 0;
  let toolCalls = 0;
  let failedVerifies = 0;
  const failures = new Map<string, number>();
  let epoch = 0; // bumps whenever a tool changes the project or the host
  let lastText = '';
  const usage = { input: 0, output: 0 };

  const finish = (reason: StopReason, summary: string): AgentRun => {
    emit({ type: 'done', reason, summary });
    return { reason, summary, steps, toolCalls, messages, usage, ms: now() - started };
  };

  const turn = async (withTools: boolean) => {
    let attempt = 0;
    for (;;) {
      try {
        const reply = await options.callModel({ system: options.system, messages: compactMessages(messages), tools: withTools ? specs : [], signal: options.signal });
        usage.input += reply.usage?.input ?? 0;
        usage.output += reply.usage?.output ?? 0;
        return reply;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const transient = /rate limit|\b429\b|\b50\d\b|overloaded|temporar/i.test(message);
        if ((error as Error).name === 'AbortError' || !transient || attempt >= (options.modelRetries ?? 1)) throw error;
        attempt++;
        emit({ type: 'notice', text: `The model is busy; retrying (${attempt})…` });
        await sleep(2000 * attempt);
      }
    }
  };

  /** One last turn without tools, so the model can say honestly where things stand */
  const wrapUp = async (reason: StopReason, instruction: string): Promise<AgentRun> => {
    messages.push({ role: 'user', content: instruction });
    try {
      const final = await turn(false);
      if (final.text) {
        messages.push({ role: 'assistant', content: final.text });
        emit({ type: 'text', text: final.text });
        lastText = final.text;
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return finish('aborted', 'Stopped.');
    }
    return finish(reason, lastText || instruction);
  };

  for (;;) {
    if (options.signal?.aborted) return finish('aborted', 'Stopped.');
    if (steps >= budget.maxSteps) return wrapUp('budget', `You have used all ${budget.maxSteps} steps. Do not call any more tools. Summarise what you changed, what works, and what is still unfinished.`);
    if (now() - started > budget.maxMillis) return wrapUp('budget', 'You have run out of time. Do not call any more tools. Summarise what you changed, what works, and what is still unfinished.');
    if (toolCalls >= budget.maxToolCalls) return wrapUp('budget', 'You have used the tool-call budget. Do not call any more tools. Summarise what you changed, what works, and what is still unfinished.');

    steps++;
    emit({ type: 'step', step: steps });

    let reply;
    try {
      reply = await turn(true);
    } catch (error) {
      if ((error as Error).name === 'AbortError') return finish('aborted', 'Stopped.');
      return finish('error', error instanceof Error ? error.message : String(error));
    }

    if (reply.text) {
      lastText = reply.text;
      emit({ type: 'text', text: reply.text });
    }
    messages.push({ role: 'assistant', content: reply.text, toolCalls: reply.toolCalls.length ? reply.toolCalls : undefined });

    if (reply.stop === 'refusal' && !reply.toolCalls.length) return finish('declined', reply.text || 'The model declined this request.');
    if (!reply.toolCalls.length) {
      if (reply.stop === 'length') emit({ type: 'notice', text: 'The reply was cut off by the model’s length limit.' });
      return finish('finished', reply.text || 'Done.');
    }

    let stuck = false;
    for (const call of reply.toolCalls) {
      if (options.signal?.aborted) return finish('aborted', 'Stopped.');
      const tool = byName.get(call.name);
      let result: ToolResult;

      if (!tool) {
        emit({ type: 'tool', call, risk: 'read' });
        result = { ok: false, content: `There is no tool called “${call.name}”. Available tools: ${[...byName.keys()].join(', ')}.` };
      } else {
        emit({ type: 'tool', call, risk: tool.risk });
        const invalid = validateArgs(tool, call.args);
        if (invalid) {
          result = { ok: false, content: invalid };
        } else {
          let allowed = auto.has(tool.risk);
          if (!allowed) {
            allowed = options.approve ? await options.approve(call, tool) : false;
            emit({ type: 'approval', call, approved: allowed });
          }
          if (!allowed) {
            result = { ok: false, content: 'The user did not allow this action. Do not retry it; continue without it or explain what you need.' };
          } else {
            toolCalls++;
            try {
              result = await tool.run(call.args, { signal: options.signal });
            } catch (error) {
              if ((error as Error).name === 'AbortError') return finish('aborted', 'Stopped.');
              result = { ok: false, content: `The tool failed: ${error instanceof Error ? error.message : String(error)}` };
            }
          }
        }
        if (tool.verify) failedVerifies = result.ok ? 0 : failedVerifies + 1;
        if (result.ok && (tool.risk === 'stage' || tool.risk === 'exec' || tool.risk === 'external')) epoch++;
      }

      // The same call failing the same way is a loop, not progress
      if (!result.ok) {
        const n = (failures.get(keyFor(call, epoch)) ?? 0) + 1;
        failures.set(keyFor(call, epoch), n);
        if (n === 3) result = { ok: false, content: `${result.content}\n\nThis is the third time this exact call has failed. Try a different approach.` };
        if (n >= 5) stuck = true;
      }

      result = { ok: result.ok, content: truncate(result.content) };
      emit({ type: 'result', call, result });
      messages.push({ role: 'tool', callId: call.id, name: call.name, content: result.content, ok: result.ok });
    }

    if (failedVerifies > budget.maxFixAttempts) {
      return wrapUp('budget', `The build or tests have failed ${failedVerifies} times in a row. Do not call any more tools. Report what is failing, what you tried, and your best guess at the cause.`);
    }
    if (stuck) return wrapUp('stuck', 'You keep repeating a call that fails. Do not call any more tools. Explain what is blocking you and what the user could change.');
  }
}
