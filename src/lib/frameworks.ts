/**
 * Web frameworks the studio can run with their own dev server: how to
 * recognise each from package.json, which binary starts it, and how to pin
 * it to a host and port. Pure, so it is shared by the server and the browser
 * and tested without starting anything.
 */

export interface Framework {
  id: string;
  name: string;
  /** Dependencies that identify it, most specific first across the catalog */
  markers: string[];
  /** Package whose "bin" starts the dev server, and the bin's name */
  pkg: string;
  bin: string;
  /** Arguments for the dev server on 127.0.0.1:port */
  args: (port: number) => string[];
  /** Oldest Node.js release the current major supports */
  minNode: string;
  docs: string;
}

const HOST = '127.0.0.1';
const vite = (port: number) => ['--host', HOST, '--port', String(port), '--strictPort'];

/** Order matters: meta-frameworks before the bundler they are built on */
export const FRAMEWORKS: Framework[] = [
  { id: 'next', name: 'Next.js', markers: ['next'], pkg: 'next', bin: 'next', args: (p) => ['dev', '--hostname', HOST, '--port', String(p)], minNode: '20.9.0', docs: 'https://nextjs.org/docs' },
  { id: 'nuxt', name: 'Nuxt', markers: ['nuxt'], pkg: 'nuxt', bin: 'nuxt', args: (p) => ['dev', '--host', HOST, '--port', String(p)], minNode: '22.19.0', docs: 'https://nuxt.com/docs' },
  { id: 'sveltekit', name: 'SvelteKit', markers: ['@sveltejs/kit'], pkg: 'vite', bin: 'vite', args: (p) => ['dev', ...vite(p)], minNode: '22.17.0', docs: 'https://svelte.dev/docs/kit' },
  { id: 'astro', name: 'Astro', markers: ['astro'], pkg: 'astro', bin: 'astro', args: (p) => ['dev', '--host', HOST, '--port', String(p)], minNode: '22.12.0', docs: 'https://docs.astro.build' },
  { id: 'react-router', name: 'React Router', markers: ['@react-router/dev'], pkg: '@react-router/dev', bin: 'react-router', args: (p) => ['dev', '--host', HOST, '--port', String(p), '--strictPort'], minNode: '22.22.0', docs: 'https://reactrouter.com' },
  { id: 'angular', name: 'Angular', markers: ['@angular/build', '@angular/cli'], pkg: '@angular/cli', bin: 'ng', args: (p) => ['serve', '--host', HOST, '--port', String(p)], minNode: '20.19.0', docs: 'https://angular.dev' },
  { id: 'vite', name: 'Vite', markers: ['vite'], pkg: 'vite', bin: 'vite', args: vite, minNode: '20.19.0', docs: 'https://vite.dev/guide' },
];

/** The library a Vite project renders with, for a friendlier name ("Vite · React") */
const FLAVOURS: [string, string][] = [
  ['react', 'React'],
  ['vue', 'Vue'],
  ['svelte', 'Svelte'],
  ['solid-js', 'Solid'],
  ['preact', 'Preact'],
  ['lit', 'Lit'],
];

export interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

export function parsePackageJson(text: string | undefined): PackageJson | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as PackageJson) : null;
  } catch {
    return null;
  }
}

const depsOf = (pkg: PackageJson) => ({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });

export interface Detected {
  framework: Framework;
  /** "Vite · React", "Next.js" */
  label: string;
}

/** The framework a project's root package.json uses, if any */
export function detectFramework(files: Record<string, string>): Detected | null {
  const pkg = parsePackageJson(files['package.json']);
  if (!pkg) return null;
  const deps = depsOf(pkg);
  const framework = FRAMEWORKS.find((f) => f.markers.some((m) => m in deps));
  if (!framework) return null;
  const flavour = framework.id === 'vite' ? FLAVOURS.find(([dep]) => dep in deps)?.[1] : undefined;
  return { framework, label: flavour ? `${framework.name} · ${flavour}` : framework.name };
}

/** What decides whether dependencies must be installed again: the declared packages and the lockfile */
export function dependencyKey(files: Record<string, string>): string {
  const pkg = parsePackageJson(files['package.json']) ?? {};
  const lock = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock'].map((name) => (files[name] ? `${name}:${files[name].length}:${hash(files[name])}` : '')).join('|');
  return `${hash(JSON.stringify([pkg.dependencies ?? {}, pkg.devDependencies ?? {}]))}|${lock}`;
}

/** FNV-1a: a cheap, stable fingerprint (not for security) */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/** The lockfile decides, then a bunfig.toml or the packageManager field; npm otherwise */
export function packageManagerFor(files: Record<string, string>): PackageManager {
  if ('bun.lock' in files || 'bun.lockb' in files || 'bunfig.toml' in files) return 'bun';
  if ('pnpm-lock.yaml' in files) return 'pnpm';
  if ('yarn.lock' in files) return 'yarn';
  const declared = files['package.json']?.match(/"packageManager"\s*:\s*"(npm|pnpm|yarn|bun)@/)?.[1];
  return (declared as PackageManager | undefined) ?? 'npm';
}

export const INSTALL_ARGS: Record<PackageManager, string[]> = {
  npm: ['install', '--no-audit', '--no-fund', '--loglevel=error'],
  pnpm: ['install', '--reporter=append-only'],
  yarn: ['install', '--non-interactive'],
  bun: ['install'],
};

/** Compare dotted versions: is `have` at least `need`? */
export function atLeast(have: string, need: string): boolean {
  const a = have.replace(/^v/, '').split('.').map(Number);
  const b = need.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

/** Folders the dev server and the package manager own: never synced from the browser or deleted by a sync */
export const GENERATED_DIRS = new Set(['node_modules', '.next', '.nuxt', '.output', '.svelte-kit', '.angular', '.astro', '.react-router', '.vite', 'dist', 'build', '.home', '.cache', '.turbo']);

/** A local URL a dev server printed ("Local: http://localhost:5173/") */
export function localUrlIn(text: string): string | null {
  // Strip colour codes some tools print anyway
  const clean = text.replace(/\x1b\[[0-9;]*m/g, '');
  const match = clean.match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(\d{2,5})\/?\S*/);
  return match ? match[0].replace(/[,.)]+$/, '') : null;
}
