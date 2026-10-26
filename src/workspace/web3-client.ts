'use client';

/**
 * Compiling Solidity in the browser: the official compiler runs in a worker (public/solc-worker.js, one per
 * version), imports are gathered first (project files, and npm packages from jsDelivr, cached for the page), and
 * the output is read into messages and contracts. Pure parts are in lib/web3/solc.
 */

import { DEFAULT_SETTINGS, gatherSources, pickVersion, readOutput, solidityEntries, standardInput, type CompileMessage, type CompiledContract, type CompilerSettings } from '@/lib/web3/solc';

export interface CompileResult {
  version: string;
  ms: number;
  messages: CompileMessage[];
  contracts: CompiledContract[];
  missing: { from: string; spec: string }[];
  /** Every source the compiler saw, for positions in imported files */
  sources: Record<string, { content: string }>;
}

let releasesPromise: Promise<string[]> | null = null;
/** Compiler releases, newest first */
export function solcReleases(): Promise<string[]> {
  releasesPromise ??= fetch('/api/solc')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`The compiler list is unavailable (${r.status})`))))
    .then((d: { releases: string[] }) => d.releases)
    .catch((error) => {
      releasesPromise = null;
      throw error;
    });
  return releasesPromise;
}

const workers = new Map<string, Worker>();
let nextId = 0;
function compileIn(version: string, input: string): Promise<string> {
  let worker = workers.get(version);
  if (!worker) {
    worker = new Worker('/solc-worker.js');
    workers.set(version, worker);
  }
  const w = worker;
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<{ id: number; output?: string; error?: string }>) => {
      if (event.data.id !== id) return;
      w.removeEventListener('message', onMessage);
      if (event.data.error) {
        workers.delete(version);
        w.terminate();
        reject(new Error(event.data.error));
      } else resolve(event.data.output ?? '{}');
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ id, version, input });
  });
}

const texts = new Map<string, Promise<string | null>>();
const fetchText = (url: string) => {
  if (!texts.has(url)) texts.set(url, fetch(url).then((r) => (r.ok ? r.text() : null)).catch(() => null));
  return texts.get(url)!;
};

/** Compile the project's contracts (or the given entries) */
export async function compileProject(files: Record<string, string>, settings: Partial<CompilerSettings> = {}, entries = solidityEntries(files)): Promise<CompileResult> {
  const started = performance.now();
  let versions: Record<string, string> = {};
  try {
    const pkg = JSON.parse(files['package.json'] ?? '{}');
    versions = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  } catch {
    // no package.json: npm imports use the default versions
  }
  const { sources, missing } = await gatherSources(files, entries, fetchText, versions);
  const version = settings.version || pickVersion(Object.values(sources).map((s) => s.content), await solcReleases());
  if (!version) throw new Error('No compiler release matches every pragma solidity in these files.');
  const output = JSON.parse(await compileIn(version, standardInput(sources, { ...DEFAULT_SETTINGS, ...settings })));
  const read = readOutput(output, sources);
  return { version, ms: Math.round(performance.now() - started), ...read, missing, sources };
}
