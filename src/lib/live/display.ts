/**
 * How live values read in the editor: one short line after the code
 * (`sum = 3, 7, 12 ×3`), a longer hover, and which lines never ran. Pure, so
 * the editor and the tests share it.
 */

import type { LiveLine, LiveResult } from './shared.ts';

type Value = LiveLine['values'][string];

const MAX_INLINE = 110;

/** 3, 7, … 12: the first few values and the last, so a loop reads as a sequence */
function sequence(v: Value): string {
  if (v.n === 1) return v.last;
  const shown = v.first.slice(0, 3);
  const more = v.n > shown.length;
  return more ? `${shown.join(', ')}, … ${v.last}` : shown.join(', ');
}

export interface LineView {
  line: number;
  /** After the code: values, what it printed, an error */
  text: string;
  kind: 'value' | 'threw';
  hover: string;
}

/** What to show on each line of one file, plus the lines that hold code that never ran */
export function liveView(file: LiveResult['files'][string] | undefined): { lines: LineView[]; unrun: number[] } {
  if (!file) return { lines: [], unrun: [] };
  const lines: LineView[] = [];
  for (const [key, data] of Object.entries(file.lines)) {
    const line = Number(key);
    const parts: string[] = [];
    const hover: string[] = [];
    const { threw, out, return: returned, ...named } = data.values;
    for (const [name, v] of Object.entries(named)) {
      parts.push(`${name} = ${sequence(v)}`);
      hover.push(`\`${name}\` ${v.n > 1 ? `(${v.n} times)` : ''}\n\n${[...v.first, ...(v.n > v.first.length ? ['…', v.last] : [])].map((x) => `- \`${x}\``).join('\n')}`);
    }
    if (returned) {
      parts.push(`↩ ${sequence(returned)}`);
      hover.push(`returned ${returned.n > 1 ? `(${returned.n} times)` : ''}\n\n${returned.first.map((x) => `- \`${x}\``).join('\n')}${returned.n > returned.first.length ? `\n- …\n- \`${returned.last}\`` : ''}`);
    }
    if (out) {
      parts.push(`→ ${out.n === 1 ? out.last : `${out.first[0]} … ${out.last}`}`);
      hover.push(`printed\n\n\`\`\`\n${[...out.first, ...(out.n > out.first.length ? ['…', out.last] : [])].join('\n')}\n\`\`\``);
    }
    if (data.hits > 1) parts.push(`×${data.hits}`);
    let text = parts.join('   ');
    if (text.length > MAX_INLINE) text = `${text.slice(0, MAX_INLINE - 1)}…`;
    if (threw) {
      lines.push({ line, text: `✕ ${threw.last}${text ? `   ${text}` : ''}`, kind: 'threw', hover: [`**Threw** \`${threw.last}\``, ...hover].join('\n\n---\n\n') });
      continue;
    }
    if (!text) continue;
    lines.push({ line, text, kind: 'value', hover: [`Ran ${data.hits === 1 ? 'once' : `${data.hits} times`}`, ...hover].join('\n\n---\n\n') });
  }
  const unrun = file.statementLines.filter((l) => !(l in file.lines));
  return { lines: lines.sort((a, b) => a.line - b.line), unrun };
}

/** One line for the toolbar: how the last live run went */
export function liveSummary(result: LiveResult | null): string {
  if (!result) return 'Values from your last run show here';
  if (result.error && !result.truncated) return result.error;
  const time = result.ms < 1000 ? `${result.ms} ms` : `${(result.ms / 1000).toFixed(1)} s`;
  if (result.truncated) return `Ran for ${time}: showing the start of the run`;
  return result.ok ? `Ran in ${time}` : `Exited with ${result.code ?? 'an error'} after ${time}`;
}
