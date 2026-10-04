/**
 * Compile every studio template with scriptc.
 *
 *   npm run templates:build            # native executables in dist/templates
 *   npm run templates:build -- --wasm  # also WASI modules (needs zig on PATH)
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { TEMPLATES } from '../src/lib/templates.ts';

const outDir = path.join(process.cwd(), 'dist', 'templates');
const srcDir = path.join(outDir, 'src');
const scriptc = path.join(process.cwd(), 'node_modules', '.bin', 'scriptc');
const wasm = process.argv.includes('--wasm');

mkdirSync(srcDir, { recursive: true });

let failed = 0;
for (const template of TEMPLATES) {
  const source = path.join(srcDir, template.filename);
  writeFileSync(source, template.code);

  const targets: { label: string; out: string; env?: Record<string, string> }[] = [
    { label: 'native', out: path.join(outDir, template.id) },
  ];
  if (wasm) {
    targets.push({ label: 'wasm', out: path.join(outDir, `${template.id}.wasm`), env: { SCRIPTC_TARGET: 'wasm32-wasi' } });
  }

  for (const target of targets) {
    try {
      execFileSync(scriptc, ['build', source, '-o', target.out, '--strip'], {
        stdio: 'pipe',
        env: { ...process.env, ...target.env },
      });
      const kb = (statSync(target.out).size / 1024).toFixed(1);
      console.log(`✓ ${template.name.padEnd(22)} ${target.label.padEnd(6)} ${kb} KB`);
    } catch (error) {
      failed++;
      const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? String(error);
      console.error(`✗ ${template.name} (${target.label})\n${stderr}`);
    }
  }
}

process.exit(failed ? 1 : 0);
