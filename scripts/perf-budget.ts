// Measures what the studio costs a visitor and checks it against perf-budget.json (src/lib/perf-budget.ts decides).
//
//   npm run build && npm run perf               measure and check (exit 1 when over budget)
//   npm run perf -- --update                    measure and write today's numbers as the new baseline
//   PERF_URL=http://127.0.0.1:3000 npm run perf  measure a server that is already running
//
// Each page is loaded in a fresh browser context (nothing cached), in headless Chromium.
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { baselineFrom, checkBudget, formatReport, p95, type Budget, type Measurements, type RouteMeasure } from '../src/lib/perf-budget.ts';

const BUDGET_FILE = 'perf-budget.json';
const ROUTES = ['/', '/landing', '/docs'];
const PORT = 3123;
const update = process.argv.includes('--update');
const base = process.env.PERF_URL ?? `http://127.0.0.1:${PORT}`;

async function startServer(): Promise<ChildProcess | null> {
  if (process.env.PERF_URL) return null;
  const server = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), AHA_AUTOUPDATE: '0', AHA_AUTOREPAIR: '0' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${base}/`)).ok) return server;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  server.kill();
  throw new Error(`The server did not start on ${base} (run npm run build first)`);
}

/** A first visit: every script the page fetches until the network is idle */
async function measureRoute(browser: Browser, path: string): Promise<RouteMeasure> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const sizes: Promise<number>[] = [];
  page.on('requestfinished', (request) => {
    if (request.resourceType() !== 'script' || !request.url().startsWith(base)) return;
    sizes.push(request.sizes().then((s) => s.responseBodySize));
  });
  await page.goto(base + path, { waitUntil: 'networkidle' });
  const bytes = (await Promise.all(sizes)).reduce((a, b) => a + b, 0);
  await context.close();
  return { path, jsBytes: bytes, jsRequests: sizes.length };
}

const welcomed = () => localStorage.setItem('aha:welcomed', '1');

async function editorReady(browser: Browser): Promise<number> {
  const runs: number[] = [];
  for (let i = 0; i < 3; i++) {
    const context = await browser.newContext();
    await context.addInitScript(welcomed);
    const page = await context.newPage();
    await page.goto(`${base}/`);
    await page.locator('.monaco-editor .view-lines').first().waitFor({ state: 'visible', timeout: 60_000 });
    runs.push(await page.evaluate(() => performance.now()));
    await context.close();
  }
  return runs.sort((a, b) => a - b)[1];
}

/** A project with 20 files, all open in tabs */
function twentyFiles() {
  const files: Record<string, string> = {};
  for (let i = 1; i <= 20; i++) {
    const lines = Array.from({ length: 80 }, (_, n) => `export function f${i}_${n}(x: number): number {\n  return x * ${n} + ${i};\n}`);
    files[`src/module${i}.ts`] = lines.join('\n') + '\n';
  }
  files['src/main.ts'] = "import { f1_1 } from './module1';\nconsole.log(f1_1(2));\n";
  const tabs = Object.keys(files);
  return { project: { name: 'perf', files, folders: [], entry: 'src/main.ts' }, tabs, active: 'src/main.ts', split: null, git: null };
}

async function withTwentyFiles(browser: Browser): Promise<{ keystrokeP95Ms: number; heapMB: number }> {
  const context = await browser.newContext();
  await context.addInitScript((state) => {
    localStorage.setItem('aha:welcomed', '1');
    localStorage.setItem('aha:workspace', state);
  }, JSON.stringify(twentyFiles()));
  const page: Page = await context.newPage();
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.locator('.monaco-editor .view-lines').first().waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForTimeout(1500);

  // Keypress to next paint, from the browser's own Event Timing (it reports only events of 16 ms or more)
  await page.evaluate(() => {
    const w = window as unknown as { __slow: number[] };
    w.__slow = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.name === 'keydown') w.__slow.push(e.duration);
    }).observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit);
  });
  await page.locator('.monaco-editor').first().click();
  await page.keyboard.press('Control+End');
  const typed = 'const total = values.reduce((sum, v) => sum + v, 0);';
  await page.keyboard.type(typed, { delay: 40 });
  await page.waitForTimeout(800);
  const slow = await page.evaluate(() => (window as unknown as { __slow: number[] }).__slow);
  const keystrokeP95Ms = p95(slow, Math.max(0, typed.length - slow.length));

  const cdp = await context.newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  const heap = (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number };
  await context.close();
  return { keystrokeP95Ms, heapMB: Math.round((heap.usedSize / 1024 / 1024) * 10) / 10 };
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    const routes: RouteMeasure[] = [];
    for (const path of ROUTES) routes.push(await measureRoute(browser, path));
    const measured: Measurements = { routes, editorReadyMs: Math.round(await editorReady(browser)), ...(await withTwentyFiles(browser)) };
    writeFileSync('perf-report.json', JSON.stringify(measured, null, 2) + '\n');

    if (update) {
      writeFileSync(BUDGET_FILE, JSON.stringify(baselineFrom(measured), null, 2) + '\n');
      console.log(`Wrote ${BUDGET_FILE} from today's numbers:\n${JSON.stringify(measured, null, 2)}`);
      return 0;
    }
    const budget = JSON.parse(readFileSync(BUDGET_FILE, 'utf8')) as Budget;
    const rows = checkBudget(measured, budget);
    const report = formatReport(rows);
    console.log(report);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + '\n');
    return rows.every((r) => r.ok) ? 0 : 1;
  } finally {
    await browser.close();
    server?.kill();
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
