/**
 * Improving the agent's own harness, supervised. The idea is from Harness²
 * (Google Research, Apache-2.0; github.com/google-research/harness2): keep the
 * model fixed and improve what surrounds it (instructions, tool guidance,
 * skills, memory) by proposing changes, probing them on the same task, and
 * composing what worked. This is a small, native version for a coding agent:
 *
 *   propose  a model suggests K variants of the harness (plus the unchanged baseline)
 *   probe    the agent runs the task once per variant, each on its own private
 *            copy of the project, scored by things that can be checked without a
 *            reference answer: did it finish, did the build and run pass, how
 *            many failed attempts and steps it took
 *   compose  a model reads the outcomes and writes the harness to adopt, plus
 *            short lessons that cite the evidence
 *
 * Nothing is applied automatically. The result is the best variant's staged
 * changes and the harness edits, both reviewed like any other agent change.
 * Harness components here are plain text files under agent/ (instructions, tool
 * guidance, skills, lessons) and AGENTS.md: no scripts or plugins, so a
 * proposed harness can't execute anything.
 */

import { runAgent } from './loop.ts';
import { Stage } from './stage.ts';
import { workspaceTools, type AgentHost } from './tools.ts';
import { DEFAULT_BUDGET } from './types.ts';
import type { AgentEvent, AgentRun, Budget, CallModel, Tool } from './types.ts';

/** The project notes file agents are told to follow (and may propose additions to) */
export const NOTES_FILE = 'AGENTS.md';
export const HARNESS_DIR = 'agent';
export const PROMPT_FILE = `${HARNESS_DIR}/prompt.md`;
export const TOOLS_FILE = `${HARNESS_DIR}/tools.md`;
export const LESSONS_FILE = `${HARNESS_DIR}/lessons.md`;
export const SKILLS_DIR = `${HARNESS_DIR}/skills`;

const MAX_COMPONENT = 4000;
const MAX_SKILLS = 5;
const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** What the harness is made of, as the model proposes to change it */
export interface HarnessEdits {
  /** Replaces agent/prompt.md: extra instructions for this project */
  prompt?: string;
  /** Replaces agent/tools.md: how and when to use the tools here */
  tools?: string;
  /** New or replaced skills: short how-tos the agent reads when relevant */
  skills?: Record<string, string>;
  /** Added to the end of AGENTS.md */
  notes_append?: string;
}

export const isEmptyEdits = (e: HarnessEdits) => !e.prompt && !e.tools && !Object.keys(e.skills ?? {}).length && !e.notes_append;

/** The project files with the edits applied (only the harness files change) */
export function applyEdits(files: Record<string, string>, edits: HarnessEdits): Record<string, string> {
  const out = { ...files };
  if (edits.prompt) out[PROMPT_FILE] = edits.prompt.trim() + '\n';
  if (edits.tools) out[TOOLS_FILE] = edits.tools.trim() + '\n';
  for (const [name, text] of Object.entries(edits.skills ?? {})) out[`${SKILLS_DIR}/${name}.md`] = text.trim() + '\n';
  if (edits.notes_append) out[NOTES_FILE] = `${(out[NOTES_FILE] ?? '').trimEnd()}${out[NOTES_FILE] ? '\n\n' : ''}${edits.notes_append.trim()}\n`;
  return out;
}

/** Only the files an edit set touches, for staging */
export function editedFiles(files: Record<string, string>, edits: HarnessEdits): Record<string, string> {
  const after = applyEdits(files, edits);
  return Object.fromEntries(Object.entries(after).filter(([path, text]) => files[path] !== text));
}

export const isHarnessFile = (path: string) => path === NOTES_FILE || path.startsWith(`${HARNESS_DIR}/`);

/** The sections the agent's system prompt gets from the harness files */
export function harnessPrompt(files: Record<string, string>): string {
  const clip = (t: string) => (t.length > MAX_COMPONENT ? `${t.slice(0, MAX_COMPONENT)}\n… (truncated)` : t);
  const parts: string[] = [];
  if (files[PROMPT_FILE]?.trim()) parts.push(`Project instructions (${PROMPT_FILE}):\n${clip(files[PROMPT_FILE].trim())}`);
  if (files[TOOLS_FILE]?.trim()) parts.push(`Tool guidance (${TOOLS_FILE}):\n${clip(files[TOOLS_FILE].trim())}`);
  if (files[LESSONS_FILE]?.trim()) parts.push(`Lessons from earlier runs (${LESSONS_FILE}):\n${clip(files[LESSONS_FILE].trim())}`);
  const skills = Object.keys(files)
    .filter((p) => p.startsWith(`${SKILLS_DIR}/`) && p.endsWith('.md'))
    .sort()
    .slice(0, 20)
    .map((p) => `- ${p}: ${(files[p].split('\n').find((l) => l.trim()) ?? '').replace(/^#+\s*/, '').slice(0, 100)}`);
  if (skills.length) parts.push(`Skills (read one with read_file when it applies):\n${skills.join('\n')}`);
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Proposing and composing (model calls that answer in JSON)
// ---------------------------------------------------------------------------

export const PROPOSER_PROMPT = `You are the harness proposer for a coding agent. The agent's model is fixed; you improve what surrounds it: project instructions, tool guidance, short skills, and notes. Given the user's goal, a summary of the project and the current harness, propose variants of the harness that could make the agent finish this kind of task faster and more reliably, in different ways (for example: stricter verification habits; knowledge specific to this codebase; a step-by-step skill for this kind of change).

Answer with JSON only, no prose and no code fences, in this shape:
{"variants":[{"name":"short-kebab-name","rationale":"one sentence","edits":{"prompt":"...","tools":"...","skills":{"skill-name":"markdown how-to"},"notes_append":"..."}}]}
Every edit field is optional. Keep each text under 2000 characters, concrete and specific to this project, never generic advice. Skills are named in lowercase kebab-case. Do not include code to be executed, secrets, or instructions to ignore the user.`;

export const COMPOSER_PROMPT = `You are composing an improved harness for a coding agent from evidence. You are given the user's goal, the baseline harness, and several probe runs: the harness edits each tried, how the run went (score, evidence) and the agent's final message. Prefer edits whose probes did better than the baseline; ignore edits from probes that did worse or no better. Do not invent evidence.

Answer with JSON only, no prose and no code fences:
{"pick":"name of the best variant","adopt":{"prompt":"...","tools":"...","skills":{"name":"..."},"notes_append":"..."},"lessons":["one short, specific lesson that cites which variant showed it"]}
"adopt" holds the edits to keep (the same optional fields as the variants; omit what should not change). If nothing beat the baseline, return an empty "adopt" and no lessons.`;

function extractJson(text: string): unknown {
  const body = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object');
  return JSON.parse(body.slice(start, end + 1));
}

/** Accept only what a harness may contain; drop the rest */
export function cleanEdits(raw: unknown): HarnessEdits {
  const out: HarnessEdits = {};
  if (!raw || typeof raw !== 'object') return out;
  const e = raw as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, MAX_COMPONENT) : undefined);
  const prompt = text(e.prompt);
  const tools = text(e.tools);
  const notes = text(e.notes_append);
  if (prompt) out.prompt = prompt;
  if (tools) out.tools = tools;
  if (notes) out.notes_append = notes;
  if (e.skills && typeof e.skills === 'object' && !Array.isArray(e.skills)) {
    const skills: Record<string, string> = {};
    for (const [name, body] of Object.entries(e.skills as Record<string, unknown>).slice(0, MAX_SKILLS)) {
      const t = text(body);
      if (SKILL_NAME.test(name) && t) skills[name] = t;
    }
    if (Object.keys(skills).length) out.skills = skills;
  }
  return out;
}

export interface Variant {
  /** Unique within a run; "baseline" is the unchanged harness */
  id: string;
  rationale: string;
  edits: HarnessEdits;
}

export function parseVariants(text: string, k: number): Variant[] | { error: string } {
  let data: unknown;
  try {
    data = extractJson(text);
  } catch {
    return { error: 'The proposer did not answer with JSON.' };
  }
  const list = (data as { variants?: unknown }).variants;
  if (!Array.isArray(list)) return { error: 'The proposer’s answer had no variants.' };
  const seen = new Set<string>(['baseline']);
  const variants: Variant[] = [];
  for (const item of list) {
    if (variants.length >= k) break;
    if (!item || typeof item !== 'object') continue;
    const v = item as Record<string, unknown>;
    const edits = cleanEdits(v.edits);
    if (isEmptyEdits(edits)) continue;
    let id = typeof v.name === 'string' ? v.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) : '';
    if (!id || seen.has(id)) id = `variant-${variants.length + 1}`;
    seen.add(id);
    variants.push({ id, rationale: typeof v.rationale === 'string' ? v.rationale.slice(0, 300) : '', edits });
  }
  return variants.length ? variants : { error: 'The proposer suggested no usable changes.' };
}

// ---------------------------------------------------------------------------
// Scoring (signals that need no reference answer)
// ---------------------------------------------------------------------------

export interface Signals {
  finished: boolean;
  /** Result of the last build, or null if it never built */
  buildOk: boolean | null;
  runOk: boolean | null;
  failedChecks: number;
  steps: number;
  toolCalls: number;
  changedFiles: number;
}

export function signalsFrom(run: AgentRun, events: AgentEvent[], stage: Stage, harnessPaths: (p: string) => boolean = isHarnessFile): Signals {
  let buildOk: boolean | null = null;
  let runOk: boolean | null = null;
  let failedChecks = 0;
  const names = new Map<string, string>();
  for (const e of events) {
    if (e.type === 'tool') names.set(e.call.id, e.call.name);
    if (e.type !== 'result') continue;
    const name = names.get(e.call.id);
    const checks = name === 'build' || name === 'run_program' || name === 'run_code' || name === 'python';
    if (!checks) continue;
    if (!e.result.ok) failedChecks++;
    if (name === 'build') buildOk = e.result.ok;
    else runOk = e.result.ok;
  }
  const changedFiles = Object.keys(stage.changes()).filter((p) => !harnessPaths(p)).length;
  return { finished: run.reason === 'finished', buildOk, runOk, failedChecks, steps: run.steps, toolCalls: run.toolCalls, changedFiles };
}

/** A score out of 100, and the reasons for it. A heuristic: it rewards verified, efficient, finished work. */
export function scoreSignals(s: Signals, budget: Budget): { score: number; evidence: string[] } {
  const evidence: string[] = [];
  let score = 0;
  if (s.finished) {
    score += 40;
    evidence.push('finished on its own');
  } else evidence.push('did not finish within its budget');
  if (s.buildOk === true) {
    score += 25;
    evidence.push('the last build passed');
  } else if (s.buildOk === false) evidence.push('the last build failed');
  else if (s.changedFiles) {
    score -= 10;
    evidence.push('changed code without ever building it');
  }
  if (s.runOk === true) {
    score += 15;
    evidence.push('the last run passed');
  } else if (s.runOk === false) evidence.push('the last run failed');
  if (s.failedChecks) {
    score -= Math.min(20, s.failedChecks * 3);
    evidence.push(`${s.failedChecks} failed build or run attempt${s.failedChecks > 1 ? 's' : ''}`);
  }
  const efficiency = Math.max(0, 1 - s.steps / Math.max(1, budget.maxSteps));
  score += Math.round(20 * efficiency);
  evidence.push(`${s.steps} step${s.steps === 1 ? '' : 's'}, ${s.toolCalls} tool call${s.toolCalls === 1 ? '' : 's'}`);
  if (!s.changedFiles) {
    score -= 5;
    evidence.push('proposed no changes to the project');
  }
  return { score: Math.max(0, Math.min(100, score)), evidence };
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

export interface ProbeResult {
  variant: Variant;
  run: AgentRun;
  /** Everything the probe did, for evidence */
  events: AgentEvent[];
  stage: Stage;
  score: number;
  evidence: string[];
  summary: string;
}

export type HarnessEvent =
  | { type: 'notice'; text: string }
  | { type: 'proposed'; variants: Variant[] }
  | { type: 'probe-start'; id: string }
  | { type: 'probe-step'; id: string; event: AgentEvent }
  | { type: 'probe-done'; id: string; score: number; evidence: string[] }
  | { type: 'composing' }
  | { type: 'done' };

export interface HarnessLoopOptions {
  goal: string;
  files: Record<string, string>;
  /** Builds the host (builds, runs) for one probe's private stage */
  makeHost: (stage: Stage) => AgentHost;
  /** The model that runs the agent, the proposer and the composer */
  callModel: CallModel;
  system: (files: Record<string, string>) => string;
  /** How many harness variants to try besides the baseline */
  k: number;
  /** parallel: propose all variants up front. sequential: each is proposed after seeing the previous probe. */
  mode: 'parallel' | 'sequential';
  /** Budget for each probe run */
  budget?: Partial<Budget>;
  /** Probes running at once (be kind to free-tier rate limits) */
  concurrency?: number;
  extraTools?: (stage: Stage) => Tool[];
  signal?: AbortSignal;
  onEvent?: (event: HarnessEvent) => void;
}

export interface HarnessLoopResult {
  probes: ProbeResult[];
  baseline: ProbeResult;
  best: ProbeResult;
  /** Harness edits to adopt (already filtered); empty when nothing beat the baseline */
  adopt: HarnessEdits;
  lessons: string[];
  /** The best probe's staged result with the adopted harness edits applied, ready for review */
  stage: Stage;
  /** Upper bound on model calls this run could make */
  modelCalls: number;
}

/** The most model calls a run can make: proposing, composing and every step of every probe */
export function maxModelCalls(k: number, budget: Partial<Budget> = {}): number {
  const steps = { ...DEFAULT_BUDGET, ...budget }.maxSteps;
  return 2 + (k + 1) * (steps + 1);
}

const goalLine = (g: string) => g.replace(/\s+/g, ' ').slice(0, 120);

function projectSummary(files: Record<string, string>): string {
  const names = Object.keys(files).filter((p) => !isHarnessFile(p)).sort();
  const shown = names.slice(0, 40).map((p) => `${p} (${files[p].split('\n').length} lines)`);
  return `${names.length} files:\n${shown.join('\n')}${names.length > shown.length ? `\n… ${names.length - shown.length} more` : ''}`;
}

async function ask(callModel: CallModel, system: string, user: string, signal?: AbortSignal): Promise<string> {
  const turn = await callModel({ system, messages: [{ role: 'user', content: user }], tools: [], signal });
  return turn.text;
}

export async function runHarnessLoop(options: HarnessLoopOptions): Promise<HarnessLoopResult> {
  const { goal, files, callModel, k } = options;
  const emit = options.onEvent ?? (() => {});
  const budget: Partial<Budget> = { maxSteps: 12, maxToolCalls: 40, maxMillis: 4 * 60_000, maxFixAttempts: 3, ...options.budget };
  const full: Budget = { ...DEFAULT_BUDGET, ...budget };
  const probes: ProbeResult[] = [];

  const probe = async (variant: Variant): Promise<ProbeResult> => {
    emit({ type: 'probe-start', id: variant.id });
    const stage = new Stage(files);
    for (const [path, content] of Object.entries(editedFiles(files, variant.edits))) stage.write(path, content);
    const host = options.makeHost(stage);
    const events: AgentEvent[] = [];
    const run = await runAgent({
      goal,
      system: options.system(stage.files()),
      tools: [...workspaceTools(host), ...(options.extraTools?.(stage) ?? [])],
      callModel,
      budget,
      // Probes never run host commands or reach outside: nobody is there to approve them
      autoApprove: ['read', 'stage', 'build'],
      signal: options.signal,
      onEvent: (event) => {
        events.push(event);
        emit({ type: 'probe-step', id: variant.id, event });
      },
    });
    const { score, evidence } = scoreSignals(signalsFrom(run, events, stage), full);
    emit({ type: 'probe-done', id: variant.id, score, evidence });
    return { variant, run, events, stage, score, evidence, summary: run.summary.slice(0, 600) };
  };

  const baselineVariant: Variant = { id: 'baseline', rationale: 'The harness as it is now', edits: {} };
  const proposeInput = (previous: ProbeResult[], count: number) =>
    [
      `Goal: ${goal}`,
      `Project:\n${projectSummary(files)}`,
      `Current harness:\n${harnessPrompt(files) || '(none yet)'}`,
      previous.length ? `Probes so far:\n${previous.map((p) => `- ${p.variant.id}: score ${p.score} (${p.evidence.join('; ')})`).join('\n')}` : '',
      `Propose ${count} variant${count > 1 ? 's' : ''}.`,
    ]
      .filter(Boolean)
      .join('\n\n');

  const propose = async (previous: ProbeResult[], count: number): Promise<Variant[]> => {
    try {
      const parsed = parseVariants(await ask(callModel, PROPOSER_PROMPT, proposeInput(previous, count), options.signal), count);
      if ('error' in parsed) {
        emit({ type: 'notice', text: `${parsed.error} Only the baseline was tried.` });
        return [];
      }
      const taken = new Set(probes.map((p) => p.variant.id));
      return parsed.map((v) => (taken.has(v.id) ? { ...v, id: `${v.id}-${taken.size}` } : v));
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error;
      emit({ type: 'notice', text: `Could not get proposals: ${(error as Error).message}` });
      return [];
    }
  };

  const pool = async (variants: Variant[]) => {
    const concurrency = Math.max(1, options.concurrency ?? 1);
    const results: ProbeResult[] = new Array(variants.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(concurrency, variants.length) }, async () => {
        for (;;) {
          const i = next++;
          if (i >= variants.length) return;
          results[i] = await probe(variants[i]);
        }
      })
    );
    return results;
  };

  // Baseline first: it is the yardstick, and its outcome informs sequential proposals
  const baseline = await probe(baselineVariant);
  probes.push(baseline);

  if (options.mode === 'parallel') {
    const variants = await propose([baseline], k);
    emit({ type: 'proposed', variants });
    probes.push(...(await pool(variants)));
  } else {
    for (let i = 0; i < k; i++) {
      if (options.signal?.aborted) break;
      const [variant] = await propose(probes, 1);
      if (!variant) break;
      emit({ type: 'proposed', variants: [variant] });
      probes.push(await probe(variant));
    }
  }

  // Best by score; a variant must beat the baseline to replace it
  const best = probes.reduce((top, p) => (p.score > top.score ? p : top), baseline);

  emit({ type: 'composing' });
  let adopt: HarnessEdits = {};
  let lessons: string[] = [];
  if (probes.length > 1 && best !== baseline) {
    try {
      const evidence = probes
        .map((p) => `Variant "${p.variant.id}" (${p.variant.rationale || 'baseline'})\nEdits: ${isEmptyEdits(p.variant.edits) ? 'none' : JSON.stringify(p.variant.edits).slice(0, 1800)}\nScore ${p.score}: ${p.evidence.join('; ')}\nFinal message: ${p.summary}`)
        .join('\n\n');
      const text = await ask(callModel, COMPOSER_PROMPT, `Goal: ${goal}\n\nBaseline harness:\n${harnessPrompt(files) || '(none yet)'}\n\n${evidence}`, options.signal);
      const data = extractJson(text) as { adopt?: unknown; lessons?: unknown };
      adopt = cleanEdits(data.adopt);
      lessons = Array.isArray(data.lessons) ? data.lessons.filter((l): l is string => typeof l === 'string' && !!l.trim()).map((l) => l.trim().slice(0, 300)).slice(0, 5) : [];
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error;
      emit({ type: 'notice', text: 'Could not compose the harness; falling back to the best variant’s own edits.' });
      adopt = best.variant.edits;
    }
  }
  // The result for review: the best probe's project changes, plus the harness edits to adopt.
  // Harness files from the probe itself are left out; only what the composer kept is applied.
  const final = new Stage(files);
  for (const path of Object.keys(best.stage.changes())) {
    if (isHarnessFile(path)) continue;
    const content = best.stage.read(path);
    if (content === undefined) final.delete(path);
    else final.write(path, content);
  }
  for (const [path, content] of Object.entries(editedFiles(final.files(), adopt))) final.write(path, content);
  if (lessons.length) {
    const entry = lessons.map((l) => `- ${l} (goal: “${goalLine(goal)}”; best score ${best.score}, baseline ${baseline.score})`).join('\n');
    const previous = files[LESSONS_FILE]?.trimEnd();
    final.write(LESSONS_FILE, `${previous ? `${previous}\n` : '# Lessons from harness runs\n\n'}${entry}\n`);
  }
  emit({ type: 'done' });
  return { probes, baseline, best, adopt, lessons, stage: final, modelCalls: probes.reduce((n, p) => n + p.run.steps, 0) + (probes.length > 1 ? 2 : 0) };
}
