/**
 * Rewind: the run as a timeline. Every step is one line that ran; scrubbing to step k shows that line, what it
 * did, and the state at that moment — the latest value of every variable up to and including step k, and
 * where it was set. Pure: the timeline comes from the live-values tracers (steps in LiveResult).
 */

import type { LiveStep } from './shared.ts';

/** Names that are what a line did rather than variables */
const EFFECTS = new Set(['out', 'return', 'threw']);

export interface Moment {
  index: number;
  step: LiveStep;
  /** Variables at this moment: latest value, where it was set, and whether this step set it */
  state: { name: string; value: string; file: string; line: number; changed: boolean }[];
  /** What this step printed, returned or threw */
  effects: { kind: 'out' | 'return' | 'threw'; value: string }[];
  /** Everything printed up to this moment */
  printed: string[];
}

export function momentAt(steps: LiveStep[], index: number): Moment | null {
  if (!steps.length) return null;
  const k = Math.max(0, Math.min(steps.length - 1, index));
  const vars = new Map<string, { value: string; file: string; line: number; at: number }>();
  const printed: string[] = [];
  for (let i = 0; i <= k; i++) {
    const s = steps[i];
    for (const [name, value] of Object.entries(s.values ?? {})) {
      if (name === 'out') printed.push(value);
      else if (!EFFECTS.has(name)) vars.set(name, { value, file: s.file, line: s.line, at: i });
    }
  }
  const step = steps[k];
  return {
    index: k,
    step,
    state: [...vars].map(([name, v]) => ({ name, value: v.value, file: v.file, line: v.line, changed: v.at === k })).sort((a, b) => Number(b.changed) - Number(a.changed) || a.name.localeCompare(b.name)),
    effects: Object.entries(step.values ?? {})
      .filter(([n]) => EFFECTS.has(n))
      .map(([kind, value]) => ({ kind: kind as 'out' | 'return' | 'threw', value })),
    printed,
  };
}

/** The next (or previous) step where a variable changes, or a line runs: jump straight to what matters */
export function findStep(steps: LiveStep[], from: number, direction: 1 | -1, match: { name?: string; file?: string; line?: number }): number | null {
  for (let i = from + direction; i >= 0 && i < steps.length; i += direction) {
    const s = steps[i];
    if (match.name && !(s.values && match.name in s.values)) continue;
    if (match.file && s.file !== match.file) continue;
    if (match.line && s.line !== match.line) continue;
    return i;
  }
  return null;
}

/** The first step that threw, if any: where Rewind opens after a crash */
export const firstError = (steps: LiveStep[]) => {
  const i = steps.findIndex((s) => s.values && 'threw' in s.values);
  return i < 0 ? null : i;
};

/** The moment in words, for asking the assistant about it */
export function describeMoment(m: Moment, total: number, source?: string): string {
  const lineText = source?.split('\n')[m.step.line - 1]?.trim();
  const lines = [`Step ${m.index + 1} of ${total} of the run: ${m.step.file} line ${m.step.line}${lineText ? `: \`${lineText}\`` : ''}.`];
  if (m.effects.length) lines.push(...m.effects.map((e) => `This step ${e.kind === 'out' ? 'printed' : e.kind === 'return' ? 'returned' : 'threw'}: ${e.value}`));
  if (m.state.length) lines.push('Variables at this moment:', ...m.state.map((v) => `- ${v.name} = ${v.value}${v.changed ? ' (just set)' : ` (set at ${v.file}:${v.line})`}`));
  return lines.join('\n');
}
