/**
 * A guided tour of any codebase in five stops, for someone opening it for the first time: where it starts, the file
 * everything leans on, where the work happens, why it looks the way it does (from the why-history) and how to check a
 * change. Built from the import graph (TypeScript, JavaScript and Python imports are followed) and the project's own
 * history, with no model call, so every new project gets one at once. Pure.
 */

import type { WhyEntry } from './why.ts';
import { ago } from './why.ts';

export interface TourStop {
  /** "Where it starts" */
  title: string;
  file: string;
  /** 1-based line to open at */
  line: number;
  /** A few short sentences */
  points: string[];
}

const CODE = /\.(?:[cm]?[jt]sx?|py|go|rs|rb|java|kt|cs|swift|php|c|cc|cpp|h|hpp|zig|ex|exs|dart|sol|vue|svelte|astro)$/;
const SKIP = /(^|\/)(node_modules|\.git|\.aha|agent|dist|build|out|target|\.next|\.venv|venv|__pycache__)\//;
const TEST = /(^|\/)(tests?|__tests__|spec)\/|[._-](test|spec)\.[\w]+$|(^|\/)test_[\w]+\.py$|_test\.(go|py)$/i;
const MANIFEST = /(^|\/)(package\.json|pyproject\.toml|requirements\.txt|Cargo\.toml|go\.mod|Gemfile|composer\.json|pom\.xml|build\.gradle(\.kts)?|mix\.exs|pubspec\.yaml|foundry\.toml)$/;
const README = /(^|\/)README(\.\w+)?$/i;
const JS_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];

const lines = (text: string) => text.split('\n').length;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (items: string[], max = 4) => (items.length > max ? `${items.slice(0, max).join(', ')} and ${items.length - max} more` : items.join(', '));

/** Relative imports a file makes, resolved to project files */
export function importsOf(path: string, files: Record<string, string>): string[] {
  const text = files[path] ?? '';
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const join = (base: string, rel: string) => {
    const parts = (base ? `${base}/${rel}` : rel).split('/');
    const out: string[] = [];
    for (const p of parts) {
      if (p === '..') out.pop();
      else if (p && p !== '.') out.push(p);
    }
    return out.join('/');
  };
  const found = new Set<string>();
  if (/\.[cm]?[jt]sx?$/.test(path) || /\.(vue|svelte|astro)$/.test(path)) {
    for (const m of text.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"](\.{1,2}\/[^'"]+)['"]/gm)) {
      const base = join(dir, m[1]);
      const hit = [base, ...JS_EXT.map((e) => base.replace(/\.[cm]?js$/, '') + e), ...JS_EXT.map((e) => `${base}/index${e}`)].find((c) => c in files);
      if (hit && hit !== path) found.add(hit);
    }
  } else if (path.endsWith('.py')) {
    for (const m of text.matchAll(/^\s*(?:from\s+(\.*[\w.]*)\s+import\s+([\w, ]+)|import\s+([\w.]+))/gm)) {
      const spec = m[1] ?? m[3];
      const dots = /^\.+/.exec(spec)?.[0].length ?? 0;
      const mod = spec.slice(dots).replace(/\./g, '/');
      let base = dir;
      for (let i = 1; i < dots; i++) base = base.includes('/') ? base.slice(0, base.lastIndexOf('/')) : '';
      const roots = dots ? [base] : ['', dir, 'src'];
      // "from . import cart" names modules, not attributes
      const names = mod ? [mod] : (m[2] ?? '').split(',').map((n) => n.trim()).filter(Boolean);
      for (const root of roots) {
        for (const name of names) {
          const stem = join(root, name);
          const hit = [`${stem}.py`, `${stem}/__init__.py`].find((c) => c in files);
          if (hit && hit !== path) found.add(hit);
        }
      }
    }
  }
  return [...found];
}

/** The line a stop opens at, the first top-level definition (or the top), and the names defined at top level */
export function firstDefinition(text: string): { line: number; names: string[] } {
  const names: string[] = [];
  let line = 0;
  text.split('\n').forEach((l, i) => {
    const m = /^(?:export\s+)?(?:default\s+)?(?:pub\s+)?(?:async\s+)?(?:function\*?|class|interface|enum|def|fn|func|struct|type|const|let|contract|module)\s+([A-Za-z_$][\w$]*)/.exec(l);
    if (!m) return;
    names.push(m[1]);
    if (!line) line = i + 1;
  });
  return { line: line || 1, names };
}

const describeLanguage = (path: string) => {
  const ext = path.slice(path.lastIndexOf('.') + 1);
  return ({ ts: 'TypeScript', tsx: 'TypeScript (React)', js: 'JavaScript', jsx: 'JavaScript (React)', mjs: 'JavaScript', py: 'Python', go: 'Go', rs: 'Rust', rb: 'Ruby', java: 'Java', kt: 'Kotlin', cs: 'C#', sol: 'Solidity' } as Record<string, string>)[ext];
};

export function buildTour(files: Record<string, string>, entry: string, why: WhyEntry[] = [], now = Date.now()): TourStop[] {
  const sources = Object.keys(files).filter((f) => CODE.test(f) && !SKIP.test(f)).sort();
  const code = sources.filter((f) => !TEST.test(f));
  const edges = new Map(sources.map((f) => [f, importsOf(f, files)]));
  const importedBy = new Map<string, string[]>();
  for (const [from, tos] of edges) for (const to of tos) importedBy.set(to, [...(importedBy.get(to) ?? []), from]);
  const stops: TourStop[] = [];
  const used = new Set<string>();
  const stop = (s: TourStop) => {
    stops.push(s);
    used.add(s.file);
  };

  // 1. Where it starts
  const start = entry in files ? entry : code.find((f) => /(^|\/)(main|index|app|server|cli|__main__)\.\w+$/.test(f)) ?? code[0];
  if (start) {
    const deps = edges.get(start) ?? [];
    const def = firstDefinition(files[start]);
    const language = describeLanguage(start);
    stop({
      title: 'Where it starts',
      file: start,
      line: def.line,
      points: [
        `${start} is what runs first${language ? ` (${language})` : ''}: ${plural(lines(files[start]), 'line')}.`,
        deps.length ? `It pulls in ${list(deps)}: the next stops follow those threads.` : 'It imports no other project file, so everything it does is here.',
        ...(def.names.length ? [`It defines ${list(def.names.map((n) => `\`${n}\``))}.`] : []),
      ],
    });
  }

  // 2. The file everything leans on: imported by the most others
  const hub = code.filter((f) => !used.has(f)).sort((a, b) => (importedBy.get(b)?.length ?? 0) - (importedBy.get(a)?.length ?? 0) || lines(files[b]) - lines(files[a]))[0];
  if (hub && (importedBy.get(hub)?.length ?? 0) >= 1) {
    const by = importedBy.get(hub)!;
    const def = firstDefinition(files[hub]);
    stop({
      title: 'What everything leans on',
      file: hub,
      line: def.line,
      points: [
        `${plural(by.length, 'file')} import${by.length === 1 ? 's' : ''} it: ${list(by)}. A change here reaches all of them, so read it before you change it.`,
        ...(def.names.length ? [`It provides ${list(def.names.map((n) => `\`${n}\``), 6)}.`] : []),
      ],
    });
  }

  // 3. Where the work happens: the biggest module left, preferring what the entry reaches
  const reach = new Set<string>();
  const queue = start ? [start] : [];
  while (queue.length) {
    for (const n of edges.get(queue.shift()!) ?? []) {
      if (reach.has(n)) continue;
      reach.add(n);
      queue.push(n);
    }
  }
  const work = code.filter((f) => !used.has(f)).sort((a, b) => Number(reach.has(b)) - Number(reach.has(a)) || lines(files[b]) - lines(files[a]))[0];
  if (work) {
    const def = firstDefinition(files[work]);
    stop({
      title: 'Where the work happens',
      file: work,
      line: def.line,
      points: [
        `The largest piece${reach.has(work) ? ' the entry reaches' : ''}: ${plural(lines(files[work]), 'line')}${(edges.get(work) ?? []).length ? `, using ${list(edges.get(work)!)}` : ''}.`,
        ...(def.names.length ? [`Start with ${list(def.names.map((n) => `\`${n}\``), 6)}.`] : []),
      ],
    });
  }

  // 4. Why it looks like this: the file the why-history says the most about
  const counts = new Map<string, WhyEntry[]>();
  for (const e of why) for (const f of Object.keys(e.files)) if (f in files && CODE.test(f) && !SKIP.test(f)) counts.set(f, [...(counts.get(f) ?? []), e]);
  const told = [...counts].filter(([f]) => !used.has(f) || counts.size === 1).sort((a, b) => b[1].length - a[1].length)[0];
  if (told) {
    const [file, entries] = told;
    const recent = [...entries].sort((a, b) => b.at - a.at).slice(0, 3);
    stop({
      title: 'Why it looks like this',
      file,
      line: firstDefinition(files[file]).line,
      points: [
        `${plural(entries.length, 'accepted change')} wrote lines here. The most recent reasons:`,
        ...recent.map((e) => `“${e.goal.slice(0, 120)}” (${e.origin && e.origin !== 'you' ? `${e.origin}, ` : ''}${ago(e.at, now)})`),
        'Hover a line number in the editor to see the reason for that line.',
      ],
    });
  } else {
    const manifest = Object.keys(files).find((f) => MANIFEST.test(f) && !SKIP.test(f));
    if (manifest) {
      stop({
        title: 'What it is built on',
        file: manifest,
        line: 1,
        points: [`${manifest} names the project's dependencies and how it is built.`, 'No changes have been accepted through the agent yet, so there is no why-history; once there is, this stop shows the reasons behind the code.'],
      });
    }
  }

  // 5. How to check a change
  const tests = sources.filter((f) => TEST.test(f));
  if (tests.length) {
    const first = tests.sort((a, b) => lines(files[b]) - lines(files[a]))[0];
    stop({
      title: 'How to check a change',
      file: first,
      line: firstDefinition(files[first]).line,
      points: [`${plural(tests.length, 'test file')}${tests.length > 1 ? `; the biggest is ${first}` : ''}. Run them after a change; the agent does the same before it calls a change verified.`],
    });
  } else {
    const readme = Object.keys(files).find((f) => README.test(f) && !used.has(f));
    if (readme) stop({ title: 'How to check a change', file: readme, line: 1, points: ['There are no tests yet, so the README is the guide to running it. Ask the agent to add tests for the hub file: that is where a mistake travels furthest.'] });
  }

  // Fewer than five stops (a small project): fill with the next biggest files
  for (const f of code.filter((x) => !used.has(x)).sort((a, b) => lines(files[b]) - lines(files[a]))) {
    if (stops.length >= 5) break;
    const def = firstDefinition(files[f]);
    stop({ title: 'Also worth a look', file: f, line: def.line, points: [`${plural(lines(files[f]), 'line')}${def.names.length ? ` defining ${list(def.names.map((n) => `\`${n}\``))}` : ''}.`] });
  }
  return stops.slice(0, 5);
}
