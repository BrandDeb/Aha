/**
 * Web apps in every language, run with their own server and previewed live:
 * FastAPI, Flask and Django (Python, with uv), Go, Rust (axum, actix, rocket),
 * Ruby (Sinatra, with Bundler), PHP, Java, Node (Express, Fastify, Hono, Koa),
 * Bun, Deno, C# (ASP.NET) and Elixir (Plug). For each: how to recognise it,
 * how to install what it needs, the command that serves it on a port, and
 * whether it reloads by itself on a change or is restarted. The dev-server
 * host (lib/devserver.ts) runs these like it runs Vite or Next.js.
 * Pure, so it is shared by the server and the browser and tested directly.
 */

import { detectFramework } from './frameworks.ts';

export interface AppServer {
  id: string;
  name: string;
  language: string;
  /** What the preview and the status bar call it ("Python · FastAPI", "Go") */
  label: string;
  /** The language id that installs its toolchain (lib/languages.ts) */
  languageId: string;
  docs: string;
  /** The program it needs on this machine, for "install X" messages */
  tool: string;
  /** Whether this project is one */
  detect: (files: Record<string, string>) => boolean;
  /** Shell command that installs or builds what it needs, if anything */
  install?: (files: Record<string, string>) => string | null;
  /** Shell command that serves the app on 127.0.0.1:port (PORT is also in the environment) */
  start: (files: Record<string, string>, port: number) => string;
  /** 'self': it reloads on file changes by itself; 'restart': the process is restarted after each change */
  reload: 'self' | 'restart';
  /** Files whose change means installing again */
  manifests: string[];
}

const has = (files: Record<string, string>, path: string, pattern: RegExp) => pattern.test(files[path] ?? '');
const findFile = (files: Record<string, string>, ext: RegExp, content: RegExp) =>
  Object.keys(files)
    .filter((p) => ext.test(p) && !/(^|\/)(\.venv|node_modules|vendor|target|deps|_build)\//.test(p) && content.test(files[p]))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))[0] ?? null;
const pyDeps = (files: Record<string, string>) => `${files['pyproject.toml'] ?? ''}\n${files['requirements.txt'] ?? ''}`;
/** app/main.py -> app.main */
const pyModule = (path: string) => path.replace(/\.py$/, '').replace(/\//g, '.');
const quote = (s: string) => (/^[\w./-]+$/.test(s) ? s : `"${s.replace(/"/g, '\\"')}"`);
const uvInstall = (files: Record<string, string>) => ('pyproject.toml' in files ? 'uv sync' : 'requirements.txt' in files ? 'uv venv --allow-existing && uv pip install -r requirements.txt' : null);
const uvRun = (files: Record<string, string>) => ('pyproject.toml' in files ? 'uv run' : 'uv run --no-project');

export const APP_SERVERS: AppServer[] = [
  {
    id: 'fastapi',
    label: 'Python · FastAPI',
    languageId: 'python',
    name: 'FastAPI',
    language: 'Python',
    docs: 'https://fastapi.tiangolo.com',
    tool: 'uv',
    detect: (f) => /\bfastapi\b/i.test(pyDeps(f)) && !!findFile(f, /\.py$/, /\bFastAPI\s*\(/),
    install: uvInstall,
    start: (f, port) => {
      const file = findFile(f, /\.py$/, /\bFastAPI\s*\(/)!;
      const name = /(\w+)\s*(?::[^=]+)?=\s*FastAPI\s*\(/.exec(f[file])?.[1] ?? 'app';
      return `${uvRun(f)} uvicorn ${pyModule(file)}:${name} --host 127.0.0.1 --port ${port} --reload`;
    },
    reload: 'self',
    manifests: ['pyproject.toml', 'uv.lock', 'requirements.txt'],
  },
  {
    id: 'django',
    label: 'Python · Django',
    languageId: 'python',
    name: 'Django',
    language: 'Python',
    docs: 'https://docs.djangoproject.com',
    tool: 'uv',
    detect: (f) => 'manage.py' in f && /\bdjango\b/i.test(pyDeps(f)),
    install: uvInstall,
    start: (f, port) => `${uvRun(f)} python manage.py runserver 127.0.0.1:${port}`,
    reload: 'self',
    manifests: ['pyproject.toml', 'uv.lock', 'requirements.txt'],
  },
  {
    id: 'flask',
    label: 'Python · Flask',
    languageId: 'python',
    name: 'Flask',
    language: 'Python',
    docs: 'https://flask.palletsprojects.com',
    tool: 'uv',
    detect: (f) => /\bflask\b/i.test(pyDeps(f)) && !!findFile(f, /\.py$/, /\bFlask\s*\(/),
    install: uvInstall,
    start: (f, port) => {
      const file = findFile(f, /\.py$/, /\bFlask\s*\(/)!;
      const name = /(\w+)\s*=\s*Flask\s*\(/.exec(f[file])?.[1] ?? 'app';
      return `${uvRun(f)} flask --app ${pyModule(file)}:${name} run --host 127.0.0.1 --port ${port} --debug`;
    },
    reload: 'self',
    manifests: ['pyproject.toml', 'uv.lock', 'requirements.txt'],
  },
  {
    id: 'go',
    label: 'Go',
    languageId: 'go',
    name: 'Go',
    language: 'Go',
    docs: 'https://pkg.go.dev/net/http',
    tool: 'go',
    detect: (f) => 'go.mod' in f && !!findFile(f, /\.go$/, /\.ListenAndServe\s*\(|\bgin\.|\becho\.New\(|\bfiber\.New\(|\bchi\.NewRouter\(/),
    install: (f) => (/\brequire\b/.test(f['go.mod']) ? 'go mod download' : null),
    start: () => 'go run .',
    reload: 'restart',
    manifests: ['go.mod', 'go.sum'],
  },
  {
    id: 'rust',
    label: 'Rust',
    languageId: 'rust',
    name: 'Rust',
    language: 'Rust',
    docs: 'https://docs.rs/axum',
    tool: 'cargo',
    detect: (f) => has(f, 'Cargo.toml', /^\s*(axum|actix-web|rocket|warp|poem|salvo|tide)\s*=/m),
    // Building first shows progress as "installing" and makes the first start (and each restart) quick
    install: () => 'cargo build',
    start: () => 'cargo run --quiet',
    reload: 'restart',
    manifests: ['Cargo.toml', 'Cargo.lock'],
  },
  {
    id: 'sinatra',
    label: 'Ruby · Sinatra',
    languageId: 'ruby',
    name: 'Sinatra',
    language: 'Ruby',
    docs: 'https://sinatrarb.com',
    tool: 'bundle',
    detect: (f) => has(f, 'Gemfile', /["']sinatra["']/) && !!findFile(f, /\.rb$/, /require\s+["']sinatra/),
    install: () => 'bundle config set --local path vendor/bundle && bundle install',
    start: (f, port) => `bundle exec ruby ${quote(findFile(f, /\.rb$/, /require\s+["']sinatra/)!)} -o 127.0.0.1 -p ${port}`,
    reload: 'restart',
    manifests: ['Gemfile', 'Gemfile.lock'],
  },
  {
    id: 'php',
    label: 'PHP',
    languageId: 'php',
    name: 'PHP',
    language: 'PHP',
    docs: 'https://www.php.net/manual/en/features.commandline.webserver.php',
    tool: 'php',
    detect: (f) => 'index.php' in f || 'public/index.php' in f,
    install: (f) => ('composer.json' in f ? 'composer install --no-interaction' : null),
    // The built-in server reads each file per request: every edit shows on the next load
    start: (f, port) => `php -S 127.0.0.1:${port} -t ${'public/index.php' in f ? 'public' : '.'}`,
    reload: 'self',
    manifests: ['composer.json', 'composer.lock'],
  },
  {
    id: 'java',
    label: 'Java',
    languageId: 'java',
    name: 'Java',
    language: 'Java',
    docs: 'https://docs.oracle.com/en/java/javase/21/docs/api/jdk.httpserver/com/sun/net/httpserver/package-summary.html',
    tool: 'java',
    detect: (f) => !('pom.xml' in f) && !('build.gradle' in f) && !('build.gradle.kts' in f) && !!findFile(f, /\.java$/, /HttpServer\.create\s*\(/),
    // Single-file source launch: compiled in memory on every start
    start: (f) => `java ${quote(findFile(f, /\.java$/, /HttpServer\.create\s*\(/)!)}`,
    reload: 'restart',
    manifests: [],
  },
  {
    id: 'bun',
    label: 'Bun',
    languageId: 'bun',
    name: 'Bun',
    language: 'TypeScript',
    docs: 'https://bun.sh/docs/api/http',
    tool: 'bun',
    detect: (f) => !!findFile(f, /\.[cm]?[jt]sx?$/, /\bBun\.serve\s*\(/),
    install: (f) => ('package.json' in f && /"dependencies"/.test(f['package.json']) ? 'bun install' : null),
    start: (f) => `bun --hot run ${quote(findFile(f, /\.[cm]?[jt]sx?$/, /\bBun\.serve\s*\(/)!)}`,
    reload: 'self',
    manifests: ['package.json', 'bun.lock'],
  },
  {
    id: 'deno',
    label: 'Deno',
    languageId: 'deno',
    name: 'Deno',
    language: 'TypeScript',
    docs: 'https://docs.deno.com/runtime/fundamentals/http_server/',
    tool: 'deno',
    detect: (f) => !!findFile(f, /\.[cm]?[jt]sx?$/, /\bDeno\.serve\s*\(/),
    start: (f) => `deno run --watch --allow-net --allow-env --allow-read ${quote(findFile(f, /\.[cm]?[jt]sx?$/, /\bDeno\.serve\s*\(/)!)}`,
    reload: 'self',
    manifests: ['deno.json', 'deno.lock'],
  },
  {
    id: 'node',
    label: 'Node.js',
    languageId: 'node',
    name: 'Node.js',
    language: 'JavaScript',
    docs: 'https://expressjs.com',
    tool: 'node',
    detect: (f) => /"(express|fastify|hono|koa|@hono\/node-server)"\s*:/.test(f['package.json'] ?? '') && !!nodeEntry(f),
    install: () => 'npm install --no-audit --no-fund --loglevel=error',
    start: (f) => {
      const entry = nodeEntry(f)!;
      return `node --watch${/\.[cm]?ts$/.test(entry) ? ' --experimental-strip-types' : ''} ${quote(entry)}`;
    },
    reload: 'self',
    manifests: ['package.json', 'package-lock.json'],
  },
  {
    id: 'aspnet',
    label: 'C# · ASP.NET Core',
    languageId: 'csharp',
    name: 'ASP.NET Core',
    language: 'C#',
    docs: 'https://learn.microsoft.com/aspnet/core/fundamentals/minimal-apis',
    tool: 'dotnet',
    detect: (f) => Object.entries(f).some(([p, c]) => p.endsWith('.csproj') && /Sdk="Microsoft\.NET\.Sdk\.Web"/.test(c)),
    install: () => 'dotnet build --nologo -v q',
    start: (_f, port) => `dotnet run --no-build --urls http://127.0.0.1:${port}`,
    reload: 'restart',
    manifests: [],
  },
  {
    id: 'elixir',
    label: 'Elixir · Plug',
    languageId: 'elixir',
    name: 'Plug',
    language: 'Elixir',
    docs: 'https://hexdocs.pm/plug',
    tool: 'mix',
    detect: (f) => has(f, 'mix.exs', /:bandit|:plug_cowboy/),
    install: () => 'mix local.hex --force --if-missing && mix deps.get && mix compile',
    start: () => 'mix run --no-halt',
    reload: 'restart',
    manifests: ['mix.exs', 'mix.lock'],
  },
];

/** The entry of a Node server: package.json "main", else the usual names */
export function nodeEntry(files: Record<string, string>): string | null {
  try {
    const main = JSON.parse(files['package.json'] ?? '{}').main;
    if (typeof main === 'string' && main.replace(/^\.\//, '') in files) return main.replace(/^\.\//, '');
  } catch {
    // fall back to the usual names
  }
  return ['server.js', 'index.js', 'app.js', 'server.mjs', 'index.mjs', 'src/server.js', 'src/index.js', 'server.ts', 'src/server.ts', 'src/index.ts'].find((p) => p in files) ?? null;
}

export function detectAppServer(files: Record<string, string>): AppServer | null {
  return APP_SERVERS.find((s) => s.detect(files)) ?? null;
}

/** What decides whether to install again: the manifests that changed */
export function manifestKey(server: AppServer, files: Record<string, string>): string {
  let h = 0x811c9dc5;
  const text = server.manifests.map((m) => `${m}\0${files[m] ?? ''}`).join('\0') + Object.keys(files).filter((p) => p.endsWith('.csproj')).map((p) => files[p]).join('\0');
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/** A web app the studio can serve and preview: a JavaScript framework with its dev server, or a server in any language */
export interface WebApp {
  framework: { id: string; name: string; docs: string };
  label: string;
  kind: 'framework' | 'app';
}

export function detectWebApp(files: Record<string, string>): WebApp | null {
  const js = detectFramework(files);
  if (js) return { framework: js.framework, label: js.label, kind: 'framework' };
  const app = detectAppServer(files);
  return app ? { framework: { id: app.id, name: app.name, docs: app.docs }, label: app.label, kind: 'app' } : null;
}
