/**
 * The model advisor: which model to use for which job, and why. The studio
 * has four jobs with different needs (an agent that edits code through many
 * tool calls, a reviewer that reads a diff once, quick questions, and a
 * worker that runs task after task in the background), and people come with
 * different priorities (the best results, nothing to pay, nothing leaving
 * the machine). For each job it recommends a provider and model, says why in
 * plain words, what it costs, whether you already have the key and where to
 * get it if not. Pure: the catalogue and the reasoning, tested directly.
 */

import { getProvider } from './ai-providers.ts';

export type JobId = 'agent' | 'reviewer' | 'ask' | 'worker' | 'complete';
export type Priority = 'best' | 'free' | 'private';

export interface Job {
  id: JobId;
  name: string;
  /** What the job does, in one line */
  does: string;
  /** What matters most when choosing its model */
  needs: string;
}

export const JOBS: Job[] = [
  { id: 'agent', name: 'Agent', does: 'Does tasks: reads your project, edits files, builds and runs them, many tool calls in a row.', needs: 'Reliable tool calling over long runs, and strong coding.' },
  { id: 'reviewer', name: 'Second reviewer', does: 'Reads each finished proposal once and lists what it would fix.', needs: 'Careful reading of a diff; a different model from the agent catches different mistakes.' },
  { id: 'ask', name: 'Ask', does: 'Answers questions and explains code; changes nothing.', needs: 'Speed and low cost; it is a conversation.' },
  { id: 'complete', name: 'Autocomplete', does: 'Suggests the rest of the line (or the next few) as you type; Tab accepts.', needs: 'Speed above all: an answer in well under a second, many times a minute, so the smallest fast model.' },
  { id: 'worker', name: 'Worker', does: 'Keeps going in the background: fixes, TODOs, tests, one task after another.', needs: 'Low cost per task, since it runs many; still good tool calling.' },
];

export const PRIORITIES: { id: Priority; label: string; detail: string }[] = [
  { id: 'best', label: 'Best results', detail: 'The strongest models for each job, paid with your own key.' },
  { id: 'free', label: 'Free', detail: 'Free tiers: no card needed, with per-minute or daily limits.' },
  { id: 'private', label: 'Private', detail: 'Models on your own machine: nothing leaves it, works offline, slower and weaker.' },
];

interface Choice {
  provider: string;
  model: string;
  why: string;
  cost: string;
}

/** The catalogue: for each priority and job, the first choice and alternatives, best first */
const CHOICES: Record<Priority, Record<JobId, Choice[]>> = {
  best: {
    agent: [
      { provider: 'anthropic', model: 'claude-opus-5-5', why: 'Claude Opus 5.5 is the strongest at long, tool-heavy coding runs: it plans, keeps the thread over dozens of edits and checks its own work.', cost: '$4 in / $20 out per million tokens; a typical task costs cents.' },
      { provider: 'openai', model: '', why: 'An OpenAI key works too if that is the account you have; pick its strongest coding model from the list.', cost: 'Billed to your OpenAI account.' },
      { provider: 'gemini', model: 'gemini-pro-latest', why: 'Gemini Pro is strong at code and tool use, and has a free tier to start on.', cost: 'Free tier, then pay as you go.' },
    ],
    reviewer: [
      { provider: 'gemini', model: 'gemini-pro-latest', why: 'A second opinion is most useful from a different model family than the agent: it has different blind spots. Gemini Pro reads diffs carefully and is free to start.', cost: 'Free tier, then pay as you go.' },
      { provider: 'anthropic', model: 'claude-sonnet-5-5', why: 'Claude Sonnet 5.5 reviews well at half the price of Opus; a review is one call per proposal.', cost: '$2 in / $10 out per million tokens.' },
    ],
    ask: [
      { provider: 'anthropic', model: 'claude-haiku-5-5', why: 'Claude Haiku 5.5 answers in a second or two and costs almost nothing, and it knows code well.', cost: '$0.10 in / $0.50 out per million tokens.' },
      { provider: 'groq', model: 'openai/gpt-oss-120b', why: 'Groq runs open models extremely fast, and its free tier covers everyday questions.', cost: 'Free tier.' },
    ],
    complete: [
      { provider: 'anthropic', model: 'claude-haiku-5-5', why: 'Claude Haiku 5.5 answers fast and costs almost nothing per suggestion, and it matches your code style well; the same key as the agent.', cost: '$0.10 in / $0.50 out per million tokens.' },
      { provider: 'groq', model: 'openai/gpt-oss-20b', why: 'Groq answers in a few hundred milliseconds, which is what grey-text suggestions need, and its free tier covers a day of typing.', cost: 'Free tier.' },
      { provider: 'gemini', model: 'gemini-flash-lite-latest', why: 'Gemini Flash-Lite is quick and has a free tier.', cost: 'Free tier.' },
    ],
    worker: [
      { provider: 'anthropic', model: 'claude-sonnet-5-5', why: 'The worker runs many tasks unattended, so cost per task matters; Claude Sonnet 5.5 keeps strong tool calling at half the price of Opus.', cost: '$2 in / $10 out per million tokens.' },
      { provider: 'gemini', model: 'gemini-flash-latest', why: 'Gemini Flash is fast and cheap with good tool calling.', cost: 'Free tier, then low prices.' },
    ],
  },
  free: {
    agent: [
      { provider: 'gemini', model: 'gemini-flash-latest', why: 'The most capable free option for an agent: Gemini Flash calls tools reliably and its free tier needs only a Google account.', cost: 'Free; a few requests per minute.' },
      { provider: 'mistral', model: 'devstral-small-latest', why: 'Devstral is built for coding agents, and Mistral’s Experiment plan is free.', cost: 'Free with limits.' },
      { provider: 'openrouter', model: 'openrouter/free', why: 'One key for many free models; OpenRouter picks an available one.', cost: 'Free models cost nothing; limits vary.' },
    ],
    reviewer: [
      { provider: 'groq', model: 'openai/gpt-oss-120b', why: 'A different model from the agent (Gemini) gives a real second opinion, and Groq’s free tier is fast enough to review as soon as the agent finishes.', cost: 'Free; per-minute limits.' },
      { provider: 'cerebras', model: 'gpt-oss-120b', why: 'Very fast free inference with daily limits, good for one review per proposal.', cost: 'Free; daily token limits.' },
    ],
    ask: [
      { provider: 'groq', model: 'openai/gpt-oss-20b', why: 'Answers almost instantly; a smaller model is plenty for questions and keeps you well inside the free limits.', cost: 'Free; per-minute limits.' },
      { provider: 'gemini', model: 'gemini-flash-lite-latest', why: 'Fast and light, on the same free Google account.', cost: 'Free.' },
    ],
    complete: [
      { provider: 'groq', model: 'openai/gpt-oss-20b', why: 'The fastest free option: suggestions appear while you are still looking at the line.', cost: 'Free; per-minute limits.' },
      { provider: 'gemini', model: 'gemini-flash-lite-latest', why: 'Fast and light on a free Google account.', cost: 'Free.' },
    ],
    worker: [
      { provider: 'cerebras', model: 'gpt-oss-120b', why: 'The worker would use up the agent’s free limits; Cerebras has its own generous daily allowance and is very fast.', cost: 'Free; daily token limits.' },
      { provider: 'gemini', model: 'gemini-flash-lite-latest', why: 'Lighter than Flash, so its free limits stretch across more tasks.', cost: 'Free.' },
    ],
  },
  private: {
    agent: [
      { provider: 'ollama', model: 'qwen2.5-coder:7b', why: 'Runs on your machine through Ollama: free, private and offline. A 7B coder handles small, well-described tasks; give it one step at a time.', cost: 'Free; uses your CPU/GPU (8 GB+ RAM).' },
      { provider: 'lmstudio', model: '', why: 'LM Studio is a desktop app for the same thing, if you prefer a window to a command line.', cost: 'Free.' },
    ],
    reviewer: [{ provider: 'ollama', model: 'qwen2.5-coder:7b', why: 'The same local model reviews the diff; it never leaves your machine.', cost: 'Free.' }],
    ask: [{ provider: 'ollama', model: 'qwen2.5-coder:7b', why: 'Local answers with no network round trip.', cost: 'Free.' }],
    complete: [{ provider: 'ollama', model: 'qwen2.5-coder:1.5b', why: 'A small local coder model answers fast enough for suggestions on most laptops; nothing leaves your machine.', cost: 'Free; uses your machine.' }],
    worker: [{ provider: 'ollama', model: 'qwen2.5-coder:7b', why: 'A local worker costs nothing per task; keep it on Suggest so it doesn’t keep your machine busy.', cost: 'Free; uses your machine.' }],
  },
};

export interface Advice {
  job: Job;
  provider: string;
  providerName: string;
  model: string;
  why: string;
  cost: string;
  /** You already have what this needs (a key, or a local provider) */
  ready: boolean;
  /** Where to get the key, when one is needed and missing */
  keyUrl?: string;
  /** A first choice that needs a key you don't have, when this advice is the next-best that you can use now */
  better?: { providerName: string; model: string; why: string; keyUrl?: string };
}

const usable = (provider: string, keys: Record<string, string>) => {
  const p = getProvider(provider);
  return !!p && (!p.needsKey || !!keys[provider]?.trim());
};

/**
 * What to use for each job. When you already have a key for one of the good choices, that one is
 * recommended now and the first choice is named as the upgrade; otherwise the first choice, with
 * where to get its key.
 */
export function advise(priority: Priority, keys: Record<string, string>): Advice[] {
  let agentProvider = '';
  return JOBS.map((job) => {
    const choices = CHOICES[priority][job.id];
    const first = choices[0];
    // The reviewer is worth most from a different family than the agent: prefer one you can use that differs
    const usableChoices = choices.filter((c) => usable(c.provider, keys));
    const ready = job.id === 'reviewer' ? (usableChoices.find((c) => c.provider !== agentProvider) ?? usableChoices[0]) : usableChoices[0];
    const pick = ready ?? first;
    if (job.id === 'agent') agentProvider = pick.provider;
    const sameAsAgent = job.id === 'reviewer' && !!ready && pick.provider === agentProvider && priority !== 'private';
    const provider = getProvider(pick.provider)!;
    const advice: Advice = {
      job,
      provider: pick.provider,
      providerName: provider.name,
      model: pick.model || provider.models[0] || '',
      why: sameAsAgent ? `For now the same model as the agent, which still catches mistakes on a second, cold read. A key from another provider would give a real second opinion: different models have different blind spots.` : pick.why,
      cost: pick.cost,
      ready: !!ready,
      ...(!ready && provider.needsKey && provider.keyUrl ? { keyUrl: provider.keyUrl } : {}),
    };
    if (ready && ready !== first) {
      const best = getProvider(first.provider)!;
      advice.better = { providerName: best.name, model: first.model, why: first.why, ...(best.keyUrl ? { keyUrl: best.keyUrl } : {}) };
    }
    return advice;
  });
}

/** The keys a priority asks for that you don't have yet, each once, in the order the jobs need them */
export function keysToGet(advice: Advice[]): { provider: string; providerName: string; keyUrl: string; jobs: string[] }[] {
  const out: { provider: string; providerName: string; keyUrl: string; jobs: string[] }[] = [];
  for (const a of advice) {
    if (a.ready || !a.keyUrl) continue;
    const existing = out.find((k) => k.provider === a.provider);
    if (existing) existing.jobs.push(a.job.name);
    else out.push({ provider: a.provider, providerName: a.providerName, keyUrl: a.keyUrl, jobs: [a.job.name] });
  }
  return out;
}
