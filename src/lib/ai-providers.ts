/**
 * Bring-your-own-key model providers for the assistant. Browser-safe: requests
 * go straight from the user's tab to the provider (every provider listed here
 * sends CORS headers), so keys never reach the studio server and running the
 * studio costs the operator nothing.
 */

import type { ChatMessage } from './ai.ts';

export type ProviderKind = 'server' | 'anthropic' | 'openai';
export type ProviderCost = 'free' | 'free-tier' | 'paid' | 'host';

export interface Provider {
  id: string;
  name: string;
  kind: ProviderKind;
  /** API root; OpenAI-compatible providers append /chat/completions and /models */
  baseUrl: string;
  cost: ProviderCost;
  needsKey: boolean;
  /** Where to create a key */
  keyUrl?: string;
  /** Suggestions shown before the live model list is fetched */
  models: string[];
  note: string;
  /** Runs on the user's machine */
  local?: boolean;
  /** The base URL can be edited */
  editableUrl?: boolean;
  /** The model list can be read without a key */
  publicModelList?: boolean;
}

export const PROVIDERS: Provider[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    kind: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    cost: 'free-tier',
    needsKey: true,
    keyUrl: 'https://aistudio.google.com/apikey',
    models: ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-pro-latest'],
    note: 'Free tier with a Google account; no card needed. The “-latest” names always point at Google’s current Flash, Flash-Lite and Pro.',
  },
  {
    id: 'groq',
    name: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    cost: 'free-tier',
    needsKey: true,
    keyUrl: 'https://console.groq.com/keys',
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
    note: 'Free tier, very fast open models. Per-minute limits apply.',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    cost: 'free-tier',
    needsKey: true,
    keyUrl: 'https://openrouter.ai/keys',
    publicModelList: true,
    models: ['openrouter/free'],
    note: 'Hundreds of models behind one key. Free ones are listed first and cost nothing; “openrouter/free” picks one for you.',
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    kind: 'openai',
    baseUrl: 'https://api.cerebras.ai/v1',
    cost: 'free-tier',
    needsKey: true,
    keyUrl: 'https://cloud.cerebras.ai',
    models: ['gpt-oss-120b'],
    note: 'Free tier with daily token limits; extremely fast inference.',
  },
  {
    id: 'mistral',
    name: 'Mistral',
    kind: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    cost: 'free-tier',
    needsKey: true,
    keyUrl: 'https://console.mistral.ai/api-keys',
    models: ['codestral-latest', 'devstral-small-latest', 'mistral-small-latest'],
    note: 'Free “Experiment” plan. Codestral is tuned for code.',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    kind: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    cost: 'free',
    needsKey: false,
    models: ['qwen2.5-coder:7b'],
    note: 'Runs models on your own machine: free, private, offline. Install from ollama.com, then `ollama pull qwen2.5-coder:7b`.',
    local: true,
    editableUrl: true,
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    kind: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    cost: 'free',
    needsKey: false,
    models: [],
    note: 'Local models with a desktop app. Start the server and turn on “Enable CORS” in its settings.',
    local: true,
    editableUrl: true,
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    cost: 'paid',
    needsKey: true,
    keyUrl: 'https://console.anthropic.com/settings/keys',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'],
    note: 'Claude with your own key, billed to your Anthropic account.',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    cost: 'paid',
    needsKey: true,
    keyUrl: 'https://platform.openai.com/api-keys',
    models: [],
    note: 'Your own OpenAI key, billed to your account. Fetch the model list after adding a key.',
  },
  {
    id: 'custom',
    name: 'Custom (OpenAI-compatible)',
    kind: 'openai',
    baseUrl: '',
    cost: 'free',
    needsKey: false,
    models: [],
    note: 'Any server that speaks the OpenAI chat completions API and allows browser requests (vLLM, llama.cpp, LiteLLM, Jan…).',
    editableUrl: true,
  },
  {
    id: 'server',
    name: 'Studio server',
    kind: 'server',
    baseUrl: '/api/ai',
    cost: 'host',
    needsKey: false,
    models: [],
    note: 'The model configured by whoever runs this studio (ANTHROPIC_API_KEY on the server).',
  },
];

/**
 * Suggestions earlier versions of the studio shipped and saved for people.
 * They were never typed by the user, so they may be swapped when a provider drops them.
 */
const RETIRED_DEFAULTS: Record<string, string[]> = {
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'],
  groq: ['llama-3.3-70b-versatile', 'qwen/qwen3-32b'],
  openrouter: ['qwen/qwen3-coder:free', 'deepseek/deepseek-chat-v3.1:free', 'openai/gpt-oss-120b:free'],
  cerebras: ['qwen-3-coder-480b', 'llama-3.3-70b'],
  ollama: ['qwen3-coder:30b', 'gpt-oss:20b', 'llama3.2'],
};

/** Whether this model id is one the studio suggested itself (so it may be replaced), not one the user typed */
export function isBuiltInSuggestion(provider: Provider, id: string): boolean {
  return provider.models.includes(id) || (RETIRED_DEFAULTS[provider.id] ?? []).includes(id);
}

export const COST_LABEL: Record<ProviderCost, string> = {
  free: 'Free · local',
  'free-tier': 'Free tier',
  paid: 'Your key',
  host: 'Hosted',
};

export function getProvider(id: string): Provider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** What the user picked; stored only in their browser */
export interface AiConfig {
  provider: string;
  /** Selected model per provider */
  models: Record<string, string>;
  /** API keys per provider */
  keys: Record<string, string>;
  /** Base URL overrides for local/custom providers */
  baseUrls: Record<string, string>;
  /** A different provider and model for a job (the second reviewer, Ask, the worker); unset jobs use the main one */
  jobs?: Partial<Record<'reviewer' | 'ask' | 'worker', { provider: string; model: string }>>;
}

export const EMPTY_AI_CONFIG: AiConfig = { provider: '', models: {}, keys: {}, baseUrls: {} };

export interface ResolvedProvider {
  provider: Provider;
  baseUrl: string;
  apiKey: string;
  model: string;
}

function baseUrlFor(provider: Provider, config: AiConfig): string {
  return ((provider.editableUrl && config.baseUrls[provider.id]) || provider.baseUrl).replace(/\/+$/, '');
}

/** Resolve the active provider, or explain what is missing */
export function resolveProvider(config: AiConfig): ResolvedProvider | { error: string } {
  const provider = getProvider(config.provider);
  if (!provider) return { error: 'Choose a model provider to use the assistant.' };
  const baseUrl = baseUrlFor(provider, config);
  const apiKey = (config.keys[provider.id] ?? '').trim();
  const model = (config.models[provider.id] ?? provider.models[0] ?? '').trim();
  if (provider.kind === 'server') return { provider, baseUrl, apiKey: '', model: '' };
  if (!baseUrl) return { error: `Set the server URL for ${provider.name}.` };
  if (!/^https?:\/\//.test(baseUrl)) return { error: 'The server URL must start with http:// or https://' };
  if (provider.needsKey && !apiKey) return { error: `Add your ${provider.name} API key.` };
  if (!model) return { error: `Choose a ${provider.name} model.` };
  return { provider, baseUrl, apiKey, model };
}

/** The provider and model for one job: its own choice when it has one that is ready, else the main one */
export function resolveFor(config: AiConfig, job: 'agent' | 'reviewer' | 'ask' | 'worker'): ResolvedProvider | { error: string } {
  const own = job === 'agent' ? undefined : config.jobs?.[job];
  if (own?.provider) {
    const resolved = resolveProvider({ ...config, provider: own.provider, models: { ...config.models, [own.provider]: own.model || config.models[own.provider] || '' } });
    if (!('error' in resolved)) return resolved;
  }
  return resolveProvider(config);
}

/** Like resolveProvider, for reading the model list: no model needed, and some providers need no key */
export function resolveForListing(config: AiConfig): Omit<ResolvedProvider, 'model'> | { error: string } {
  const provider = getProvider(config.provider);
  if (!provider || provider.kind === 'server') return { error: 'Choose a model provider.' };
  const baseUrl = baseUrlFor(provider, config);
  const apiKey = (config.keys[provider.id] ?? '').trim();
  if (!baseUrl) return { error: `Set the server URL for ${provider.name}.` };
  if (!/^https?:\/\//.test(baseUrl)) return { error: 'The server URL must start with http:// or https://' };
  if (provider.needsKey && !apiKey && !provider.publicModelList) return { error: `Add your ${provider.name} API key to load its models.` };
  return { provider, baseUrl, apiKey };
}

/** Strip what people accidentally copy along with a key: quotes, "Bearer ", spaces, newlines */
export function sanitizeKey(raw: string): string {
  return raw
    .trim()
    .replace(/^bearer\s+/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, '');
}

const KEY_SHAPES: Record<string, { test: RegExp; hint: string }> = {
  gemini: {
    test: /^AIza[\w-]{30,}$/,
    hint: 'Gemini keys start with “AIza” and are about 39 characters. Create one at aistudio.google.com/apikey — not a Google Cloud OAuth client or service-account credential.',
  },
  groq: { test: /^gsk_/, hint: 'Groq keys start with “gsk_”.' },
  openrouter: { test: /^sk-or-/, hint: 'OpenRouter keys start with “sk-or-”.' },
  cerebras: { test: /^csk-/, hint: 'Cerebras keys start with “csk-”.' },
  anthropic: { test: /^sk-ant-/, hint: 'Anthropic keys start with “sk-ant-”.' },
  openai: { test: /^sk-/, hint: 'OpenAI keys start with “sk-”.' },
};

/** A hint when a pasted key doesn't look like one from that provider (null when fine or unknown) */
export function keyWarning(providerId: string, key: string): string | null {
  const shape = KEY_SHAPES[providerId];
  if (!shape || !key || shape.test.test(key)) return null;
  return shape.hint;
}

function headersFor(target: ResolvedProvider): Record<string, string> {
  if (target.provider.kind === 'anthropic') {
    return {
      'x-api-key': target.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
  }
  const headers: Record<string, string> = {};
  if (target.apiKey) headers.Authorization = `Bearer ${target.apiKey}`;
  if (target.provider.id === 'openrouter') headers['X-Title'] = 'NanoCLI Studio';
  return headers;
}

/** Turn an HTTP failure into something a person can act on */
export async function describeFailure(response: Response, target: ResolvedProvider, withKeyHint = true): Promise<string> {
  let detail = '';
  try {
    const data = await response.json();
    const err = Array.isArray(data) ? data[0]?.error : data?.error;
    detail = typeof err === 'string' ? err : err?.message ?? data?.message ?? '';
  } catch {
    // not JSON
  }
  const name = target.provider.name;
  if (response.status === 401 || response.status === 403 || (response.status === 400 && /api key/i.test(detail))) {
    const shape = withKeyHint ? keyWarning(target.provider.id, target.apiKey) : null;
    return `${name} rejected the API key${detail ? `: ${detail}` : '.'}${shape ? ` ${shape}` : withKeyHint ? ' Check that the key is complete and hasn’t been revoked.' : ''}`;
  }
  if (response.status === 404) return `${name} doesn't know the model “${target.model}”${detail ? `: ${detail}` : '.'} Fetch the model list in settings.`;
  if (response.status === 429) return `${name} rate limit reached${detail ? `: ${detail}` : ''}. Free tiers allow a few requests per minute — wait a moment or switch model.`;
  return `${name} returned ${response.status}${detail ? `: ${detail}` : ''}`;
}

/** Message shown when the request never reached the provider */
export function unreachableMessage(target: ResolvedProvider): string {
  if (target.provider.id === 'ollama') {
    return `Couldn't reach Ollama at ${target.baseUrl}. Make sure it is running (\`ollama serve\`). If the studio isn't on localhost, start Ollama with OLLAMA_ORIGINS set to this site's origin.`;
  }
  if (target.provider.id === 'lmstudio') {
    return `Couldn't reach LM Studio at ${target.baseUrl}. Start its local server and turn on “Enable CORS”.`;
  }
  if (target.provider.local || target.provider.id === 'custom') {
    return `Couldn't reach ${target.baseUrl}. Check that the server is running and allows requests from this page (CORS).`;
  }
  return `Couldn't reach ${target.provider.name}. Check your connection.`;
}

/**
 * Pull complete `data:` payloads out of an SSE buffer. Returns the payloads and
 * whatever trailing partial line should be kept for the next chunk.
 */
export function splitSse(buffer: string): { events: string[]; rest: string } {
  const lines = buffer.split(/\r?\n/);
  const rest = lines.pop() ?? '';
  const events: string[] = [];
  for (const line of lines) {
    if (line.startsWith('data:')) events.push(line.slice(5).trimStart());
  }
  return { events, rest };
}

export type StreamEvent = { text: string } | { stop: string } | { error: string } | null;

/** Interpret one SSE payload for a provider kind */
export function readEvent(kind: ProviderKind, payload: string): StreamEvent {
  if (!payload || payload === '[DONE]') return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(payload);
  } catch {
    return null;
  }
  if (kind === 'anthropic') {
    if (data.type === 'content_block_delta') {
      const delta = data.delta as { type?: string; text?: string };
      return delta?.type === 'text_delta' && delta.text ? { text: delta.text } : null;
    }
    if (data.type === 'message_delta') {
      const reason = (data.delta as { stop_reason?: string })?.stop_reason;
      return reason ? { stop: reason } : null;
    }
    if (data.type === 'error') return { error: (data.error as { message?: string })?.message ?? 'Stream error' };
    return null;
  }
  if (data.error) {
    const err = data.error as { message?: string } | string;
    return { error: typeof err === 'string' ? err : err.message ?? 'Stream error' };
  }
  const choice = (data.choices as { delta?: { content?: string | null }; finish_reason?: string | null }[] | undefined)?.[0];
  if (!choice) return null;
  if (choice.delta?.content) return { text: choice.delta.content };
  if (choice.finish_reason) return { stop: choice.finish_reason };
  return null;
}

/**
 * Stream an answer from the chosen provider. Yields text; throws Error with a
 * readable message on failure, or DOMException('AbortError') when cancelled.
 */
export async function* streamChat(
  target: ResolvedProvider,
  system: string,
  messages: ChatMessage[],
  signal?: AbortSignal
): AsyncGenerator<string> {
  const anthropic = target.provider.kind === 'anthropic';
  const url = anthropic ? `${target.baseUrl}/v1/messages` : `${target.baseUrl}/chat/completions`;
  const body = anthropic
    ? {
        model: target.model,
        max_tokens: 8192,
        stream: true,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages,
      }
    : {
        model: target.model,
        stream: true,
        messages: [{ role: 'system', content: system }, ...messages],
      };

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headersFor(target) },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new Error(unreachableMessage(target));
  }
  if (!response.ok || !response.body) throw new Error(await describeFailure(response, target));

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let stop = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = splitSse(buffer);
    buffer = rest;
    for (const payload of events) {
      const event = readEvent(target.provider.kind, payload);
      if (!event) continue;
      if ('error' in event) throw new Error(`${target.provider.name}: ${event.error}`);
      if ('stop' in event) stop = event.stop;
      else yield event.text;
    }
  }
  if (stop === 'max_tokens' || stop === 'length') yield '\n\n(The answer was cut off — ask the assistant to continue.)';
  else if (stop === 'refusal' || stop === 'content_filter') yield '\n\nThe model declined this request. Rephrase it or try another model.';
}

export interface ModelInfo {
  id: string;
  /** Costs nothing to call */
  free?: boolean;
  /** Context window in tokens */
  context?: number;
  /** Unix seconds */
  created?: number;
}

interface RawModel {
  id: string;
  created?: number;
  created_at?: string;
  context_length?: number;
  context_window?: number;
  max_context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { output_modalities?: string[] };
  capabilities?: { completion_chat?: boolean };
}

/** Embeddings, speech, image, moderation and similar models can't answer a chat prompt */
const NOT_CHAT = /(embed|whisper|tts|speech|transcri|audio|imagen|veo|lyria|moderation|guard|safety|rerank|dall-e|realtime|aqa|sora|ocr|image)/i;

function toInfo(raw: RawModel): ModelInfo {
  const created = typeof raw.created === 'number' ? raw.created : raw.created_at ? Math.floor(Date.parse(raw.created_at) / 1000) : undefined;
  const free = raw.id.endsWith(':free') || (raw.pricing?.prompt === '0' && raw.pricing?.completion === '0');
  return {
    // Gemini prefixes ids with "models/"
    id: raw.id.replace(/^models\//, ''),
    ...(free ? { free: true } : {}),
    context: raw.context_length ?? raw.context_window ?? raw.max_context_length,
    ...(created && Number.isFinite(created) ? { created } : {}),
  };
}

function isChat(raw: RawModel): boolean {
  if (NOT_CHAT.test(raw.id)) return false;
  if (raw.capabilities?.completion_chat === false) return false;
  const out = raw.architecture?.output_modalities;
  return !out || out.every((m) => m === 'text');
}

/**
 * Chat models only, best first: free ones, then stable "-latest" aliases, then
 * newest by release date (or by version number when the API gives no dates).
 */
export function rankModels(raw: RawModel[]): ModelInfo[] {
  const alias = (m: ModelInfo) => (/-latest$/.test(m.id) || m.id === 'openrouter/free' ? 1 : 0);
  return raw
    .filter(isChat)
    .map(toInfo)
    .filter((m, i, all) => all.findIndex((x) => x.id === m.id) === i)
    .sort(
      (a, b) =>
        Number(!!b.free) - Number(!!a.free) ||
        alias(b) - alias(a) ||
        (b.created ?? 0) - (a.created ?? 0) ||
        b.id.localeCompare(a.id, undefined, { numeric: true })
    );
}

/** The models this provider offers right now, for this key */
export async function listModels(target: Omit<ResolvedProvider, 'model'>, signal?: AbortSignal): Promise<ModelInfo[]> {
  const anthropic = target.provider.kind === 'anthropic';
  const url = anthropic ? `${target.baseUrl}/v1/models?limit=100` : `${target.baseUrl}/models`;
  const asTarget = { ...target, model: '' };
  let response: Response;
  try {
    response = await fetch(url, { headers: headersFor(asTarget), signal });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new Error(unreachableMessage(asTarget));
  }
  // The key field already shows the key-shape hint, so don't repeat it next to the list
  if (!response.ok) throw new Error(await describeFailure(response, asTarget, false));
  const data = (await response.json()) as { data?: RawModel[] };
  return rankModels(data.data ?? []);
}
