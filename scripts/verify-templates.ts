// Verifies the project templates for real: each program runs and prints the documented output, and its CI
// workflow passes when run locally (as the Pipelines tab does). Needs the toolchains and network access to the
// package registries. Usage: node --experimental-strip-types scripts/verify-templates.ts [language…]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
process.env.NANOCLI_HOME ??= mkdtempSync(path.join(tmpdir(), 'tplv-'));
const { TEMPLATES } = await import('../src/lib/templates.ts');
const { PROJECT_TEMPLATES, WORDSTATS_OUTPUT } = await import('../src/lib/project-templates.ts');
const { runLanguage } = await import('../src/lib/polyglot.ts');
const { runPipeline } = await import('../src/lib/pipelines/run.ts');
const only = process.argv.slice(2);
for (const pt of PROJECT_TEMPLATES) {
  if (only.length && !only.includes(pt.language)) continue;
  const t = TEMPLATES.find((x) => x.id === pt.id)!;
  const files = { ...t.files!, [t.filename]: t.code };
  const id = `tplverify-${pt.language}`.padEnd(8, 'x');
  let out = '';
  let ran: string;
  if (pt.language === 'python') {
    const dir = mkdtempSync(path.join(tmpdir(), 'tplpy-'));
    for (const [p, c] of Object.entries(files)) { mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); writeFileSync(path.join(dir, p), c); }
    try { out = execFileSync('uv', ['run', '--quiet', 'main.py'], { cwd: dir, encoding: 'utf8' }); ran = 'ok'; } catch (e) { out = String((e as { stdout?: string }).stdout ?? e); ran = 'failed'; }
  } else {
    const r = await runLanguage({ language: pt.language, projectId: id, entry: t.filename, args: [], files, env: {} }, { onOutput: (s, d) => { if (s !== 'info') out += d; } });
    ran = r.code === 0 ? 'ok' : `code ${r.code} ${r.error ?? ''}`;
  }
  const outputOk = WORDSTATS_OUTPUT.every((l) => out.includes(l));
  let log = '';
  const ci = await runPipeline({ projectId: `${id}-ci`, files, file: '.github/workflows/ci.yml' }, { onEvent: (e) => { if (e.t === 'out') log += e.d; } });
  const steps = ci.jobs.flatMap((j) => j.steps.map((s) => `${s.status === 'passed' ? '✓' : s.status === 'failed' ? '✗' : '–'} ${s.name}`));
  console.log(`\n== ${pt.name}: run ${ran}, output ${outputOk ? 'matches' : 'DIFFERS'} | CI ${ci.ok ? 'passed' : 'FAILED'} in ${Math.round(ci.ms / 1000)}s`);
  console.log('   ' + steps.join(' · '));
  if (!outputOk) console.log(out.slice(-600));
  if (!ci.ok) console.log(log.slice(-2500));
}
