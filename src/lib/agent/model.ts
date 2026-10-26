/**
 * Tool-calling for the providers the studio supports. Each adapter turns the
 * neutral conversation into the provider's wire format and the reply back into
 * a ModelTurn. The conversion functions are pure, so they are unit tested
 * without a network; `callModelFor` is the thin fetch around them.
 */

import { describeFailure, unreachableMessage, type ResolvedProvider } from '../ai-providers.ts';
import type { CallModel, Message, ModelTurn, ToolCall, ToolSpec } from './types.ts';

// ---------------------------------------------------------------------------
// OpenAI-compatible (Gemini, Groq, OpenRouter, Ollama, LM Studio, OpenAI, …)
// ---------------------------------------------------------------------------

export function toOpenAiMessages(system: string, messages: Message[]): unknown[] {
  const out: unknown[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.images?.length ? [{ type: 'text', text: m.content }, ...m.images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mediaType};base64,${i.data}` } }))] : m.content });
    else if (m.role === 'tool') out.push({ role: 'tool', tool_call_id: m.callId, content: m.content });
    else {
      out.push({
        role: 'assistant',
        content: m.content || null,
        ...(m.toolCalls?.length
          ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) }, ...(c.extra ? { extra_content: c.extra } : {}) })) }
          : {}),
      });
    }
  }
  return out;
}

export const toOpenAiTools = (tools: ToolSpec[]) =>
  tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return { __invalid: raw.slice(0, 200) };
  }
}

export function parseOpenAiTurn(data: unknown): ModelTurn {
  const body = data as {
    choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown }; extra_content?: Record<string, unknown> }[] }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const choice = body.choices?.[0];
  if (!choice?.message) throw new Error('The model returned an empty response.');
  const toolCalls: ToolCall[] = (choice.message.tool_calls ?? [])
    .filter((c) => c.function?.name)
    // Gemini 3 signs its tool calls (extra_content.google.thought_signature) and rejects a follow-up that drops the signature
    .map((c, i) => ({ id: c.id || `call_${i}`, name: c.function!.name!, args: parseArgs(c.function!.arguments), ...(c.extra_content && typeof c.extra_content === 'object' ? { extra: c.extra_content } : {}) }));
  const reason = choice.finish_reason ?? '';
  return {
    text: choice.message.content ?? '',
    toolCalls,
    stop: toolCalls.length ? 'tool_use' : reason === 'length' ? 'length' : reason === 'content_filter' ? 'refusal' : 'end',
    usage: body.usage ? { input: body.usage.prompt_tokens ?? 0, output: body.usage.completion_tokens ?? 0 } : undefined,
  };
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

export function toAnthropicMessages(messages: Message[]): unknown[] {
  const out: { role: 'user' | 'assistant'; content: unknown[] | string }[] = [];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.images?.length ? [...m.images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mediaType, data: i.data } })), { type: 'text', text: m.content }] : m.content });
    else if (m.role === 'assistant') {
      // Claude's own blocks, exactly as it sent them: its thinking blocks are signed and must come back unchanged
      if (m.raw?.length) {
        out.push({ role: 'assistant', content: m.raw });
        continue;
      }
      const blocks: unknown[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls ?? []) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args });
      out.push({ role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: '…' }] });
    } else {
      const block = { type: 'tool_result', tool_use_id: m.callId, content: m.content, is_error: !m.ok };
      const last = out[out.length - 1];
      // All results for one assistant turn go in a single user message
      if (last?.role === 'user' && Array.isArray(last.content)) last.content.push(block);
      else out.push({ role: 'user', content: [block] });
    }
  }
  return out;
}

export const toAnthropicTools = (tools: ToolSpec[]) => tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));

export function parseAnthropicTurn(data: unknown): ModelTurn {
  const body = data as {
    content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[];
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  if (!Array.isArray(body.content)) throw new Error('The model returned an empty response.');
  const toolCalls: ToolCall[] = body.content
    .filter((b) => b.type === 'tool_use' && b.name)
    .map((b, i) => ({ id: b.id || `call_${i}`, name: b.name!, args: parseArgs(b.input) }));
  const text = body.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  const reason = body.stop_reason ?? '';
  const thinks = body.content.some((b) => b.type === 'thinking' || b.type === 'redacted_thinking');
  return {
    ...(thinks ? { raw: body.content } : {}),
    text,
    toolCalls,
    stop: toolCalls.length ? 'tool_use' : reason === 'max_tokens' ? 'length' : reason === 'refusal' ? 'refusal' : 'end',
    usage: body.usage ? { input: body.usage.input_tokens ?? 0, output: body.usage.output_tokens ?? 0 } : undefined,
  };
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

function headers(target: ResolvedProvider): Record<string, string> {
  if (target.provider.kind === 'anthropic') {
    return { 'x-api-key': target.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
  }
  const h: Record<string, string> = {};
  if (target.apiKey) h.Authorization = `Bearer ${target.apiKey}`;
  if (target.provider.id === 'openrouter') h['X-Title'] = 'Aha!';
  return h;
}

/** Claude models that always think and bind thinking blocks to their conversation (Opus/Sonnet/Haiku 5.x, Fable, Mythos) */
const THINKING_BINDING = /^(?:anthropic\.)?claude-(?:(?:opus|sonnet|haiku)-[5-9]|fable|mythos)/;
const THINKING_BINDING_BETA = 'thinking-binding-controls-2026-08-01';

/** Every thinking block out of a history; each turn's text and tool calls stay */
export function stripThinking(messages: { role: string; content: unknown }[]): { role: string; content: unknown }[] {
  return messages.map((m) => {
    if (m.role !== 'assistant' || !Array.isArray(m.content)) return m;
    const kept = (m.content as { type?: string }[]).filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking');
    return { ...m, content: kept.length ? kept : [{ type: 'text', text: '…' }] };
  });
}

/** A CallModel that talks to the chosen provider directly from this tab */
export function callModelFor(target: ResolvedProvider, fetchImpl: typeof fetch = fetch): CallModel {
  const anthropic = target.provider.kind === 'anthropic';
  return async ({ system, messages, tools, signal }) => {
    const url = anthropic ? `${target.baseUrl}/v1/messages` : `${target.baseUrl}/chat/completions`;
    // Claude 5 models always think: a block whose conversation changed (the loop trims old tool output) is dropped, not a 400
    const binding = anthropic && THINKING_BINDING.test(target.model);
    const body: Record<string, unknown> = anthropic
      ? {
          model: target.model,
          max_tokens: 16000,
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          messages: toAnthropicMessages(messages),
          tools: toAnthropicTools(tools),
          ...(binding ? { thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } } } : {}),
        }
      : { model: target.model, messages: toOpenAiMessages(system, messages), tools: toOpenAiTools(tools) };

    const send = async (payload: Record<string, unknown>, extra: Record<string, string>) => {
      try {
        return await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers(target), ...extra }, body: JSON.stringify(payload), signal });
      } catch (error) {
        if ((error as Error).name === 'AbortError') throw error;
        throw new Error(unreachableMessage(target));
      }
    };
    let response = await send(body, binding ? { 'anthropic-beta': THINKING_BINDING_BETA } : {});
    if (anthropic && response.status === 400) {
      const detail = await response.clone().text().catch(() => '');
      if (binding && /block_binding|anthropic-beta|thinking-binding/i.test(detail)) {
        // An endpoint without the controls beta: the same request without them
        const { thinking: _thinking, ...plain } = body;
        response = await send(plain, {});
      } else if (/signature.{0,40}thinking|thinking.{0,40}signature/i.test(detail)) {
        // The documented one-time recovery: the turns stay, the reasoning blocks go
        response = await send({ ...body, messages: stripThinking(body.messages as { role: string; content: unknown }[]) }, binding ? { 'anthropic-beta': THINKING_BINDING_BETA } : {});
      }
    }
    if (!response.ok) throw new Error(await describeFailure(response, target));
    const data = await response.json().catch(() => null);
    return anthropic ? parseAnthropicTurn(data) : parseOpenAiTurn(data);
  };
}
