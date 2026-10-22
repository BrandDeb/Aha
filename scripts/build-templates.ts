/**
 * Compile every studio template with scriptc.
 *
 *   npm run templates:build            # native executables in dist/templates
 *   npm run templates:build -- --wasm  # also WASI modules (uses the bundled zig, or one on PATH);
 *                                      # templates that use sockets are native-only
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { TEMPLATES, templateFiles } from '../src/lib/templates.ts';
import { withBundledZig } from '../src/lib/zig.ts';

const outDir = path.join(process.cwd(), 'dist', 'templates');
const srcDir = path.join(outDir, 'src');
const scriptc = path.join(process.cwd(), 'node_modules', '.bin', 'scriptc');
const wasm = process.argv.includes('--wasm');

mkdirSync(srcDir, { recursive: true });

let failed = 0;
// Python templates are run with uv, not compiled
for (const template of TEMPLATES.filter((t) => (t.language ?? 'typescript') === 'typescript')) {
  const { files, entry } = templateFiles(template);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(srcDir, template.id, file)), { recursive: true });
    writeFileSync(path.join(srcDir, template.id, file), content);
  }
  const source = path.join(srcDir, template.id, entry);
  const profile = path.join(srcDir, template.id, 'src', 'scriptc.profile.json');

  // Libraries are built from their profile: a static archive, and a WASM reactor
  const libraryArgs = (out: string) => ['build', '--lib', '--profile', profile, '-o', out];
  const targets: { label: string; out: string; env?: Record<string, string>; args?: string[] }[] = template.library ? [
    { label: 'lib', out: path.join(outDir, `${template.id}.a`), args: libraryArgs(path.join(outDir, `${template.id}.a`)) },
    ...(wasm ? [{ label: 'reactor', out: path.join(outDir, `${template.id}.reactor.wasm`), env: { SCRIPTC_TARGET: 'wasm32-wasi' }, args: libraryArgs(path.join(outDir, `${template.id}.reactor.wasm`)) }] : []),
  ] : [
    { label: 'native', out: path.join(outDir, template.id) },
  ];
  if (wasm && template.network) {
    console.log(`- ${template.name.padEnd(22)} wasm   skipped: uses sockets, which WASI Preview 1 lacks`);
  } else if (wasm && !template.library) {
    targets.push({ label: 'wasm', out: path.join(outDir, `${template.id}.wasm`), env: { SCRIPTC_TARGET: 'wasm32-wasi' } });
  }

  for (const target of targets) {
    try {
      execFileSync(scriptc, target.args ?? ['build', source, '-o', target.out, '--strip'], {
        stdio: 'pipe',
        env: withBundledZig({ ...process.env, ...target.env }),
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
