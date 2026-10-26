/**
 * What a project is built with, for CI: the toolchain to set up, how to install
 * dependencies, and the checks worth running (lint, typecheck, test, build),
 * read from the project's own files (package.json scripts, pyproject.toml,
 * go.mod, Cargo.toml…). Pure, so the browser and the tests share it.
 */

import { detectFramework, packageManagerFor, parsePackageJson, type PackageManager } from '../frameworks.ts';

/** One GitHub Actions step that sets up a toolchain */
export interface SetupStep {
  name: string;
  uses: string;
  with?: Record<string, string | number | boolean>;
}

export interface Check {
  id: 'lint' | 'format' | 'typecheck' | 'test' | 'build';
  label: string;
  run: string;
}

export interface Stack {
  id: string;
  /** "Node.js · npm", "Python · uv", "Go" */
  name: string;
  setup: SetupStep[];
  /** Commands that install dependencies */
  install: string[];
  checks: Check[];
  /** Container image for GitLab CI, and what to add to it first */
  image: string;
  gitlabSetup?: string[];
  /** Where a static site's build ends up, when the project is one (GitHub Pages, Netlify) */
  staticDir?: string;
  /** Builds a single binary (Go, Rust, scriptc), which a release can attach; `ext` is ".exe" on Windows */
  binary?: { build: (name: string, ext: string) => string; output: (name: string, ext: string) => string };
  /** Hints shown next to the generated file */
  notes: string[];
}

/** Action versions, in one place so they are easy to move forward */
export const ACTIONS = {
  checkout: 'actions/checkout@v7',
  node: 'actions/setup-node@v7',
  python: 'actions/setup-python@v7',
  uv: 'astral-sh/setup-uv@v7',
  go: 'actions/setup-go@v7',
  java: 'actions/setup-java@v6',
  dotnet: 'actions/setup-dotnet@v6',
  rust: 'dtolnay/rust-toolchain@stable',
  bun: 'oven-sh/setup-bun@v2',
  deno: 'denoland/setup-deno@v2',
  pnpm: 'pnpm/action-setup@v6',
  ruby: 'ruby/setup-ruby@v1',
  php: 'shivammathur/setup-php@v2',
  beam: 'erlef/setup-beam@v1',
  dart: 'dart-lang/setup-dart@v1',
  foundry: 'foundry-rs/foundry-toolchain@v1',
  zig: 'mlugg/setup-zig@v2',
  uploadArtifact: 'actions/upload-artifact@v7',
  configurePages: 'actions/configure-pages@v6',
  uploadPages: 'actions/upload-pages-artifact@v5',
  deployPages: 'actions/deploy-pages@v5',
  dockerLogin: 'docker/login-action@v4',
  dockerBuildx: 'docker/setup-buildx-action@v4',
  dockerBuild: 'docker/build-push-action@v7',
  flyctl: 'superfly/flyctl-actions/setup-flyctl@master',
  release: 'softprops/action-gh-release@v3',
} as const;

const has = (files: Record<string, string>, ...names: string[]) => names.some((n) => n in files);
const anyPath = (files: Record<string, string>, test: (p: string) => boolean) => Object.keys(files).some(test);
const DEFAULT_TEST = /no test specified/;

/** Node.js version: .nvmrc / .node-version, then engines.node, else the current LTS line */
function nodeVersion(files: Record<string, string>, engines?: string): string {
  const pinned = (files['.nvmrc'] ?? files['.node-version'])?.trim().replace(/^v/, '');
  if (pinned && /^[\w.*-]+$/.test(pinned)) return pinned;
  const major = engines?.match(/(\d{2})/)?.[1];
  return major ?? '24';
}

const RUNNER: Record<PackageManager, { install: (locked: boolean) => string; run: (script: string) => string; lock: string }> = {
  npm: { install: (locked) => (locked ? 'npm ci' : 'npm install --no-audit --no-fund'), run: (s) => `npm run ${s}`, lock: 'package-lock.json' },
  pnpm: { install: (locked) => `pnpm install${locked ? ' --frozen-lockfile' : ''}`, run: (s) => `pnpm run ${s}`, lock: 'pnpm-lock.yaml' },
  yarn: { install: (locked) => `yarn install${locked ? ' --frozen-lockfile' : ''}`, run: (s) => `yarn run ${s}`, lock: 'yarn.lock' },
  bun: { install: (locked) => `bun install${locked ? ' --frozen-lockfile' : ''}`, run: (s) => `bun run ${s}`, lock: 'bun.lock' },
};

/** Where each framework writes a static build (only those that produce one by default) */
const STATIC_DIRS: Record<string, string> = { vite: 'dist', astro: 'dist' };

function nodeStack(files: Record<string, string>): Stack | null {
  const pkg = parsePackageJson(files['package.json']) as (ReturnType<typeof parsePackageJson> & { engines?: { node?: string }; name?: string }) | null;
  if (!pkg) return null;
  const scripts = pkg.scripts ?? {};
  const allScripts = Object.values(scripts).join('\n');
  const pm = packageManagerFor(files);
  const runner = RUNNER[pm];
  const locked = pm === 'bun' ? has(files, 'bun.lock', 'bun.lockb') : runner.lock in files;
  const notes: string[] = [];

  // A scriptc project: package.json is only there for its build script
  if (/\bscriptc\b/.test(allScripts) && !Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length) return scriptcStack(files, scripts);

  const setup: SetupStep[] = [];
  if (pm === 'bun') setup.push({ name: 'Set up Bun', uses: ACTIONS.bun });
  else {
    if (pm === 'pnpm') setup.push({ name: 'Set up pnpm', uses: ACTIONS.pnpm });
    setup.push({ name: 'Set up Node.js', uses: ACTIONS.node, with: { 'node-version': nodeVersion(files, pkg.engines?.node), ...(locked ? { cache: pm } : {}) } });
  }
  if (!locked) notes.push(`No ${runner.lock} yet: CI installs the latest matching versions. Commit a lockfile for repeatable builds.`);

  const checks: Check[] = [];
  const pick = (id: Check['id'], label: string, names: string[]) => {
    const name = names.find((n) => scripts[n] && !(id === 'test' && DEFAULT_TEST.test(scripts[n])));
    if (name) checks.push({ id, label, run: runner.run(name) });
  };
  pick('lint', 'Lint', ['lint']);
  pick('format', 'Check formatting', ['format:check', 'fmt:check', 'prettier:check']);
  pick('typecheck', 'Typecheck', ['typecheck', 'type-check', 'check-types', 'tsc']);
  if (!checks.some((c) => c.id === 'typecheck') && 'tsconfig.json' in files && !scripts.build?.includes('tsc')) checks.push({ id: 'typecheck', label: 'Typecheck', run: pm === 'bun' ? 'bunx tsc --noEmit' : 'npx tsc --noEmit' });
  pick('test', 'Test', ['test', 'test:ci', 'test:unit']);
  pick('build', 'Build', ['build']);
  if (!checks.length) notes.push('package.json has no lint, test or build scripts, so CI only installs dependencies. Add scripts and regenerate.');

  const web = detectFramework(files);
  const staticDir = web ? STATIC_DIRS[web.framework.id] : undefined;
  const name = `${web ? web.label : pm === 'bun' ? 'Bun' : 'Node.js'} · ${pm}`;
  return {
    id: pm === 'bun' ? 'bun' : 'node',
    name,
    setup,
    install: [runner.install(locked)],
    checks,
    ...(pm === 'pnpm' || pm === 'yarn' ? { gitlabSetup: ['corepack enable'] } : {}),
    image: pm === 'bun' ? 'oven/bun:1' : `node:${nodeVersion(files, pkg.engines?.node).replace(/[^\d].*$/, '') || '24'}`,
    ...(staticDir && scripts.build ? { staticDir } : {}),
    notes,
  };
}

function scriptcStack(files: Record<string, string>, scripts: Record<string, string> = {}): Stack {
  const entry = ['src/main.ts', 'main.ts', 'src/index.ts', 'index.ts'].find((f) => f in files) ?? Object.keys(files).find((f) => /\.ts$/.test(f) && !f.endsWith('.d.ts')) ?? 'src/main.ts';
  const build = scripts.build && /\bscriptc\b/.test(scripts.build) ? `npx --yes ${scripts.build.replace(/^scriptc\b/, 'scriptc@0.2.2')}` : `npx --yes scriptc@0.2.2 build ${entry} -o app`;
  return {
    id: 'scriptc',
    name: 'TypeScript · scriptc',
    setup: [{ name: 'Set up Node.js', uses: ACTIONS.node, with: { 'node-version': '24' } }],
    install: [],
    checks: [{ id: 'build', label: 'Build (type-check and compile)', run: build }],
    image: 'node:24',
    binary: { build: (name, ext) => `npx --yes scriptc@0.2.2 build ${entry} -o ${name}${ext}`, output: (name, ext) => `${name}${ext}` },
    notes: ['scriptc type-checks while it compiles, so the build is also the typecheck.'],
  };
}

function pythonStack(files: Record<string, string>): Stack | null {
  const pyproject = files['pyproject.toml'];
  if (!pyproject && !has(files, 'requirements.txt', 'uv.lock') && !anyPath(files, (p) => p.endsWith('.py'))) return null;
  const text = `${pyproject ?? ''}\n${files['requirements.txt'] ?? ''}\n${files['requirements-dev.txt'] ?? ''}`;
  const usesUv = !!pyproject || 'uv.lock' in files;
  const hasTests = anyPath(files, (p) => /(^|\/)(tests?\/.*|test_[^/]*|[^/]*_test)\.py$/.test(p));
  const checks: Check[] = [];
  const run = (cmd: string) => (usesUv ? `uv run ${cmd}` : cmd);
  if (/\bruff\b/.test(text) || 'ruff.toml' in files || /\[tool\.ruff/.test(text)) checks.push({ id: 'lint', label: 'Lint', run: usesUv ? 'uvx ruff check .' : 'ruff check .' });
  if (/\bmypy\b/.test(text)) checks.push({ id: 'typecheck', label: 'Typecheck', run: run('mypy .') });
  else if (/\bpyright\b/.test(text)) checks.push({ id: 'typecheck', label: 'Typecheck', run: run('pyright') });
  if (hasTests) checks.push({ id: 'test', label: 'Test', run: /\bpytest\b/.test(text) ? run('pytest') : usesUv ? 'uv run --with pytest pytest' : 'python -m pytest' });
  if (pyproject && /\[build-system\]/.test(pyproject)) checks.push({ id: 'build', label: 'Build', run: 'uv build' });
  if (!checks.length) {
    const entry = ['main.py', 'app.py', 'src/main.py'].find((f) => f in files);
    checks.push(entry ? { id: 'build', label: 'Byte-compile', run: usesUv ? 'uv run python -m compileall -q .' : 'python -m compileall -q .' } : { id: 'build', label: 'Byte-compile', run: 'python -m compileall -q .' });
  }
  const version = files['.python-version']?.trim() || pyproject?.match(/requires-python\s*=\s*"[>=~^]*\s*(3\.\d+)/)?.[1] || '3.13';
  return {
    id: 'python',
    name: usesUv ? 'Python · uv' : 'Python · pip',
    setup: usesUv ? [{ name: 'Set up uv', uses: ACTIONS.uv, with: { 'python-version': version, 'enable-cache': true } }] : [{ name: 'Set up Python', uses: ACTIONS.python, with: { 'python-version': version, cache: 'pip' } }],
    install: usesUv ? [pyproject ? `uv sync${'uv.lock' in files ? ' --locked' : ''}` : 'uv pip install -r requirements.txt'] : has(files, 'requirements.txt') ? ['pip install -r requirements.txt'] : [],
    checks,
    image: usesUv ? `ghcr.io/astral-sh/uv:python${version}-bookworm-slim` : `python:${version}`,
    notes: hasTests ? [] : ['No tests found (tests/ or test_*.py), so CI only checks that the code compiles.'],
  };
}

const simple = (stack: Omit<Stack, 'notes'> & { notes?: string[] }): Stack => ({ notes: [], ...stack });

/** Every stack in the project, the main one first (a web app with a Python API gives two) */
export function detectStacks(files: Record<string, string>): Stack[] {
  const stacks: Stack[] = [];
  const add = (s: Stack | null) => s && !stacks.some((x) => x.id === s.id) && stacks.push(s);

  if ('deno.json' in files || 'deno.jsonc' in files) {
    add(simple({ id: 'deno', name: 'Deno', setup: [{ name: 'Set up Deno', uses: ACTIONS.deno, with: { 'deno-version': 'v2.x' } }], install: [], image: 'denoland/deno:latest', checks: [{ id: 'lint', label: 'Lint', run: 'deno lint' }, { id: 'format', label: 'Check formatting', run: 'deno fmt --check' }, { id: 'test', label: 'Test', run: 'deno test --allow-all' }] }));
  }
  if ('foundry.toml' in files) {
    add(simple({ id: 'foundry', name: 'Solidity · Foundry', setup: [{ name: 'Set up Foundry', uses: ACTIONS.foundry }], install: [], image: 'ghcr.io/foundry-rs/foundry:latest', checks: [{ id: 'format', label: 'Check formatting', run: 'forge fmt --check' }, { id: 'build', label: 'Build', run: 'forge build --sizes' }, { id: 'test', label: 'Test', run: 'forge test -vvv' }] }));
  }
  if ('package.json' in files) add(nodeStack(files));
  if ('go.mod' in files) {
    const version = files['go.mod'].match(/^go (\d+\.\d+)/m)?.[1] ?? 'stable';
    add(simple({ id: 'go', name: 'Go', setup: [{ name: 'Set up Go', uses: ACTIONS.go, with: { 'go-version': version === 'stable' ? 'stable' : version } }], install: ['go mod download'], image: `golang:${version === 'stable' ? 'latest' : version}`, checks: [{ id: 'lint', label: 'Vet', run: 'go vet ./...' }, { id: 'test', label: 'Test', run: 'go test -race ./...' }, { id: 'build', label: 'Build', run: 'go build ./...' }], binary: { build: (name, ext) => `go build -trimpath -ldflags="-s -w" -o ${name}${ext} .`, output: (name, ext) => `${name}${ext}` } }));
  }
  if ('Cargo.toml' in files) {
    const crate = files['Cargo.toml'].match(/^\[package\][^[]*?^name\s*=\s*"([^"]+)"/m)?.[1] ?? 'app';
    add(simple({ id: 'rust', name: 'Rust', setup: [{ name: 'Set up Rust', uses: ACTIONS.rust, with: { components: 'clippy, rustfmt' } }], install: [], image: 'rust:latest', gitlabSetup: ['rustup component add clippy rustfmt'], checks: [{ id: 'format', label: 'Check formatting', run: 'cargo fmt --all -- --check' }, { id: 'lint', label: 'Clippy', run: 'cargo clippy --all-targets -- -D warnings' }, { id: 'test', label: 'Test', run: 'cargo test' }, { id: 'build', label: 'Build', run: 'cargo build --release' }], binary: { build: () => 'cargo build --release', output: (_name, ext) => `target/release/${crate}${ext}` } }));
  }
  if ('pom.xml' in files) {
    add(simple({ id: 'maven', name: 'Java · Maven', setup: [{ name: 'Set up Java', uses: ACTIONS.java, with: { distribution: 'temurin', 'java-version': '21', cache: 'maven' } }], install: [], image: 'maven:3-eclipse-temurin-21', checks: [{ id: 'build', label: 'Build and test', run: has(files, 'mvnw') ? './mvnw -B verify' : 'mvn -B verify' }] }));
  } else if (has(files, 'build.gradle', 'build.gradle.kts')) {
    add(simple({ id: 'gradle', name: 'JVM · Gradle', setup: [{ name: 'Set up Java', uses: ACTIONS.java, with: { distribution: 'temurin', 'java-version': '21', cache: 'gradle' } }], install: [], image: 'gradle:jdk21', checks: [{ id: 'build', label: 'Build and test', run: has(files, 'gradlew') ? './gradlew build' : 'gradle build' }] }));
  }
  if (anyPath(files, (p) => /\.(csproj|fsproj|sln)$/.test(p))) {
    // The SDK the projects target (net10.0 → 10.0.x), and the test project when tests live in their own
    const projects = Object.keys(files).filter((p) => /\.(csproj|fsproj)$/.test(p));
    const major = Math.max(9, ...projects.map((p) => Number(files[p].match(/<TargetFrameworks?>\s*net(\d+)\./)?.[1] ?? 0)));
    const testProject = projects.find((p) => p.includes('/') && /<PackageReference\s+Include="(xunit|NUnit|MSTest\.TestFramework|Microsoft\.NET\.Test\.Sdk)"/i.test(files[p]));
    const solution = anyPath(files, (p) => !p.includes('/') && p.endsWith('.sln'));
    const test = testProject && !solution ? `dotnet test ${testProject.slice(0, testProject.lastIndexOf('/'))} -c Release` : 'dotnet test --no-build -c Release';
    add(simple({ id: 'dotnet', name: '.NET', setup: [{ name: 'Set up .NET', uses: ACTIONS.dotnet, with: { 'dotnet-version': `${major}.0.x` } }], install: ['dotnet restore'], image: `mcr.microsoft.com/dotnet/sdk:${major}.0`, checks: [{ id: 'format', label: 'Check formatting', run: 'dotnet format --verify-no-changes' }, { id: 'build', label: 'Build', run: 'dotnet build --no-restore -c Release' }, { id: 'test', label: 'Test', run: test }] }));
  }
  if ('Gemfile' in files) {
    const checks: Check[] = [];
    if (/rubocop/.test(files.Gemfile)) checks.push({ id: 'lint', label: 'Lint', run: 'bundle exec rubocop' });
    checks.push(anyPath(files, (p) => p.startsWith('spec/')) ? { id: 'test', label: 'Test', run: 'bundle exec rspec' } : { id: 'test', label: 'Test', run: 'bundle exec rake test' });
    add(simple({ id: 'ruby', name: 'Ruby', setup: [{ name: 'Set up Ruby', uses: ACTIONS.ruby, with: { 'ruby-version': files['.ruby-version']?.trim() || '3.4', 'bundler-cache': true } }], install: ['bundle install'], image: 'ruby:3.4', checks }));
  }
  if ('composer.json' in files) {
    add(simple({ id: 'php', name: 'PHP · Composer', setup: [{ name: 'Set up PHP', uses: ACTIONS.php, with: { 'php-version': '8.4', tools: 'composer' } }], install: ['composer install --no-interaction --prefer-dist'], image: 'composer:2', checks: has(files, 'phpunit.xml', 'phpunit.xml.dist') ? [{ id: 'test', label: 'Test', run: 'vendor/bin/phpunit' }] : [{ id: 'lint', label: 'Validate', run: 'composer validate --strict' }] }));
  }
  if ('mix.exs' in files) {
    add(simple({ id: 'elixir', name: 'Elixir', setup: [{ name: 'Set up Elixir', uses: ACTIONS.beam, with: { 'elixir-version': '1.18', 'otp-version': '27' } }], install: ['mix deps.get'], image: 'elixir:1.18', gitlabSetup: ['mix local.hex --force', 'mix local.rebar --force'], checks: [{ id: 'format', label: 'Check formatting', run: 'mix format --check-formatted' }, { id: 'test', label: 'Test', run: 'mix test' }] }));
  }
  if ('pubspec.yaml' in files) {
    add(simple({ id: 'dart', name: 'Dart', setup: [{ name: 'Set up Dart', uses: ACTIONS.dart }], install: ['dart pub get'], image: 'dart:stable', checks: [{ id: 'lint', label: 'Analyze', run: 'dart analyze' }, { id: 'test', label: 'Test', run: 'dart test' }] }));
  }
  if ('build.zig' in files) {
    add(simple({ id: 'zig', name: 'Zig', setup: [{ name: 'Set up Zig', uses: ACTIONS.zig }], install: [], image: 'alpine:latest', gitlabSetup: ['apk add --no-cache zig'], checks: [{ id: 'build', label: 'Build', run: 'zig build' }, { id: 'test', label: 'Test', run: 'zig build test' }] }));
  } else if (anyPath(files, (p) => p.endsWith('.zig'))) {
    // No build.zig: test and compile the entry file directly (test blocks in the files it imports run too)
    const entry = ['src/main.zig', 'main.zig'].find((p) => p in files) ?? Object.keys(files).find((p) => p.endsWith('.zig'))!;
    add(simple({ id: 'zig', name: 'Zig', setup: [{ name: 'Set up Zig', uses: ACTIONS.zig }], install: [], image: 'alpine:latest', gitlabSetup: ['apk add --no-cache zig'], checks: [{ id: 'format', label: 'Check formatting', run: 'zig fmt --check .' }, { id: 'test', label: 'Test', run: `zig test ${entry}` }, { id: 'build', label: 'Build', run: `zig build-exe ${entry} -O ReleaseSafe` }] }));
  }
  if ('Package.swift' in files) {
    add(simple({ id: 'swift', name: 'Swift', setup: [], install: [], image: 'swift:latest', notes: ['GitHub’s Ubuntu runners come with Swift, so there is no setup step.'], checks: [{ id: 'build', label: 'Build', run: 'swift build' }, { id: 'test', label: 'Test', run: 'swift test' }] }));
  }
  if (!has(files, 'pom.xml', 'build.gradle', 'build.gradle.kts') && anyPath(files, (p) => p.endsWith('.kt'))) {
    // Kotlin without Gradle: the compiler on its own (GitHub's Ubuntu runners have kotlinc); a test/ program with its own main is the test
    const sources = anyPath(files, (p) => p.startsWith('src/')) ? 'src' : '.';
    const testMain = Object.keys(files).find((p) => /^test\/\w+\.kt$/.test(p) && /^fun main\(/m.test(files[p]))?.slice(5, -3);
    add(simple({ id: 'kotlin', name: 'Kotlin', setup: [{ name: 'Set up Java', uses: ACTIONS.java, with: { distribution: 'temurin', 'java-version': '21' } }], install: [], image: 'zenika/kotlin:latest', checks: [{ id: 'build', label: 'Build', run: `kotlinc ${sources} -include-runtime -d build/app.jar` }, ...(testMain ? [{ id: 'test' as const, label: 'Test', run: `kotlinc ${sources} test -include-runtime -d build/test.jar && java -cp build/test.jar ${testMain}Kt` }] : [])] }));
  }
  if ('CMakeLists.txt' in files) {
    add(simple({ id: 'cmake', name: 'C/C++ · CMake', setup: [], install: [], image: 'gcc:latest', gitlabSetup: ['apt-get update -qq && apt-get install -y -qq cmake'], checks: [{ id: 'build', label: 'Configure and build', run: 'cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build' }, { id: 'test', label: 'Test', run: 'ctest --test-dir build --output-on-failure' }] }));
  } else if ('Makefile' in files) {
    add(simple({ id: 'make', name: 'Make', setup: [], install: [], image: 'gcc:latest', checks: [{ id: 'build', label: 'Build', run: 'make' }, ...(/^test:/m.test(files.Makefile) ? [{ id: 'test' as const, label: 'Test', run: 'make test' }] : [])] }));
  }
  if (has(files, 'pyproject.toml', 'requirements.txt', 'uv.lock') || (!stacks.length && anyPath(files, (p) => p.endsWith('.py')))) add(pythonStack(files));
  // A bare TypeScript project is a scriptc one (the studio's default)
  if (!stacks.length && anyPath(files, (p) => /\.ts$/.test(p) && !p.endsWith('.d.ts'))) add(scriptcStack(files));
  // Plain HTML: a static site as it is
  if (!stacks.length && 'index.html' in files) add(simple({ id: 'static', name: 'Static site', setup: [], install: [], image: 'alpine:latest', checks: [], staticDir: '.' }));
  return stacks;
}
