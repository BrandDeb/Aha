/**
 * The design pass: one click on the preview measures the page as it renders (the font sizes and spacing in use,
 * the contrast of every piece of text against what is behind it, lists that render empty) and reads the source for
 * data that loads with no loading state and lists with no empty state. The findings become a brief for the agent,
 * whose proposal carries a screenshot from before and one of its own version after. The probe that runs inside the
 * app's page is in design-probe.ts; everything here is pure.
 */

export interface DesignReport {
  /** font size in px → how many text elements use it */
  fontSizes: Record<string, number>;
  /** margin, padding and gap values in px → how many times */
  spacing: Record<string, number>;
  contrast: { text: string; label: string; src: string | null; fg: string; bg: string; ratio: number; large: boolean }[];
  /** Lists and tables that render with nothing in them */
  empty: string[];
  width: number;
  height: number;
  elements: number;
}

export type DesignKind = 'type' | 'spacing' | 'contrast' | 'empty' | 'loading';

export interface DesignFinding {
  kind: DesignKind;
  title: string;
  detail: string;
}

/** How a report compares with another: for the before/after line on the proposal */
export interface DesignScore {
  fontSizes: number;
  offGridSpacing: number;
  contrastFailures: number;
  emptyLists: number;
}

const num = (s: string) => Number(s);
const sortedKeys = (o: Record<string, number>) => Object.keys(o).map(num).filter(Number.isFinite).sort((a, b) => a - b);
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Spacing worth flagging: not on a 4 px grid (hairlines of 1–2 px are borders' business, not spacing's) */
export const offGrid = (spacing: Record<string, number>) => sortedKeys(spacing).filter((v) => v > 2 && v % 4 !== 0);

export function scoreOf(report: DesignReport): DesignScore {
  return { fontSizes: sortedKeys(report.fontSizes).length, offGridSpacing: offGrid(report.spacing).length, contrastFailures: report.contrast.length, emptyLists: report.empty.length };
}

const UI_FILE = /\.(?:[jt]sx|vue|svelte|astro|html)$/;
const LOADS = /\bfetch\s*\(|\baxios\b|\buseQuery\s*\(|\buseSWR\s*\(|\bcreateResource\s*\(|\$fetch\s*\(/;
const LOADING_STATE = /\b(loading|isLoading|isPending|pending|skeleton|spinner|Suspense|fallback)\b/i;
const LIST = /\.map\s*\(|v-for=|\{#each\b|\bFor\s+each=/;
const EMPTY_STATE = /\.length\s*(===?|!==?|>|<)|\.length\s*\?|!\w+\.length|\bno \w+ (yet|found)|\bnothing (here|yet)\b|\bempty\b|\{:else\}|v-else/i;

/** What the source says about states the screen can't show right now */
export function stateFindings(files: Record<string, string>): DesignFinding[] {
  const ui = Object.entries(files).filter(([p]) => UI_FILE.test(p) && !/(^|\/)(node_modules|dist|\.aha)\//.test(p));
  const noLoading = ui.filter(([, t]) => LOADS.test(t) && !LOADING_STATE.test(t)).map(([p]) => p);
  const noEmpty = ui.filter(([, t]) => LIST.test(t) && !EMPTY_STATE.test(t)).map(([p]) => p);
  const out: DesignFinding[] = [];
  if (noLoading.length) out.push({ kind: 'loading', title: 'No loading state', detail: `${noLoading.join(', ')} load${noLoading.length === 1 ? 's' : ''} data with nothing on screen meanwhile: show a skeleton or a short "Loading…" where the content will be, and a message if it fails.` });
  if (noEmpty.length) out.push({ kind: 'empty', title: 'No empty state', detail: `${noEmpty.join(', ')} render${noEmpty.length === 1 ? 's' : ''} a list with nothing for when it has no items: say what would be here and how to add the first one.` });
  return out;
}

export function analyzeDesign(report: DesignReport, files: Record<string, string>): DesignFinding[] {
  const out: DesignFinding[] = [];
  const sizes = sortedKeys(report.fontSizes);
  const near = sizes.filter((s, i) => i > 0 && s - sizes[i - 1] < 2 && s - sizes[i - 1] > 0);
  if (sizes.length > 6 || near.length) {
    out.push({
      kind: 'type',
      title: `${sizes.length} font sizes`,
      detail: `Text uses ${sizes.map((s) => `${fmt(s)}px`).join(', ')}${near.length ? `; ${near.map((s) => `${fmt(s)}px`).join(', ')} ${near.length === 1 ? 'is' : 'are'} within 2px of the size below, which reads as a mistake rather than a step` : ''}. Settle on a scale of five or six steps (for example 12, 14, 16, 20, 24, 32) and map every size to its nearest step.`,
    });
  }
  const off = offGrid(report.spacing);
  const distinct = sortedKeys(report.spacing).filter((v) => v > 2);
  if (off.length || distinct.length > 10) {
    out.push({
      kind: 'spacing',
      title: off.length ? `${off.length} spacing value${off.length === 1 ? '' : 's'} off the 4px grid` : `${distinct.length} different spacing values`,
      detail: `Margins, padding and gaps use ${distinct.map((v) => `${fmt(v)}px`).join(', ')}${off.length ? `; ${off.map((v) => `${fmt(v)}px`).join(', ')} ${off.length === 1 ? 'is' : 'are'} off a 4px grid` : ''}. Use one spacing scale (4, 8, 12, 16, 24, 32, 48) so related things sit closer than unrelated ones.`,
    });
  }
  for (const c of report.contrast.slice(0, 12)) {
    out.push({
      kind: 'contrast',
      title: `Low contrast: ${c.ratio.toFixed(1)}:1`,
      detail: `“${c.text}” (${c.label}${c.src ? `, ${c.src}` : ''}) is ${c.fg} on ${c.bg}: ${c.ratio.toFixed(2)}:1, under the ${c.large ? '3' : '4.5'}:1 that ${c.large ? 'large ' : ''}text needs (WCAG AA). Darken the text or lighten what is behind it.`,
    });
  }
  if (report.empty.length) out.push({ kind: 'empty', title: 'Renders an empty list', detail: `${report.empty.slice(0, 5).join(', ')} ${report.empty.length === 1 ? 'is' : 'are'} on screen with nothing in ${report.empty.length === 1 ? 'it' : 'them'}: show an empty state instead of a blank space.` });
  out.push(...stateFindings(files).filter((f) => !(f.kind === 'empty' && report.empty.length)));
  return out;
}

/** The agent's task */
export function designBrief(findings: DesignFinding[], score: DesignScore): string {
  return [
    'Design pass on this web app. A screenshot of the page as it renders now is attached. Polish it without changing what it does or says:',
    findings.map((f, i) => `${i + 1}. ${f.title}. ${f.detail}`).join('\n'),
    'Rules: keep the layout, content and behaviour; fix only what is listed (spacing scale, type scale, contrast, empty and loading states). Change the styles where they are defined (the CSS, the Tailwind classes, the style objects) rather than adding overrides on top. Add no dependencies. Build afterwards to check it still compiles.',
    `Measured now: ${score.fontSizes} font sizes, ${score.offGridSpacing} spacing values off the 4px grid, ${score.contrastFailures} text elements with too little contrast, ${score.emptyLists} empty lists on screen. Finish with what you changed for each numbered item.`,
  ].join('\n\n');
}

/** "Contrast failures 5 → 0" lines, for before and after */
export function compareScores(before: DesignScore, after: DesignScore): string[] {
  const rows: [string, number, number][] = [
    ['font sizes', before.fontSizes, after.fontSizes],
    ['spacing values off the grid', before.offGridSpacing, after.offGridSpacing],
    ['contrast failures', before.contrastFailures, after.contrastFailures],
    ['empty lists on screen', before.emptyLists, after.emptyLists],
  ];
  return rows.filter(([, a, b]) => a || b).map(([label, a, b]) => `${label}: ${a} → ${b}`);
}

/** Check what came back from the page before trusting it */
export function parseReport(raw: unknown): DesignReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const counts = (v: unknown) => Object.fromEntries(Object.entries(v && typeof v === 'object' ? (v as Record<string, unknown>) : {}).filter(([k, n]) => Number.isFinite(Number(k)) && typeof n === 'number').slice(0, 200)) as Record<string, number>;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
  const contrast = (Array.isArray(r.contrast) ? r.contrast : []).slice(0, 40).flatMap((c) => {
    const x = c as Record<string, unknown>;
    return typeof x.ratio === 'number' ? [{ text: str(x.text, 60), label: str(x.label, 60), src: str(x.src, 300) || null, fg: str(x.fg, 30), bg: str(x.bg, 30), ratio: x.ratio, large: x.large === true }] : [];
  });
  return {
    fontSizes: counts(r.fontSizes),
    spacing: counts(r.spacing),
    contrast,
    empty: (Array.isArray(r.empty) ? r.empty : []).slice(0, 20).map((e) => str(e, 80)),
    width: Number(r.width) || 0,
    height: Number(r.height) || 0,
    elements: Number(r.elements) || 0,
  };
}
