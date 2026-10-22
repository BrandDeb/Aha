/**
 * The in-browser preview: a web app (Vite with React, Preact, Vue, Svelte or
 * plain TypeScript) bundled by esbuild-wasm and run without any server or
 * install. npm packages come from esm.sh at the versions in package.json.
 *
 * It all runs inside a sandboxed frame on an opaque origin (see
 * app/preview-frame), never in the studio's page: the project's code and the
 * compilers it pulls in can't reach the studio, its storage or your keys.
 *
 * The helpers below are self-contained on purpose (no imports, no calls to
 * each other): the frame embeds their source with Function#toString, so the
 * code tested here is exactly the code that runs there.
 */

export type BrowserFlavour = 'react' | 'preact' | 'vue' | 'svelte' | 'vanilla';

/** Whether the in-browser preview can run this project, and with what */
export function browserPreviewSupport(files: Record<string, string>): { ok: true; flavour: BrowserFlavour } | { ok: false; reason: string } {
  let deps: Record<string, string> = {};
  try {
    const pkg = JSON.parse(files['package.json'] ?? '{}');
    deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  } catch {
    return { ok: false, reason: 'package.json is not valid JSON.' };
  }
  const server = [['next', 'Next.js'], ['nuxt', 'Nuxt'], ['@sveltejs/kit', 'SvelteKit'], ['astro', 'Astro'], ['@react-router/dev', 'React Router'], ['@angular/core', 'Angular'], ['solid-js', 'Solid']].find(([d]) => d in deps);
  if (server) return { ok: false, reason: `${server[1]} needs its own dev server (or compiler plugin), so it previews with the dev server instead.` };
  if (!('vite' in deps) && !files['index.html']) return { ok: false, reason: 'The in-browser preview runs Vite-style apps: an index.html, or vite in package.json.' };
  const flavour: BrowserFlavour = 'react-dom' in deps ? 'react' : 'preact' in deps ? 'preact' : 'vue' in deps ? 'vue' : 'svelte' in deps ? 'svelte' : 'vanilla';
  return { ok: true, flavour };
}

/** The module index.html loads (Vite style), or the usual entry files */
export function previewEntry(files: Record<string, string>): { entry: string; src: string | null } | null {
  const html = files['index.html'];
  if (html) {
    const match = /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/i.exec(html) ?? /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*\btype=["']module["'][^>]*>\s*<\/script>/i.exec(html);
    if (match && !/^https?:/.test(match[1])) {
      const entry = match[1].replace(/^\.?\//, '');
      if (entry in files) return { entry, src: match[1] };
    }
  }
  for (const candidate of ['src/main.tsx', 'src/main.ts', 'src/main.jsx', 'src/main.js', 'src/index.tsx', 'src/index.ts', 'src/index.jsx', 'src/index.js', 'main.ts', 'main.js']) {
    if (candidate in files) return { entry: candidate, src: null };
  }
  return null;
}

/** A project file an import points at, trying the extensions bundlers try */
export function resolveProjectPath(importer: string, spec: string, files: Record<string, string>): string | null {
  const base = spec.startsWith('/') ? [] : importer.split('/').slice(0, -1);
  for (const part of spec.replace(/^\//, '').split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') base.pop();
    else base.push(part);
  }
  const target = base.join('/');
  const tries = [target, ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '.vue', '.svelte', '.json', '.css'].map((e) => target + e), ...['ts', 'tsx', 'js', 'jsx'].map((e) => `${target}/index.${e}`)];
  return tries.find((t) => t in files) ?? null;
}

/**
 * The esm.sh URL for a bare import ("react", "react-dom/client", "@scope/pkg/sub"), at the version
 * package.json asks for. The project's other packages stay external, so the import map shares one copy
 * of each (one React, not two).
 */
export function npmUrl(spec: string, versions: Record<string, string>): string {
  const parts = spec.split('/');
  const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  const sub = spec.slice(name.length);
  const declared = versions[name];
  const version = declared && /^[\w.^~<>=| -]+$/.test(declared) && !/^(workspace|file|link|git)/.test(declared) ? declared.replace(/\s+/g, '') : 'latest';
  const external = Object.keys(versions).filter((d) => d !== name && !d.startsWith('@types/'));
  return `https://esm.sh/${name}@${encodeURIComponent(version)}${sub}?dev${external.length ? `&external=${external.join(',')}` : ''}`;
}

/** Splice the bundle into the page: drop the original entry script, add the import map, an optional classic script that must run first, and the bundle */
export function htmlWithBundle(html: string | undefined, src: string | null, importMap: unknown, bundle: string, prelude = ''): string {
  const safe = (text: string) => text.replace(/<\/script/gi, '<\\/script');
  let page = html ?? '<!doctype html>\n<html lang="en">\n<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>\n<body><div id="app"></div><div id="root"></div></body>\n</html>';
  if (src) {
    const escaped = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    page = page.replace(new RegExp(`<script\\b[^>]*\\bsrc=["']${escaped}["'][^>]*>\\s*</script>`, 'i'), '');
  }
  const map = `<script type="importmap">${safe(JSON.stringify(importMap))}</script>${prelude ? `\n<script>${safe(prelude)}</script>` : ''}`;
  page = /<head[^>]*>/i.test(page) ? page.replace(/<head[^>]*>/i, (m) => `${m}\n${map}`) : `${map}\n${page}`;
  const script = `<script type="module">\n${safe(bundle)}\n</script>`;
  return /<\/body>/i.test(page) ? page.replace(/<\/body>/i, `${script}\n</body>`) : `${page}\n${script}`;
}

export interface PreviewHelpers {
  browserPreviewSupport: typeof browserPreviewSupport;
  previewEntry: typeof previewEntry;
  resolveProjectPath: typeof resolveProjectPath;
  npmUrl: typeof npmUrl;
  htmlWithBundle: typeof htmlWithBundle;
}

interface EsbuildApi {
  initialize(options: { wasmURL: string; worker: boolean }): Promise<void>;
  build(options: Record<string, unknown>): Promise<{ outputFiles?: { text: string }[]; warnings: { text: string }[] }>;
}

/**
 * The frame's program: load esbuild, wait for the studio's files, bundle, show the result in an inner
 * frame and report back (build time, errors, the app's console). Runs only inside the preview frame.
 */
export async function previewBuilderMain(h: PreviewHelpers, cfg: { esbuildUrl: string; wasmUrl: string }): Promise<void> {
  const post = (message: Record<string, unknown>) => parent.postMessage({ source: 'nanocli-preview', ...message }, '*');
  const app = document.getElementById('app') as HTMLIFrameElement;
  let esbuild: EsbuildApi;
  try {
    esbuild = (await import(/* turbopackIgnore: true */ cfg.esbuildUrl)) as EsbuildApi;
    await esbuild.initialize({ wasmURL: cfg.wasmUrl, worker: true });
  } catch (error) {
    post({ type: 'error', message: `Could not start the bundler: ${(error as Error).message}` });
    return;
  }
  const compilers = new Map<string, Promise<Record<string, (...args: unknown[]) => unknown>>>();
  const compiler = (url: string) => {
    if (!compilers.has(url)) compilers.set(url, import(/* turbopackIgnore: true */ url));
    return compilers.get(url)!;
  };
  const hash = (text: string) => {
    let x = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) x = Math.imul(x ^ text.charCodeAt(i), 0x01000193);
    return (x >>> 0).toString(16).slice(0, 8);
  };
  const styleModule = (css: string) => `const s = document.createElement('style'); s.textContent = ${JSON.stringify(css)}; document.head.appendChild(s);`;

  const showError = (message: string) => {
    app.srcdoc = `<!doctype html><meta charset="utf-8"><body style="margin:0;font:13px/1.5 ui-monospace,monospace;background:#1a0f12;color:#ffb4b4;padding:16px;white-space:pre-wrap">${message.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</body>`;
  };

  // The app's page has an opaque origin of its own, so it reports its console and uncaught errors by message;
  // this runs first in that page, before any module
  const consolePrelude = `(function () {
  var send = function (level, args) {
    try {
      var text = Array.prototype.map.call(args, function (a) { if (typeof a === 'string') return a; try { return JSON.stringify(a); } catch (e) { return String(a); } }).join(' ');
      parent.postMessage({ source: 'nanocli-app', type: 'console', level: level, text: text.slice(0, 4000) }, '*');
    } catch (e) {}
  };
  ['log', 'info', 'warn', 'error'].forEach(function (level) {
    var original = console[level];
    console[level] = function () { send(level, arguments); return original.apply(console, arguments); };
  });
  addEventListener('error', function (e) { send('error', [e.message + ' (' + String(e.filename || '').split('/').pop() + ':' + e.lineno + ')']); });
  addEventListener('unhandledrejection', function (e) { send('error', ['Unhandled rejection: ' + String(e.reason)]); });
})();`;

  let running = 0;
  const build = async (files: Record<string, string>) => {
    const ticket = ++running;
    const started = performance.now();
    const support = h.browserPreviewSupport(files);
    if (!support.ok) {
      showError(support.reason);
      post({ type: 'error', message: support.reason });
      return;
    }
    const found = h.previewEntry(files);
    if (!found) {
      showError('No entry: add an index.html with <script type="module" src="/src/main.ts">, or a src/main.ts.');
      post({ type: 'error', message: 'No entry file found.' });
      return;
    }
    let versions: Record<string, string> = {};
    let jsxImportSource = support.flavour === 'preact' ? 'preact' : 'react';
    try {
      const pkg = JSON.parse(files['package.json'] ?? '{}');
      versions = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      delete versions.vite;
      for (const tool of Object.keys(versions)) if (/^(@vitejs\/|@sveltejs\/vite-plugin|@preact\/preset-vite|vite-plugin-|typescript$|@types\/|vue-tsc$|svelte-check$|@tsconfig\/)/.test(tool)) delete versions[tool];
      const tsconfig = JSON.parse((files['tsconfig.json'] ?? '{}').replace(/\/\/.*$/gm, ''));
      if (tsconfig.compilerOptions?.jsxImportSource) jsxImportSource = tsconfig.compilerOptions.jsxImportSource;
    } catch {
      // defaults are fine
    }

    const plugin = {
      name: 'nanocli-project',
      setup(b: { onResolve: (o: unknown, f: (a: { path: string; importer: string; kind: string }) => unknown) => void; onLoad: (o: unknown, f: (a: { path: string }) => unknown) => void }) {
        b.onResolve({ filter: /.*/ }, (args) => {
          if (args.kind === 'entry-point') return { path: args.path, namespace: 'project' };
          if (/^(https?:|data:)/.test(args.path)) return { path: args.path, external: true };
          if (args.path.startsWith('.') || args.path.startsWith('/')) {
            const resolved = h.resolveProjectPath(args.importer, args.path, files);
            return resolved ? { path: resolved, namespace: 'project' } : { errors: [{ text: `Cannot find "${args.path}" (imported by ${args.importer})` }] };
          }
          return { path: h.npmUrl(args.path, versions), external: true };
        });
        b.onLoad({ filter: /.*/, namespace: 'project' }, async (args) => {
          const source = files[args.path] ?? '';
          const ext = args.path.slice(args.path.lastIndexOf('.') + 1).toLowerCase();
          if (ext === 'css') return { contents: styleModule(source), loader: 'js' };
          if (ext === 'json') return { contents: source, loader: 'json' };
          if (ext === 'svg') return { contents: `export default ${JSON.stringify(`data:image/svg+xml,${encodeURIComponent(source)}`)};`, loader: 'js' };
          if (ext === 'svelte') {
            const svelte = await compiler(`https://esm.sh/svelte@${versions.svelte ?? 'latest'}/compiler`);
            const out = (svelte.compile as (s: string, o: unknown) => { js: { code: string } })(source, { filename: args.path, generate: 'client', dev: true, css: 'injected' });
            return { contents: out.js.code, loader: 'js' };
          }
          if (ext === 'vue') {
            const sfc = await compiler(`https://esm.sh/@vue/compiler-sfc@${versions.vue ?? 'latest'}`);
            type Block = { content: string; lang?: string; scoped?: boolean };
            const { descriptor } = (sfc.parse as (s: string, o: unknown) => { descriptor: { script: Block | null; scriptSetup: Block | null; template: Block | null; styles: Block[] } })(source, { filename: args.path });
            const id = hash(args.path);
            const scoped = descriptor.styles.some((s) => s.scoped);
            const compileScript = sfc.compileScript as (d: unknown, o: unknown) => { content: string };
            let code: string;
            if (descriptor.scriptSetup) {
              code = compileScript(descriptor, { id, inlineTemplate: true }).content.replace(/export default\s*/, 'const __sfc__ = ');
            } else {
              code = descriptor.script ? compileScript(descriptor, { id }).content.replace(/export default\s*/, 'const __sfc__ = ') : 'const __sfc__ = {};';
              if (descriptor.template) {
                const template = (sfc.compileTemplate as (o: unknown) => { code: string })({ source: descriptor.template.content, filename: args.path, id, scoped, compilerOptions: { scopeId: scoped ? `data-v-${id}` : undefined } });
                code += `\n${template.code.replace(/export function render/, 'function __render')}\n__sfc__.render = __render;`;
              }
            }
            if (scoped) code += `\n__sfc__.__scopeId = "data-v-${id}";`;
            for (const style of descriptor.styles) {
              const css = (sfc.compileStyle as (o: unknown) => { code: string })({ source: style.content, filename: args.path, id: `data-v-${id}`, scoped: !!style.scoped }).code;
              code += `\n${styleModule(css)}`;
            }
            code += '\nexport default __sfc__;';
            const lang = descriptor.scriptSetup?.lang ?? descriptor.script?.lang;
            return { contents: code, loader: lang === 'ts' ? 'ts' : 'js' };
          }
          const loader = ext === 'tsx' ? 'tsx' : ext === 'ts' || ext === 'mts' ? 'ts' : ext === 'jsx' ? 'jsx' : 'js';
          return { contents: source, loader };
        });
      },
    };

    try {
      const result = await esbuild.build({
        entryPoints: [found.entry],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'browser',
        target: 'es2022',
        jsx: 'automatic',
        jsxImportSource,
        sourcemap: 'inline',
        logLevel: 'silent',
        define: {
          'process.env.NODE_ENV': '"development"',
          'import.meta.env': JSON.stringify({ DEV: true, PROD: false, MODE: 'development', BASE_URL: '/', SSR: false }),
        },
        plugins: [plugin],
      });
      if (ticket !== running) return;
      const bundle = result.outputFiles?.[0]?.text ?? '';
      const imports: Record<string, string> = {};
      for (const name of Object.keys(versions)) imports[name] = h.npmUrl(name, versions);
      app.srcdoc = h.htmlWithBundle(files['index.html'], found.src, { imports }, bundle, consolePrelude);
      post({ type: 'built', ms: Math.round(performance.now() - started), flavour: support.flavour, warnings: result.warnings.length, bytes: bundle.length });
    } catch (error) {
      if (ticket !== running) return;
      const errors = (error as { errors?: { text: string; location?: { file: string; line: number; column: number; lineText: string } }[] }).errors;
      const message = errors?.length
        ? errors.map((e) => (e.location ? `${e.location.file}:${e.location.line}:${e.location.column}: ${e.text}\n  ${e.location.lineText}` : e.text)).join('\n\n')
        : (error as Error).message;
      showError(message);
      post({ type: 'error', message });
    }
  };

  window.addEventListener('message', (event) => {
    // The app's console, relayed to the studio
    if (event.source === app.contentWindow) {
      const data = event.data as { source?: string; type?: string; level?: unknown; text?: unknown } | null;
      if (data?.source === 'nanocli-app' && data.type === 'console') post({ type: 'console', level: String(data.level), text: String(data.text).slice(0, 4000) });
      return;
    }
    // Only the studio that embeds this frame can drive it
    if (event.source !== parent) return;
    const data = event.data as { type?: string; files?: Record<string, string> } | null;
    if (data?.type === 'build' && data.files && typeof data.files === 'object') void build(data.files);
  });
  post({ type: 'ready' });
}
