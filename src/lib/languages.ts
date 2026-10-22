/**
 * The languages the studio can run besides TypeScript (scriptc) and Python
 * (uv): for each, which file types it owns, how to find its toolchain, and the
 * commands that compile and run a project. Pure data and planning, so it is
 * shared by the server (which runs the plan) and the browser (which knows what
 * is runnable and what to say when a toolchain is missing).
 */

export const OUT_DIR = '.nanocli-out';

/** One command of a run. `tool` lists alternatives (first one installed wins); each alternative is a command plus leading arguments. */
export interface LangStep {
  label: string;
  tool: string[][] | null;
  /** null `tool` means: run the program the previous step built (OUT_DIR/main) */
  args: string[];
  timeoutMs: number;
}

export interface PlanContext {
  entry: string;
  /** Every project file path (not content) */
  paths: string[];
  /** File contents, for the few decisions that need them (does package.json have dependencies?) */
  read: (path: string) => string | undefined;
  /** Whether an installed-dependencies folder (node_modules…) already exists in the project folder */
  hasDir: (name: string) => boolean;
  args: string[];
  windows: boolean;
}

export interface Language {
  id: string;
  name: string;
  extensions: string[];
  /** Monaco language id for highlighting */
  monaco: string;
  /** Alternatives to look for; the first found is shown as the toolchain */
  tools: string[][];
  /** Arguments that print the tool's version */
  versionArgs: string[];
  install: { windows: string; mac: string; linux: string };
  /** Why a project of this language might need more than a single file */
  note?: string;
  /** Top-level folders its tools generate: kept between runs, never sent back as project files */
  buildDirs?: string[];
  plan: (ctx: PlanContext) => LangStep[] | { error: string };
}

const MINUTE = 60_000;
const COMPILE = 10 * MINUTE;
const RUN = 5 * MINUTE;

const ext = (p: string) => (p.includes('.') ? p.slice(p.lastIndexOf('.')).toLowerCase() : '');
const dir = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const withExt = (paths: string[], exts: string[]) => paths.filter((p) => exts.includes(ext(p))).sort();
/** The entry first, then the other files, so the compiler sees the entry point first */
const entryFirst = (entry: string, others: string[]) => [entry, ...others.filter((p) => p !== entry)];
const runOutput = (args: string[]): LangStep => ({ label: 'run', tool: null, args, timeoutMs: RUN });
const hasDependencies = (json: string | undefined) => {
  try {
    const pkg = JSON.parse(json ?? '{}');
    return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length > 0;
  } catch {
    return false;
  }
};

export const LANGUAGES: Language[] = [
  {
    id: 'node',
    name: 'JavaScript (Node.js)',
    extensions: ['.js', '.mjs', '.cjs'],
    monaco: 'javascript',
    tools: [['node']],
    versionArgs: ['--version'],
    install: { windows: 'winget install OpenJS.NodeJS.LTS', mac: 'brew install node', linux: 'sudo apt install nodejs npm (or nodejs.org)' },
    plan: ({ entry, read, hasDir, args }) => [
      ...(hasDependencies(read('package.json')) && !hasDir('node_modules') ? [{ label: 'npm install', tool: [['npm']], args: ['install', '--no-audit', '--no-fund', '--loglevel=error'], timeoutMs: COMPILE }] : []),
      { label: `node ${entry}`, tool: [['node']], args: [entry, ...args], timeoutMs: RUN },
    ],
  },
  {
    id: 'bun',
    name: 'Bun (JavaScript / TypeScript)',
    extensions: [],
    monaco: 'typescript',
    tools: [['bun']],
    versionArgs: ['--version'],
    install: { windows: 'powershell -c "irm bun.sh/install.ps1 | iex"', mac: 'brew install oven-sh/bun/bun', linux: 'curl -fsSL https://bun.sh/install | bash' },
    note: 'Runs TypeScript directly with Bun, including npm packages. Chosen when the project has a bunfig.toml or bun.lock.',
    plan: ({ entry, read, hasDir, args }) => [
      ...(hasDependencies(read('package.json')) && !hasDir('node_modules') ? [{ label: 'bun install', tool: [['bun']], args: ['install'], timeoutMs: COMPILE }] : []),
      { label: `bun run ${entry}`, tool: [['bun']], args: ['run', entry, ...args], timeoutMs: RUN },
    ],
  },
  {
    id: 'deno',
    name: 'Deno (JavaScript / TypeScript)',
    extensions: [],
    monaco: 'typescript',
    tools: [['deno']],
    versionArgs: ['--version'],
    install: { windows: 'winget install DenoLand.Deno', mac: 'brew install deno', linux: 'curl -fsSL https://deno.land/install.sh | sh' },
    note: 'Runs TypeScript directly with Deno. Chosen when the project has a deno.json.',
    plan: ({ entry, args }) => [{ label: `deno run ${entry}`, tool: [['deno']], args: ['run', '-A', entry, ...args], timeoutMs: RUN }],
  },
  {
    id: 'go',
    name: 'Go',
    extensions: ['.go'],
    monaco: 'go',
    tools: [['go']],
    versionArgs: ['version'],
    install: { windows: 'winget install GoLang.Go', mac: 'brew install go', linux: 'sudo apt install golang (or go.dev/dl)' },
    plan: ({ entry, paths, read, args }) => {
      if (paths.includes('go.mod')) {
        return [
          ...(/^\s*require\b/m.test(read('go.mod') ?? '') ? [{ label: 'go mod tidy', tool: [['go']], args: ['mod', 'tidy'], timeoutMs: COMPILE }] : []),
          { label: 'go run', tool: [['go']], args: ['run', dir(entry) ? `./${dir(entry)}` : '.', ...args], timeoutMs: RUN },
        ];
      }
      const sources = withExt(paths, ['.go']).filter((p) => dir(p) === dir(entry) && !p.endsWith('_test.go'));
      return [{ label: 'go run', tool: [['go']], args: ['run', ...entryFirst(entry, sources), ...args], timeoutMs: RUN }];
    },
  },
  {
    id: 'rust',
    name: 'Rust',
    extensions: ['.rs'],
    monaco: 'rust',
    tools: [['cargo'], ['rustc']],
    versionArgs: ['--version'],
    install: { windows: 'winget install Rustlang.Rustup', mac: 'brew install rustup && rustup-init', linux: 'curl https://sh.rustup.rs -sSf | sh' },
    plan: ({ entry, paths, args, windows }) =>
      paths.includes('Cargo.toml')
        ? [{ label: 'cargo run', tool: [['cargo']], args: ['run', '--quiet', ...(args.length ? ['--', ...args] : [])], timeoutMs: COMPILE }]
        : [
            { label: 'rustc', tool: [['rustc']], args: ['--edition', '2021', entry, '-o', `${OUT_DIR}/main${windows ? '.exe' : ''}`], timeoutMs: COMPILE },
            runOutput(args),
          ],
  },
  {
    id: 'c',
    name: 'C',
    extensions: ['.c'],
    monaco: 'c',
    tools: [['cc'], ['gcc'], ['clang'], ['zig', 'cc']],
    versionArgs: ['--version'],
    install: { windows: 'the bundled zig works out of the box (npm install), or winget install LLVM.LLVM', mac: 'xcode-select --install', linux: 'sudo apt install build-essential' },
    plan: ({ entry, paths, args, windows }) => [
      { label: 'compile', tool: [['cc'], ['gcc'], ['clang'], ['zig', 'cc']], args: ['-O1', '-o', `${OUT_DIR}/main${windows ? '.exe' : ''}`, ...entryFirst(entry, withExt(paths, ['.c'])), '-lm'], timeoutMs: COMPILE },
      runOutput(args),
    ],
  },
  {
    id: 'cpp',
    name: 'C++',
    extensions: ['.cpp', '.cc', '.cxx'],
    monaco: 'cpp',
    tools: [['c++'], ['g++'], ['clang++'], ['zig', 'c++']],
    versionArgs: ['--version'],
    install: { windows: 'the bundled zig works out of the box (npm install), or winget install LLVM.LLVM', mac: 'xcode-select --install', linux: 'sudo apt install build-essential' },
    plan: ({ entry, paths, args, windows }) => [
      { label: 'compile', tool: [['c++'], ['g++'], ['clang++'], ['zig', 'c++']], args: ['-std=c++17', '-O1', '-o', `${OUT_DIR}/main${windows ? '.exe' : ''}`, ...entryFirst(entry, withExt(paths, ['.cpp', '.cc', '.cxx'])), '-lm'], timeoutMs: COMPILE },
      runOutput(args),
    ],
  },
  {
    id: 'zig',
    name: 'Zig',
    extensions: ['.zig'],
    monaco: 'zig',
    tools: [['zig']],
    versionArgs: ['version'],
    install: { windows: 'bundled with the studio (npm install)', mac: 'bundled with the studio (npm install)', linux: 'bundled with the studio (npm install)' },
    plan: ({ entry, args }) => [{ label: 'zig run', tool: [['zig']], args: ['run', entry, ...(args.length ? ['--', ...args] : [])], timeoutMs: COMPILE }],
  },
  {
    id: 'java',
    name: 'Java',
    extensions: ['.java'],
    monaco: 'java',
    tools: [['java']],
    versionArgs: ['-version'],
    install: { windows: 'winget install EclipseAdoptium.Temurin.21.JDK', mac: 'brew install openjdk', linux: 'sudo apt install default-jdk' },
    plan: ({ entry, paths, read, args }) => {
      const sources = withExt(paths, ['.java']);
      if (sources.length === 1) return [{ label: 'java', tool: [['java']], args: [entry, ...args], timeoutMs: COMPILE }];
      const pkg = /^\s*package\s+([\w.]+)\s*;/m.exec(read(entry) ?? '')?.[1];
      const main = `${pkg ? `${pkg}.` : ''}${base(entry).replace(/\.java$/i, '')}`;
      return [
        { label: 'javac', tool: [['javac']], args: ['-d', `${OUT_DIR}/classes`, ...sources], timeoutMs: COMPILE },
        { label: 'java', tool: [['java']], args: ['-cp', `${OUT_DIR}/classes`, main, ...args], timeoutMs: RUN },
      ];
    },
  },
  {
    id: 'kotlin',
    name: 'Kotlin',
    extensions: ['.kt'],
    monaco: 'kotlin',
    tools: [['kotlinc']],
    versionArgs: ['-version'],
    install: { windows: 'winget install JetBrains.Kotlin.Compiler', mac: 'brew install kotlin', linux: 'sdk install kotlin (sdkman.io)' },
    plan: ({ entry, paths, args }) => [
      { label: 'kotlinc', tool: [['kotlinc']], args: [...entryFirst(entry, withExt(paths, ['.kt'])), '-include-runtime', '-d', `${OUT_DIR}/app.jar`], timeoutMs: COMPILE },
      { label: 'java', tool: [['java']], args: ['-jar', `${OUT_DIR}/app.jar`, ...args], timeoutMs: RUN },
    ],
  },
  {
    id: 'csharp',
    name: 'C#',
    extensions: ['.cs'],
    monaco: 'csharp',
    tools: [['dotnet']],
    versionArgs: ['--version'],
    install: { windows: 'winget install Microsoft.DotNet.SDK.9', mac: 'brew install dotnet', linux: 'sudo apt install dotnet-sdk-9.0' },
    note: 'Needs a .csproj next to the code; the C# starter has one.',
    plan: ({ paths, args }) =>
      paths.some((p) => p.endsWith('.csproj'))
        ? [{ label: 'dotnet run', tool: [['dotnet']], args: ['run', ...(args.length ? ['--', ...args] : [])], timeoutMs: COMPILE }]
        : { error: 'C# projects need a .csproj file. Start from the C# template, or add one with `dotnet new console`.' },
  },
  {
    id: 'ruby',
    name: 'Ruby',
    extensions: ['.rb'],
    monaco: 'ruby',
    tools: [['ruby']],
    versionArgs: ['--version'],
    install: { windows: 'winget install RubyInstallerTeam.RubyWithDevKit.3.3', mac: 'brew install ruby', linux: 'sudo apt install ruby' },
    plan: ({ entry, paths, args }) =>
      paths.includes('Gemfile')
        ? [
            { label: 'bundle install', tool: [['bundle']], args: ['install', '--quiet'], timeoutMs: COMPILE },
            { label: 'bundle exec ruby', tool: [['bundle']], args: ['exec', 'ruby', entry, ...args], timeoutMs: RUN },
          ]
        : [{ label: 'ruby', tool: [['ruby']], args: [entry, ...args], timeoutMs: RUN }],
  },
  {
    id: 'php',
    name: 'PHP',
    extensions: ['.php'],
    monaco: 'php',
    tools: [['php']],
    versionArgs: ['-v'],
    install: { windows: 'winget install PHP.PHP', mac: 'brew install php', linux: 'sudo apt install php-cli' },
    plan: ({ entry, args }) => [{ label: 'php', tool: [['php']], args: [entry, ...args], timeoutMs: RUN }],
  },
  {
    id: 'lua',
    name: 'Lua',
    extensions: ['.lua'],
    monaco: 'lua',
    tools: [['lua'], ['lua5.4'], ['lua5.3'], ['luajit']],
    versionArgs: ['-v'],
    install: { windows: 'winget install DEVCOM.Lua', mac: 'brew install lua', linux: 'sudo apt install lua5.4' },
    plan: ({ entry, args }) => [{ label: 'lua', tool: [['lua'], ['lua5.4'], ['lua5.3'], ['luajit']], args: [entry, ...args], timeoutMs: RUN }],
  },
  {
    id: 'perl',
    name: 'Perl',
    extensions: ['.pl', '.pm'],
    monaco: 'perl',
    tools: [['perl']],
    versionArgs: ['-v'],
    install: { windows: 'winget install StrawberryPerl.StrawberryPerl', mac: 'preinstalled', linux: 'sudo apt install perl' },
    plan: ({ entry, args }) => [{ label: 'perl', tool: [['perl']], args: [entry, ...args], timeoutMs: RUN }],
  },
  {
    id: 'r',
    name: 'R',
    extensions: ['.r'],
    monaco: 'r',
    tools: [['Rscript']],
    versionArgs: ['--version'],
    install: { windows: 'winget install RProject.R', mac: 'brew install r', linux: 'sudo apt install r-base' },
    plan: ({ entry, args }) => [{ label: 'Rscript', tool: [['Rscript']], args: [entry, ...args], timeoutMs: RUN }],
  },
  {
    id: 'julia',
    name: 'Julia',
    extensions: ['.jl'],
    monaco: 'julia',
    tools: [['julia']],
    versionArgs: ['--version'],
    install: { windows: 'winget install julialang.juliaup', mac: 'brew install julia', linux: 'curl -fsSL https://install.julialang.org | sh' },
    plan: ({ entry, args }) => [{ label: 'julia', tool: [['julia']], args: [entry, ...args], timeoutMs: RUN }],
  },
  {
    id: 'swift',
    name: 'Swift',
    extensions: ['.swift'],
    monaco: 'swift',
    tools: [['swift']],
    versionArgs: ['--version'],
    install: { windows: 'winget install Swift.Toolchain', mac: 'xcode-select --install', linux: 'swift.org/install' },
    plan: ({ entry, args }) => [{ label: 'swift', tool: [['swift']], args: [entry, ...args], timeoutMs: COMPILE }],
  },
  {
    id: 'dart',
    name: 'Dart',
    extensions: ['.dart'],
    monaco: 'dart',
    tools: [['dart']],
    versionArgs: ['--version'],
    install: { windows: 'winget install Google.DartSDK', mac: 'brew install dart-sdk', linux: 'sudo apt install dart (dart.dev/get-dart)' },
    plan: ({ entry, args }) => [{ label: 'dart run', tool: [['dart']], args: ['run', entry, ...args], timeoutMs: COMPILE }],
  },
  {
    id: 'elixir',
    name: 'Elixir',
    extensions: ['.exs', '.ex'],
    monaco: 'elixir',
    tools: [['elixir']],
    versionArgs: ['--version'],
    install: { windows: 'winget install ElixirLang.Elixir', mac: 'brew install elixir', linux: 'sudo apt install elixir' },
    plan: ({ entry, args }) => [{ label: 'elixir', tool: [['elixir']], args: [entry, ...args], timeoutMs: RUN }],
  },
  {
    id: 'haskell',
    name: 'Haskell',
    extensions: ['.hs'],
    monaco: 'haskell',
    tools: [['runghc']],
    versionArgs: ['--version'],
    install: { windows: 'winget install Haskell.GHCup', mac: 'brew install ghcup', linux: 'curl --proto "=https" -sSf https://get-ghcup.haskell.org | sh' },
    plan: ({ entry, args }) => [{ label: 'runghc', tool: [['runghc']], args: [entry, ...args], timeoutMs: COMPILE }],
  },
  {
    id: 'bash',
    name: 'Shell (Bash)',
    extensions: ['.sh', '.bash'],
    monaco: 'shell',
    tools: [['bash']],
    versionArgs: ['--version'],
    install: { windows: 'Git for Windows (git-scm.com) provides bash', mac: 'preinstalled', linux: 'preinstalled' },
    plan: ({ entry, args }) => [{ label: 'bash', tool: [['bash']], args: [entry, ...args], timeoutMs: RUN }],
  },
  {
    id: 'scala',
    name: 'Scala',
    extensions: ['.scala', '.sc'],
    monaco: 'scala',
    tools: [['scala-cli'], ['scala']],
    versionArgs: ['version'],
    install: { windows: 'winget install VirtusLab.ScalaCLI', mac: 'brew install Virtuslab/scala-cli/scala-cli', linux: 'curl -sSLf https://scala-cli.virtuslab.org/get | sh' },
    note: 'Runs with scala-cli; the first run downloads the Scala compiler.',
    buildDirs: ['.scala-build', '.bsp'],
    plan: ({ entry, paths, args }) => [
      { label: 'scala-cli run', tool: [['scala-cli'], ['scala']], args: ['run', '--server=false', ...entryFirst(entry, withExt(paths, ['.scala'])), ...(args.length ? ['--', ...args] : [])], timeoutMs: COMPILE },
    ],
  },
  {
    id: 'clojure',
    name: 'Clojure',
    extensions: ['.clj'],
    monaco: 'clojure',
    tools: [['clojure'], ['clj']],
    versionArgs: ['--version'],
    install: { windows: 'scoop install clojure', mac: 'brew install clojure/tools/clojure', linux: 'curl -L -O https://github.com/clojure/brew-install/releases/latest/download/linux-install.sh && sudo bash linux-install.sh' },
    buildDirs: ['.cpcache'],
    plan: ({ entry, args }) => [{ label: 'clojure', tool: [['clojure'], ['clj']], args: ['-M', entry, ...args], timeoutMs: COMPILE }],
  },
  {
    id: 'groovy',
    name: 'Groovy',
    extensions: ['.groovy'],
    monaco: 'java',
    tools: [['groovy']],
    versionArgs: ['--version'],
    install: { windows: 'winget install Apache.Groovy.4', mac: 'brew install groovy', linux: 'sdk install groovy (sdkman.io)' },
    plan: ({ entry, args }) => [{ label: 'groovy', tool: [['groovy']], args: [entry, ...args], timeoutMs: COMPILE }],
  },
  {
    id: 'fsharp',
    name: 'F#',
    extensions: ['.fsx'],
    monaco: 'fsharp',
    tools: [['dotnet']],
    versionArgs: ['--version'],
    install: { windows: 'winget install Microsoft.DotNet.SDK.10', mac: 'brew install dotnet', linux: 'sudo apt install dotnet-sdk-10.0' },
    note: 'F# scripts (.fsx) run with dotnet fsi.',
    plan: ({ entry, args }) => [{ label: 'dotnet fsi', tool: [['dotnet']], args: ['fsi', '--quiet', entry, ...args], timeoutMs: COMPILE }],
  },
  {
    id: 'gleam',
    name: 'Gleam',
    extensions: ['.gleam'],
    monaco: 'rust',
    tools: [['gleam']],
    versionArgs: ['--version'],
    install: { windows: 'winget install Gleam.Gleam', mac: 'brew install gleam', linux: 'gleam.run/getting-started/installing' },
    note: 'Runs on the JavaScript target (Node.js), so no Erlang install is needed.',
    buildDirs: ['build'],
    plan: ({ paths, args }) =>
      paths.includes('gleam.toml')
        ? [{ label: 'gleam run', tool: [['gleam']], args: ['run', '--target', 'javascript', ...(args.length ? ['--', ...args] : [])], timeoutMs: COMPILE }]
        : { error: 'Gleam projects need a gleam.toml. Start from the Gleam template, or run `gleam new`.' },
  },
  {
    id: 'nim',
    name: 'Nim',
    extensions: ['.nim'],
    monaco: 'python',
    tools: [['nim']],
    versionArgs: ['--version'],
    install: { windows: 'winget install nim.nim', mac: 'brew install nim', linux: 'curl https://nim-lang.org/choosenim/init.sh -sSf | sh' },
    note: 'Nim compiles through C, so it also needs a C compiler.',
    plan: ({ entry, args }) => [{ label: 'nim r', tool: [['nim']], args: ['r', '--hints:off', `--nimcache:${OUT_DIR}/nimcache`, entry, ...args], timeoutMs: COMPILE }],
  },
  {
    id: 'crystal',
    name: 'Crystal',
    extensions: ['.cr'],
    monaco: 'ruby',
    tools: [['crystal']],
    versionArgs: ['--version'],
    install: { windows: 'winget install CrystalLang.Crystal', mac: 'brew install crystal', linux: 'curl -fsSL https://crystal-lang.org/install.sh | sudo bash' },
    plan: ({ entry, args }) => [{ label: 'crystal run', tool: [['crystal']], args: ['run', '--no-color', entry, ...(args.length ? ['--', ...args] : [])], timeoutMs: COMPILE }],
  },
  {
    id: 'odin',
    name: 'Odin',
    extensions: ['.odin'],
    monaco: 'go',
    tools: [['odin']],
    versionArgs: ['version'],
    install: { windows: 'odin-lang.org/docs/install', mac: 'brew install odin', linux: 'odin-lang.org/docs/install' },
    plan: ({ entry, args, windows }) => [
      { label: 'odin build', tool: [['odin']], args: ['build', entry, '-file', `-out:${OUT_DIR}/main${windows ? '.exe' : ''}`], timeoutMs: COMPILE },
      runOutput(args),
    ],
  },
  {
    id: 'racket',
    name: 'Racket',
    extensions: ['.rkt'],
    monaco: 'scheme',
    tools: [['racket']],
    versionArgs: ['--version'],
    install: { windows: 'winget install Racket.Racket', mac: 'brew install --cask racket', linux: 'sudo apt install racket' },
    plan: ({ entry, args }) => [{ label: 'racket', tool: [['racket']], args: [entry, ...args], timeoutMs: RUN }],
  },
  {
    id: 'd',
    name: 'D',
    extensions: ['.d'],
    monaco: 'cpp',
    tools: [['ldc2'], ['dmd']],
    versionArgs: ['--version'],
    install: { windows: 'winget install LDC.LDC', mac: 'brew install ldc', linux: 'sudo apt install ldc' },
    plan: ({ entry, paths, args, windows }) => [
      { label: 'compile', tool: [['ldc2'], ['dmd']], args: [...entryFirst(entry, withExt(paths, ['.d'])), `-of=${OUT_DIR}/main${windows ? '.exe' : ''}`, `-od=${OUT_DIR}/obj`], timeoutMs: COMPILE },
      runOutput(args),
    ],
  },
  {
    id: 'erlang',
    name: 'Erlang',
    extensions: ['.erl'],
    monaco: 'plaintext',
    tools: [['erl']],
    versionArgs: ['-noshell', '-eval', 'io:format("Erlang/OTP ~s~n", [erlang:system_info(otp_release)]), halt().'],
    install: { windows: 'winget install Erlang.ErlangOTP', mac: 'brew install erlang', linux: 'sudo apt install erlang' },
    note: 'Runs as an escript: the entry module exports main/1.',
    plan: ({ entry, args }) => [{ label: 'escript', tool: [['escript']], args: [entry, ...args], timeoutMs: RUN }],
  },
  {
    id: 'ocaml',
    name: 'OCaml',
    extensions: ['.ml'],
    monaco: 'fsharp',
    tools: [['ocaml']],
    versionArgs: ['-version'],
    install: { windows: 'winget install OCaml.opam', mac: 'brew install ocaml', linux: 'sudo apt install ocaml' },
    plan: ({ entry, args }) => [{ label: 'ocaml', tool: [['ocaml']], args: [entry, ...args], timeoutMs: RUN }],
  },
  {
    id: 'fortran',
    name: 'Fortran',
    extensions: ['.f90', '.f95', '.f03', '.f08'],
    monaco: 'plaintext',
    tools: [['gfortran'], ['flang-new'], ['flang']],
    versionArgs: ['--version'],
    install: { windows: 'winget install MSYS2.MSYS2, then pacman -S mingw-w64-ucrt-x86_64-gcc-fortran', mac: 'brew install gcc', linux: 'sudo apt install gfortran' },
    plan: ({ entry, paths, args, windows }) => [
      { label: 'compile', tool: [['gfortran'], ['flang-new'], ['flang']], args: ['-O1', '-o', `${OUT_DIR}/main${windows ? '.exe' : ''}`, ...entryFirst(entry, withExt(paths, ['.f90', '.f95', '.f03', '.f08']))], timeoutMs: COMPILE },
      runOutput(args),
    ],
  },

  // Smart contracts: building and testing them is the "run"
  {
    id: 'solidity',
    name: 'Solidity (Foundry)',
    extensions: ['.sol'],
    monaco: 'sol',
    tools: [['forge']],
    versionArgs: ['--version'],
    install: { windows: 'foundry via WSL (getfoundry.sh)', mac: 'curl -L https://foundry.paradigm.xyz | bash && foundryup', linux: 'curl -L https://foundry.paradigm.xyz | bash && foundryup' },
    note: 'Builds and tests with Foundry: contracts in src/, tests (*.t.sol) in test/. Forge downloads the solc version each contract asks for.',
    buildDirs: ['out', 'cache', 'lib'],
    plan: ({ paths }) =>
      paths.includes('foundry.toml')
        ? [
            { label: 'forge build', tool: [['forge']], args: ['build'], timeoutMs: COMPILE },
            { label: 'forge test', tool: [['forge']], args: ['test', '-vv'], timeoutMs: COMPILE },
          ]
        : { error: 'Solidity projects run with Foundry and need a foundry.toml. Start from the Solidity template.' },
  },
  {
    id: 'vyper',
    name: 'Vyper',
    extensions: ['.vy'],
    monaco: 'python',
    tools: [['vyper']],
    versionArgs: ['--version'],
    install: { windows: 'uv tool install vyper', mac: 'uv tool install vyper', linux: 'uv tool install vyper' },
    note: 'Compiles the contract and prints its ABI and bytecode.',
    plan: ({ entry }) => [{ label: 'vyper', tool: [['vyper']], args: ['-f', 'abi,bytecode', entry], timeoutMs: COMPILE }],
  },
  {
    id: 'move',
    name: 'Move (Sui)',
    extensions: ['.move'],
    monaco: 'rust',
    tools: [['sui'], ['aptos']],
    versionArgs: ['--version'],
    install: { windows: 'docs.sui.io/guides/developer/getting-started/sui-install', mac: 'brew install sui', linux: 'docs.sui.io/guides/developer/getting-started/sui-install' },
    note: 'Builds and tests a Move package (Move.toml) with the Sui CLI, or the Aptos CLI when that is what is installed.',
    buildDirs: ['build'],
    plan: ({ paths }) =>
      paths.includes('Move.toml')
        ? [
            { label: 'move build', tool: [['sui', 'move', 'build'], ['aptos', 'move', 'compile']], args: [], timeoutMs: COMPILE },
            { label: 'move test', tool: [['sui', 'move', 'test'], ['aptos', 'move', 'test']], args: [], timeoutMs: COMPILE },
          ]
        : { error: 'Move code builds as a package with a Move.toml. Start from the Move template.' },
  },
  {
    id: 'cairo',
    name: 'Cairo (Starknet)',
    extensions: ['.cairo'],
    monaco: 'rust',
    tools: [['scarb']],
    versionArgs: ['--version'],
    install: { windows: 'docs.swmansion.com/scarb/download', mac: 'curl --proto =https --tlsv1.2 -sSf https://docs.swmansion.com/scarb/install.sh | sh', linux: 'curl --proto =https --tlsv1.2 -sSf https://docs.swmansion.com/scarb/install.sh | sh' },
    note: 'Builds and runs a Scarb package (Scarb.toml).',
    plan: ({ paths }) =>
      paths.includes('Scarb.toml')
        ? [
            { label: 'scarb build', tool: [['scarb']], args: ['build'], timeoutMs: COMPILE },
            { label: 'scarb execute', tool: [['scarb']], args: ['execute', '--print-program-output'], timeoutMs: COMPILE },
          ]
        : { error: 'Cairo code builds as a Scarb package with a Scarb.toml. Start from the Cairo template.' },
  },
];

const BY_ID = new Map(LANGUAGES.map((l) => [l.id, l]));
export const getLanguage = (id: string): Language | undefined => BY_ID.get(id);

/** Extensions TypeScript (scriptc) and Python (uv) already own */
const OWNED_ELSEWHERE = new Set(['.ts', '.tsx', '.mts', '.cts', '.py']);

/**
 * Which language runs this entry file. Marker files choose between runtimes
 * that share extensions: a deno.json makes .ts/.js run on Deno, bunfig.toml or
 * bun.lock on Bun, and a package.json makes .js run on Node. Null when scriptc
 * or uv (or nothing) should handle it.
 */
export function detectLanguage(entry: string, paths: string[]): Language | null {
  const extension = ext(entry);
  const has = (name: string) => paths.some((p) => p === name || p.endsWith(`/${name}`));
  if (['.ts', '.tsx', '.js', '.mjs', '.jsx', '.mts'].includes(extension)) {
    if (has('deno.json') || has('deno.jsonc')) return BY_ID.get('deno') ?? null;
    if (has('bunfig.toml') || has('bun.lock') || has('bun.lockb')) return BY_ID.get('bun') ?? null;
  }
  if (OWNED_ELSEWHERE.has(extension)) return null;
  // Plain .js files without a package.json keep going through scriptc, as they always did
  if (['.js', '.mjs', '.cjs'].includes(extension) && !has('package.json')) return null;
  return LANGUAGES.find((l) => l.extensions.includes(extension)) ?? null;
}

/** Whether Run should go through the language runner for this entry */
export const isRunnable = (entry: string, paths: string[]): boolean => detectLanguage(entry, paths) !== null;

/** Monaco language id for a file path, if a runner language owns it */
export function monacoLanguageFor(path: string): string | null {
  const extension = ext(path);
  return LANGUAGES.find((l) => l.extensions.includes(extension))?.monaco ?? null;
}
