// Verifies the stack builder for real: a matrix of choices is generated, installed (npm or uv), typechecked,
// linted, tested and built, as the project's own scripts and CI would. Needs network access to the registries.
// Usage: node --experimental-strip-types scripts/verify-stacks.ts [index…]
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildStack, DEFAULT_STACK, type StackChoice } from '../src/lib/stack/index.ts';
import { GALLERY } from '../src/lib/gallery.ts';

const web = (framework: StackChoice['framework'], styling: StackChoice['styling'], libraries: string[]): StackChoice => ({ ...DEFAULT_STACK, kind: 'web', name: `${framework}-${styling}`, framework, styling, libraries });
const py = (pyFramework: StackChoice['pyFramework'], libraries: string[]): StackChoice => ({ ...DEFAULT_STACK, kind: 'python', name: `py-${pyFramework}`, pyFramework, libraries });

export const MATRIX: StackChoice[] = [
  web('react', 'tailwind', ['shadcn', 'tanstack-query', 'tanstack-router', 'zod', 'react-hook-form', 'zustand', 'lucide', 'sonner', 'vitest', 'eslint']),
  web('react', 'css', ['mantine', 'swr', 'react-router', 'jotai', 'tanstack-form', 'recharts', 'motion', 'i18n', 'date-fns', 'vitest', 'biome']),
  web('react', 'tailwind', ['daisyui', 'tanstack-table', 'redux', 'axios', 'hono', 'drizzle', 'zod', 'vitest', 'eslint', 'prettier', 'playwright']),
  web('vue', 'tailwind', ['tanstack-query', 'vue-router', 'pinia', 'vueuse', 'tanstack-table', 'zod', 'vitest', 'eslint']),
  web('vue', 'bootstrap', ['hono', 'axios', 'date-fns']),
  web('svelte', 'sass', ['zod', 'date-fns', 'hono', 'vitest', 'eslint']),
  web('solid', 'unocss', ['tanstack-query', 'solid-router', 'vitest']),
  web('preact', 'bulma', ['hono', 'zod', 'vitest', 'eslint']),
  web('vanilla', 'pico', ['axios', 'date-fns', 'zod', 'vitest', 'biome']),
  web('react', 'css-modules', ['vitest', 'eslint']),
  web('solid', 'css', ['hono']),
  web('react', 'sass', ['motion', 'tanstack-query']),
  py('fastapi', ['pydantic', 'pydantic-settings', 'sqlmodel', 'httpx', 'pandas', 'loguru', 'dotenv', 'anthropic', 'pytest', 'ruff', 'mypy']),
  py('fastapi', ['jinja2', 'numpy', 'pytest', 'ruff']),
  py('flask', ['pydantic', 'sqlmodel', 'polars', 'pytest', 'ruff', 'mypy']),
  py('typer', ['rich', 'pandas', 'matplotlib', 'anthropic', 'pydantic', 'pytest', 'ruff', 'mypy']),
  py('script', ['numpy', 'openai', 'dotenv', 'loguru', 'sqlmodel', 'pytest', 'ruff']),
];

// The gallery's own stacks too, so every app you can pick there installs, tests and builds
for (const app of GALLERY) for (const source of [app.source, ...(app.variants ?? []).map((v) => v.source)]) if ('stack' in source && !MATRIX.some((m) => JSON.stringify(m) === JSON.stringify(source.stack))) MATRIX.push(source.stack);

const only = process.argv.slice(2).map(Number);
let failed = 0;
for (const [i, input] of MATRIX.entries()) {
  if (only.length && !only.includes(i)) continue;
  const built = buildStack(input);
  const dir = mkdtempSync(path.join(tmpdir(), `stack-${i}-`));
  for (const [p, c] of Object.entries(built.files)) {
    mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    writeFileSync(path.join(dir, p), c);
  }
  const lib = built.choice.libraries;
  const steps: [string, string][] =
    built.choice.kind === 'web'
      ? [
          ['install', 'npm install --no-audit --no-fund --loglevel=error'],
          ['typecheck', 'npm run -s typecheck'],
          ...(lib.includes('eslint') || lib.includes('biome') ? [['lint', 'npm run -s lint'] as [string, string]] : []),
          ...(lib.includes('vitest') ? [['test', 'npm test -s'] as [string, string]] : []),
          ['build', 'npm run -s build'],
        ]
      : [
          ['install', 'uv sync -q'],
          ...(lib.includes('ruff') ? [['lint', 'uv run ruff check .'] as [string, string]] : []),
          ...(lib.includes('mypy') ? [['typecheck', 'uv run mypy .'] as [string, string]] : []),
          ...(lib.includes('pytest') ? [['test', 'uv run pytest -q'] as [string, string]] : []),
          ...(built.choice.pyFramework === 'typer' ? [['run', 'uv run main.py hello --name Ada'] as [string, string]] : built.choice.pyFramework === 'script' ? [['run', 'uv run main.py'] as [string, string]] : []),
        ];
  const results: string[] = [];
  let ok = true;
  for (const [name, cmd] of steps) {
    try {
      execSync(cmd, { cwd: dir, stdio: 'pipe', timeout: 600_000, env: { ...process.env, CI: '1' } });
      results.push(`✓ ${name}`);
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer };
      results.push(`✗ ${name}`);
      console.log(`\n[${i}] ${built.summary}\n${cmd} failed:\n${String(err.stdout ?? '').slice(-3000)}${String(err.stderr ?? '').slice(-3000)}`);
      ok = false;
      break;
    }
  }
  if (!ok) failed++;
  console.log(`[${i}] ${ok ? 'PASS' : 'FAIL'} ${built.summary}\n    ${results.join(' · ')}${built.notes.length ? `\n    notes: ${built.notes.join(' ')}` : ''}`);
  if (ok) rmSync(dir, { recursive: true, force: true });
  else console.log(`    kept: ${dir}`);
}
process.exit(failed ? 1 : 0);
