/**
 * Shared shapes for the agent: the conversation, the tools it can call, and
 * the events a run reports. Provider-neutral, so the loop can be tested with a
 * scripted model and any provider adapter can be plugged in.
 */

/**
 * How much a tool can affect:
 * - read:     looks at the project or the outside world without changing anything
 * - stage:    changes the agent's proposal (never the user's files)
 * - build:    compiles or runs inside the browser sandbox
 * - exec:     runs code or installs packages on the host
 * - external: calls a connector that may have side effects elsewhere
 */
export type Risk = 'read' | 'stage' | 'build' | 'exec' | 'external';

export interface JsonSchema {
  type: 'object';
  properties: Record<string, { type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object'; description?: string; enum?: string[]; items?: { type: string } }>;
  required?: string[];
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
  risk: Risk;
  /** A failing result counts against the fix-attempt budget (builds, tests) */
  verify?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Provider data that must be sent back with the call (Gemini's thought signature) */
  extra?: Record<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  content: string;
}

export interface Tool extends ToolSpec {
  run: (args: Record<string, unknown>, context: { signal?: AbortSignal }) => Promise<ToolResult>;
}

/** An image sent with a request (a screenshot or a sketch to build from), base64 without the data: prefix */
export interface ImageInput {
  mediaType: string;
  data: string;
}

export type Message =
  | { role: 'user'; content: string; images?: ImageInput[] }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[]; raw?: unknown[] }
  | { role: 'tool'; callId: string; name: string; content: string; ok: boolean };

export interface ModelTurn {
  text: string;
  toolCalls: ToolCall[];
  /** 'end' | 'tool_use' | 'length' | 'refusal' or the provider's own reason */
  stop: string;
  usage?: { input: number; output: number };
  /** The provider's own content blocks, replayed verbatim (Claude's signed thinking blocks must come back unchanged) */
  raw?: unknown[];
}

export type CallModel = (input: { system: string; messages: Message[]; tools: ToolSpec[]; signal?: AbortSignal }) => Promise<ModelTurn>;

export interface Budget {
  /** Model round-trips */
  maxSteps: number;
  maxToolCalls: number;
  maxMillis: number;
  /** Consecutive failed builds/tests before the agent must stop and report */
  maxFixAttempts: number;
  /** Tokens the model may use in all (input and output), when set: unattended runs spend no more than this */
  maxTokens?: number;
}

export const DEFAULT_BUDGET: Budget = { maxSteps: 25, maxToolCalls: 80, maxMillis: 10 * 60_000, maxFixAttempts: 4 };

export type StopReason = 'finished' | 'budget' | 'stuck' | 'aborted' | 'declined' | 'error';

export type AgentEvent =
  | { type: 'step'; step: number }
  | { type: 'text'; text: string }
  | { type: 'tool'; call: ToolCall; risk: Risk }
  | { type: 'approval'; call: ToolCall; approved: boolean }
  | { type: 'result'; call: ToolCall; result: ToolResult }
  | { type: 'notice'; text: string }
  | { type: 'done'; reason: StopReason; summary: string };

export interface AgentRun {
  reason: StopReason;
  summary: string;
  steps: number;
  toolCalls: number;
  messages: Message[];
  /** Tokens the model reported using, when the provider says (local models often don't) */
  usage: { input: number; output: number };
  ms: number;
}
