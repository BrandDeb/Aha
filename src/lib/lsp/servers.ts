/**
 * The language servers the studio can start, and how it finds or installs each one. A server already on the PATH
 * is used as it is; otherwise the studio installs its own copy under ~/.aha/tools on first use (pyright with the
 * studio's own Node, gopls with the Go toolchain). Nothing here takes a command from the browser.
 */

import fs from 'node:fs';
import path from 'node:path';
import { AHA_DIR, runEnv, which } from '../polyglot.ts';
import { capture } from '../proc.ts';
import { refreshBinPaths } from '../toolchains.ts';

export type LspLanguage = 'python' | 'go' | 'rust';

export interface LspServerInfo {
  id: LspLanguage;
  name: string;
  /** Editor language ids it serves */
  languages: string[];
  /** Files it reads besides the source files (manifests, settings) */
  files: RegExp;
  /** What to tell the user when it can't be found or installed */
  hint: string;
}

export const LSP_SERVERS: LspServerInfo[] = [
  { id: 'python', name: 'Pyright', languages: ['python'], files: /(\.pyi?$|(^|\/)(pyproject\.toml|pyrightconfig\.json|setup\.cfg|requirements[\w.-]*\.txt)$)/, hint: 'Installed on first use (the pyright package, run with the studio’s own Node). A basedpyright-langserver or pyright-langserver on your PATH is used first.' },
  { id: 'go', name: 'gopls', languages: ['go'], files: /(\.go$|(^|\/)(go\.mod|go\.sum|go\.work)$)/, hint: 'Installed on first use with `go install` (Go must be installed: the Language panel can add it).' },
  { id: 'rust', name: 'rust-analyzer', languages: ['rust'], files: /(\.rs$|(^|\/)(Cargo\.toml|Cargo\.lock)$)/, hint: 'Uses rust-analyzer from your PATH (rustup component add rust-analyzer).' },
];

export const serverFor = (id: string) => LSP_SERVERS.find((s) => s.id === id);

/** The language server for an editor language id or a file path */
export function serverForFile(file: string): LspServerInfo | undefined {
  if (/\.pyi?$/.test(file)) return serverFor('python');
  if (/\.go$/.test(file)) return serverFor('go');
  if (/\.rs$/.test(file)) return serverFor('rust');
  return undefined;
}

export const TOOLS_DIR = path.join(AHA_DIR, 'tools');
const PYRIGHT_VERSION = '1.1.406';
const PYRIGHT_DIR = path.join(TOOLS_DIR, `pyright-${PYRIGHT_VERSION}`);
const PYRIGHT_ENTRY = path.join(PYRIGHT_DIR, 'node_modules', 'pyright', 'langserver.index.js');
const GO_BIN = path.join(TOOLS_DIR, 'go-bin');

export interface LspCommand {
  file: string;
  args: string[];
}

const envPath = () => {
  const env = runEnv(process.env, TOOLS_DIR, {});
  return env.PATH ?? env.Path ?? '';
};

/** How to start the server if it is here already, without installing anything */
export function findServer(id: LspLanguage): LspCommand | null {
  const PATH = envPath();
  if (id === 'python') {
    for (const bin of ['basedpyright-langserver', 'pyright-langserver']) {
      const found = which(bin, PATH);
      if (found) return { file: found, args: ['--stdio'] };
    }
    if (fs.existsSync(PYRIGHT_ENTRY)) return { file: process.execPath, args: [PYRIGHT_ENTRY, '--stdio'] };
    return null;
  }
  if (id === 'go') {
    const found = which('gopls', PATH) ?? (fs.existsSync(path.join(GO_BIN, process.platform === 'win32' ? 'gopls.exe' : 'gopls')) ? path.join(GO_BIN, process.platform === 'win32' ? 'gopls.exe' : 'gopls') : null);
    return found ? { file: found, args: [] } : null;
  }
  const found = which('rust-analyzer', PATH);
  return found ? { file: found, args: [] } : null;
}

const installing = new Map<LspLanguage, Promise<LspCommand>>();

/** Find the server, installing the studio's own copy when it isn't there (once; concurrent callers share it) */
export function ensureServer(id: LspLanguage, onProgress: (text: string) => void = () => {}): Promise<LspCommand> {
  const found = findServer(id);
  if (found) return Promise.resolve(found);
  const running = installing.get(id);
  if (running) return running;
  const job = install(id, onProgress).finally(() => installing.delete(id));
  installing.set(id, job);
  return job;
}

async function install(id: LspLanguage, onProgress: (text: string) => void): Promise<LspCommand> {
  await fs.promises.mkdir(TOOLS_DIR, { recursive: true });
  await refreshBinPaths();
  const env = runEnv(process.env, TOOLS_DIR, {});
  if (id === 'python') {
    const npm = which('npm', envPath());
    if (!npm) throw new Error('Installing Pyright needs npm, which comes with Node.js.');
    onProgress('Installing Pyright for Python (first use only)…');
    await fs.promises.mkdir(PYRIGHT_DIR, { recursive: true });
    const r = await capture(npm, ['install', '--prefix', PYRIGHT_DIR, '--no-audit', '--no-fund', '--ignore-scripts', `pyright@${PYRIGHT_VERSION}`], { cwd: PYRIGHT_DIR, env: env as unknown as NodeJS.ProcessEnv, timeoutMs: 300_000 });
    if (r.code !== 0 || !fs.existsSync(PYRIGHT_ENTRY)) throw new Error(`Installing Pyright failed:\n${r.output.slice(-1500)}`);
    return { file: process.execPath, args: [PYRIGHT_ENTRY, '--stdio'] };
  }
  if (id === 'go') {
    const go = which('go', envPath());
    if (!go) throw new Error('gopls needs Go. Install Go from the Language panel, then open the file again.');
    onProgress('Installing gopls for Go (first use only, about a minute)…');
    const r = await capture(go, ['install', 'golang.org/x/tools/gopls@latest'], { cwd: TOOLS_DIR, env: { ...env, GOBIN: GO_BIN } as unknown as NodeJS.ProcessEnv, timeoutMs: 600_000 });
    const found = findServer('go');
    if (r.code !== 0 || !found) throw new Error(`Installing gopls failed:\n${r.output.slice(-1500)}`);
    return found;
  }
  throw new Error(serverFor(id)!.hint);
}

/** Which servers are here now (for the status line), without installing */
export function serverStatus(): { id: LspLanguage; name: string; ready: boolean; hint: string }[] {
  return LSP_SERVERS.map((s) => ({ id: s.id, name: s.name, ready: findServer(s.id) !== null, hint: s.hint }));
}
