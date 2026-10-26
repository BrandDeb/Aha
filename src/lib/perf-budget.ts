/**
 * The performance budget: what the studio may cost a visitor, checked on every pull request (scripts/perf-budget.ts
 * measures, this decides). Sizes are compared against the committed baseline with a small headroom, timings with a
 * larger one because CI machines vary from run to run.
 */

export interface RouteMeasure {
  path: string;
  /** JavaScript transferred on first load, compressed, in bytes */
  jsBytes: number;
  /** Script requests on first load */
  jsRequests: number;
}

export interface Measurements {
  routes: RouteMeasure[];
  /** From navigation to an editor you can type in, in ms */
  editorReadyMs: number;
  /** 95th percentile of keypress-to-paint with 20 files open, in ms */
  keystrokeP95Ms: number;
  /** JavaScript heap after opening 20 files and collecting garbage, in MB */
  heapMB: number;
}

export interface Budget {
  /** Allowed growth over the baseline: sizes and counts, and timings */
  headroom: { size: number; time: number };
  baseline: Measurements;
}

export interface BudgetRow {
  metric: string;
  value: number;
  limit: number;
  unit: 'KB' | 'requests' | 'ms' | 'MB';
  ok: boolean;
}

const kb = (bytes: number) => Math.round(bytes / 102.4) / 10;
const limit = (base: number, headroom: number) => base * (1 + headroom);

/** Every measured number against its limit; a route or metric missing from the baseline is not judged */
export function checkBudget(measured: Measurements, budget: Budget): BudgetRow[] {
  const { size, time } = budget.headroom;
  const rows: BudgetRow[] = [];
  for (const route of measured.routes) {
    const base = budget.baseline.routes.find((r) => r.path === route.path);
    if (!base) continue;
    rows.push({ metric: `${route.path} JavaScript`, value: kb(route.jsBytes), limit: kb(limit(base.jsBytes, size)), unit: 'KB', ok: route.jsBytes <= limit(base.jsBytes, size) });
    // Counts are small; allow at least one more request so a single new chunk does not fail the build on its own
    const maxRequests = Math.max(Math.floor(limit(base.jsRequests, size)), base.jsRequests + 1);
    rows.push({ metric: `${route.path} script requests`, value: route.jsRequests, limit: maxRequests, unit: 'requests', ok: route.jsRequests <= maxRequests });
  }
  const timed: [string, keyof Measurements, BudgetRow['unit'], number][] = [
    ['Editor ready', 'editorReadyMs', 'ms', time],
    ['Keystroke p95 (20 files open)', 'keystrokeP95Ms', 'ms', time],
    ['Heap after 20 files', 'heapMB', 'MB', size],
  ];
  for (const [metric, key, unit, headroom] of timed) {
    const value = measured[key] as number;
    const base = budget.baseline[key] as number;
    if (!(base > 0)) continue;
    const max = limit(base, headroom);
    rows.push({ metric, value: Math.round(value * 10) / 10, limit: Math.round(max * 10) / 10, unit, ok: value <= max });
  }
  return rows;
}

/** The report for the CI job summary and the terminal */
export function formatReport(rows: BudgetRow[]): string {
  const failed = rows.filter((r) => !r.ok);
  const head = failed.length ? `### Performance budget: ${failed.length} over` : '### Performance budget: within budget';
  const table = ['| Metric | Measured | Limit | |', '|---|---:|---:|---|', ...rows.map((r) => `| ${r.metric} | ${r.value} ${r.unit} | ${r.limit} ${r.unit} | ${r.ok ? 'ok' : '**over**'} |`)];
  const help = failed.length
    ? ['', 'If the growth is intended, update the baseline with `npm run perf -- --update` and commit `perf-budget.json`, saying why in the pull request.']
    : [];
  return [head, '', ...table, ...help].join('\n');
}

/** Today's numbers as the new baseline */
export function baselineFrom(measured: Measurements, headroom: Budget['headroom'] = { size: 0.05, time: 0.5 }): Budget {
  return { headroom, baseline: measured };
}

/** The 95th percentile; events the browser did not report (faster than its threshold) count as that threshold */
export function p95(samples: number[], unreported = 0, floor = 16): number {
  const all = [...samples, ...Array.from({ length: unreported }, () => floor)].sort((a, b) => a - b);
  if (!all.length) return 0;
  return all[Math.min(all.length - 1, Math.ceil(all.length * 0.95) - 1)];
}
