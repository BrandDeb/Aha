# NanoCLI Studio

> **TypeScript in. Native binary out.**

A browser IDE for building command-line tools. Write ordinary TypeScript, compile it on the server with
[scriptc](https://scriptc.dev) — Vercel Labs' TypeScript-to-native compiler — and download a single
executable that runs without Node.js.

[![CI/CD Pipeline](https://github.com/BrandDeb/Aha/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/BrandDeb/Aha/actions/workflows/ci-cd.yml)
[![scriptc](https://github.com/BrandDeb/Aha/actions/workflows/scriptc.yml/badge.svg)](https://github.com/BrandDeb/Aha/actions/workflows/scriptc.yml)
![License: Proprietary](https://img.shields.io/badge/License-Proprietary-black.svg)

---

## Quick start

Requires **Node.js 24+** (scriptc 0.2 needs it) and **clang** on the PATH for linking native executables.
WASM output (and the terminal's `run`) needs **zig** as scriptc's wasm32-wasi linker. `npm install` fetches a copy for
your platform (about 375 MB in `node_modules`), so there is nothing to install; a zig already on your PATH is used instead.

```bash
git clone https://github.com/BrandDeb/Aha.git
cd Aha
npm install
npm run dev          # http://localhost:3000 (Next.js + collaboration server)
```

Nothing needs configuring: the assistant runs on a model each user picks (see [Assistant](#assistant)).
Copy `.env.example` to `.env.local` only for GitHub sign-in or a hosted default model.

### VS Code

1. Install [Node.js 24](https://nodejs.org) and clang (macOS: `xcode-select --install`; Ubuntu/WSL:
   `sudo apt install clang lld`; Windows: use WSL). zig is bundled by `npm install`.
2. **File → Open Folder…** and pick the cloned `Aha` folder; accept the recommended extensions.
3. Open the terminal (<kbd>Ctrl</kbd>+<kbd>`</kbd>) and run `npm install`.
4. Press <kbd>F5</kbd> (**NanoCLI Studio: dev server**) — the browser opens at http://localhost:3000 with
   breakpoints working in `server.js` and the API routes. Or run the **Dev server** task
   (<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>), or `npm run dev`.

### Docker

```bash
docker compose up -d            # app, scriptc, clang/lld and zig in one image
```

---

## What's measured

On Linux x64 with scriptc 0.2.2 and Node.js 22:

| | scriptc binary | Same script on Node.js |
|---|---|---|
| Hello world on disk | 55 KB (stripped) | needs the ~118 MB Node runtime |
| Process startup | ~1.2 ms | ~30 ms |
| `fib(32)` | 13 ms | 24 ms |

Reproduce with `npm run templates:build` and the binaries in `dist/templates/`.

---

## Features

The workspace at `/` is a dark editor built around scriptc.

| Area | What it does |
|---|---|
| **Projects** | File tree with folders, create/rename/move/delete, entry file, relative imports between files, autosave to the browser |
| **Terminal** | A shell over the project (`ls cd cat mv rm tree echo > file …`). `run` compiles to WASM and executes it in a Web Worker in the tab with the project mounted; files it writes appear in the explorer |
| **Build** | Nine outputs from one menu — native, WASM, LLVM IR, scriptc IR (JSON), assembly, WASM text (WAT), object file, static library, WASM reactor — with an output viewer (highlighted text, or a hexdump for binaries), build options (release/dev, strip, dynamic engine, sanitizers, Windows window), pipeline timings, scriptc coverage and a run profile |
| **Diagnostics** | scriptc errors drawn inline in the right file with their rewrite hint, listed in Problems and counted in the tree |
| **Git** | Pull a branch, see changed files with +/− counts, side-by-side diffs, create branches, multi-file commit & push that refuses to overwrite newer commits |
| **Assistant** | Any model you choose — free tiers (Gemini, Groq, OpenRouter, Cerebras, Mistral), local (Ollama, LM Studio) or your own Anthropic/OpenAI key: explain, fix build errors, generate tests, chat — with one-click Apply that versions the previous file first |
| **Agent** | Give it a goal; it reads your project, edits a private copy, builds and runs it to check its work, and retries within a budget. You review diffs and accept or discard; see [Agent](#agent) |
| **Connectors** | MCP servers, GitHub, SQLite/PostgreSQL, web pages and search, and your own commands as agent tools, asked about before use |
| **Formatting** | Prettier in the browser, format on save, configurable rules |
| **History** | Versions on save, on successful builds and before pulls/restores/assistant edits; compare and restore |
| **Graph** | Import graph from the entry, cycle detection, unused files, unresolved imports, external modules |
| **Export** | ZIP export/import, secret GitHub Gist, share links that carry the whole project |
| **Editing** | Split view, zen mode, command palette (⌘K), remappable shortcuts with export/import, built-in extensions (minimap, word wrap, bracket pairs, sticky scroll, TODO highlights, byte field) |
| **Appearance** | Any accent colour (presets, colour picker or hex), background tone and corner radius in Settings → Appearance; the accent is adjusted automatically so text stays readable in light and dark, and the editor's syntax colours follow it |
| **Accessibility** | Light, dark and high-contrast themes; ARIA tree, tabs and dialogs with focus management; skip link; live regions for builds and toasts; reduced motion respected |
| **Python (uv)** | Python projects managed with [uv](https://docs.astral.sh/uv/): run files, add/remove/sync/lock/tree from a Packages panel or the terminal, pin a Python version, inline-script dependencies, environment variables for API keys, files your program writes land in the explorer. uv is detected, or downloaded from the official release with a checksum |
| **Templates** | Eleven TypeScript starters (CI compiles every one with scriptc) and six Python/AI starters: LLM agent with tool calling, embeddings + search (RAG), local models (Ollama), pandas data analysis, an MCP server, a single-file uv script |

Native executables are linked for the machine the server runs on. Use the WASM target (or `run`) for a
portable artifact.

---

## Assistant

The assistant costs the studio's operator nothing. Each user picks a provider and model in the assistant
panel (or **Settings → AI models**); the key is kept in their browser and requests go straight from the tab to
the provider, never through the studio server.

| Provider | Cost | Setup |
|---|---|---|
| Google Gemini | Free tier | Key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| Groq | Free tier | Key from [console.groq.com/keys](https://console.groq.com/keys) |
| OpenRouter | Free models (`:free`) | Key from [openrouter.ai/keys](https://openrouter.ai/keys) |
| Cerebras | Free tier | Key from [cloud.cerebras.ai](https://cloud.cerebras.ai) |
| Mistral | Free “Experiment” plan | Key from [console.mistral.ai](https://console.mistral.ai/api-keys) |
| Ollama | Free, local, offline | Install [ollama.com](https://ollama.com), `ollama pull qwen2.5-coder:7b` |
| LM Studio | Free, local | Start the local server with “Enable CORS” on |
| Anthropic / OpenAI | Your account | Your API key |
| Custom | — | Any OpenAI-compatible server that allows browser requests |
| Studio server | Operator pays | Shown only when `ANTHROPIC_API_KEY` is set on the server |

The model list loads by itself from each provider (OpenRouter's needs no key) and shows only chat models, free and newest
first; a saved model the provider has dropped is swapped for a current one. **Test connection** sends a one-word prompt and
reports latency. A pasted key that doesn't look like that provider's gets a hint. Ollama accepts requests from `localhost` pages by default; when the
studio is hosted elsewhere, start it with `OLLAMA_ORIGINS=https://your-studio.example ollama serve`.

---

## Agent

Type a goal into the bar at the top of the workspace (**Ctrl/⌘ + L**): "fix the build", "add tests", "add a `--help`
flag". The agent works on it in a loop with your own model (the same keys and local models as the assistant; it needs a
model that supports tool calling), and its work comes back as a **proposal**.

A proposal opens in the editor area as a tab next to your files, like a small pull request:

- **One decision at the top.** The goal, the agent's summary and **evidence** chips: did the last build pass, did the
  program run, how many attempts failed on the way, how big the change is, how many steps, how long and how many tokens.
  When the work is finished and the last check passed it is marked **Verified** and the main button is **Ship N
  changes**; otherwise it says why to look closer ("Not checked", "The last check failed", "Unfinished") and offers
  **Accept anyway**.
- **The diff, file by file**, with accept or reject per file, next to the plan, what the agent did step by step, and any
  question it is waiting on.
- **Follow-ups** ("also handle empty input") continue the same proposal.
- **Several at once.** Each proposal runs on its own private copy, so you can start another and keep coding. Proposals are
  kept across reloads; the **Agent** tab lists them all, with the model and preferences (budget, approaches, whether
  commands may run without asking).

- **It edits a private copy.** Every change the agent makes is staged, builds and runs use the staged files, and
  nothing reaches your project until you accept it, per file or all at once, after reading the diff. Accepting saves a
  **History** snapshot first, so rolling back is one click. Discarding is free.
- **It fixes in a loop, within a budget.** It reads and searches your files, writes a plan, edits, runs `build`
  (scriptc type-check) and `run_program` (WASM sandbox in the tab), reads the diagnostics and tries again. Each run has
  a step, tool-call, time and fix-attempt budget (Quick, Standard or Long); a call that keeps failing the same way is
  stopped, and when a budget runs out the model gets one last tool-free turn to say honestly what is done and what isn't.
- **It asks before anything lasting.** Python and package commands run on your machine and connector tools reach
  outside the project, so each asks first (Allow once, allow that tool for the run, or decline). Reads, staged edits and
  sandboxed builds don't need asking.
- **It keeps notes.** If the project has an `AGENTS.md`, the agent follows it, and may propose additions at the end of a
  task (a convention, a gotcha, a command that works) as an ordinary change you accept or reject. That is the whole
  "self-improving" loop: supervised, written in plain text, and reversible.

### Try several approaches (Harness²-style)

Choose **Compare 3** in the ask bar (or more in the Agent tab) and the agent improves its own *harness* while the model stays the same, an idea
from [Harness²](https://github.com/google-research/harness2) (Google Research, Apache-2.0), rebuilt here as a small, supervised loop for
coding:

1. **Propose.** A model suggests variants of the harness: project instructions (`agent/prompt.md`), tool guidance (`agent/tools.md`),
   short skills (`agent/skills/*.md`) and notes (`AGENTS.md`), each text only, never code that runs.
2. **Probe.** The agent runs your task once with the current setup and once per variant, each on its own private copy of the project.
   Runs are scored by what can be checked without a reference answer: did it finish, did the last build and run pass, how many failed
   attempts and steps. Probes can build but never run commands or reach outside.
3. **Compose.** A model reads the outcomes and keeps only edits that beat the baseline, with lessons that cite the evidence
   (`agent/lessons.md`).

Each approach is a lane in the proposal, with its score and why; the recommended lane holds the best run's changes plus the harness edits
that earned them, to review, accept or discard like any other change. The Agent tab shows the cost up front (runs × steps). If nothing beats the current setup, nothing is proposed. The harness files are part of your project, so they are
versioned with it and every later run (including normal ones) reads them.

### Connectors

**Settings → Connectors** gives the agent tools beyond the project. Their settings (and any keys) live in your browser
and travel to the studio server only with the call that needs them.

| Connector | What the agent gets |
|---|---|
| **MCP server** (local process or HTTP) | Any [Model Context Protocol](https://modelcontextprotocol.io) server's tools. Presets for filesystem, git, memory, Context7 docs and Playwright; or point it at your own, including the Python MCP template from the project list |
| **GitHub** | Search code, read files, issues and pull requests (your sign-in or a token) |
| **Web pages** | Fetch a public URL as readable text |
| **Web search** | Brave, Tavily or your own SearXNG |
| **SQLite / PostgreSQL** | Schema and read-only queries (a single `SELECT`/`WITH` statement, rows capped, read-only connection) |
| **Custom command** | Any command of yours as a tool, with named parameters passed as plain arguments (never through a shell). Always asks |

Safety model, since the agent reads untrusted text (web pages, issues, query results):

- Connector results are marked as untrusted data, and the agent is told never to follow instructions inside them or to
  put your files or keys into URLs and queries. Tools that reach outside ask first unless you tick **Don't ask before
  read-only tools** for that connector.
- Web fetching resolves the host, refuses private, loopback, link-local and metadata addresses, pins the connection to
  the address it checked, re-checks every redirect, and caps size and time.
- Connectors that run programs or read files on the server (MCP over a local process, SQLite, custom commands) work only
  when the studio listens on your own machine (the default). If it is exposed (`HOST=0.0.0.0`, as in the Docker image)
  they switch off by themselves; `NANOCLI_CONNECTORS=0` turns every connector off, `NANOCLI_CONNECTORS=1` forces them on.
- The same origin, trusted-host and rate-limit checks as the Python route apply. Processes get an allow-listed
  environment (never the server's secrets) and a private `HOME`; idle MCP sessions are closed after five minutes.

---

## Python and uv

The Python tab appears for projects with `.py` files or a `pyproject.toml`. Everything goes through uv:

```
run                       run the entry file (installs what pyproject.toml declares first)
python main.py --top 5    run a file with arguments
uv add httpx "rich>=13"   add dependencies (creates pyproject.toml if needed); --dev for dev dependencies
uv remove httpx           uv sync    uv lock [--upgrade]    uv tree    uv init [name]
uv python pin 3.12        pin a Python version; uv downloads it if it isn't installed
install-uv                download uv into ~/.nanocli/ if it isn't on your PATH
```

Each project gets its own folder and virtual environment under `~/.nanocli/python/` (set `NANOCLI_HOME` to
move it), kept between runs; uv's cache is shared. The browser stays the source of truth: it sends the project's files with each command and
gets `pyproject.toml`, `uv.lock` and any text files the program wrote back.

**This runs your code on the machine that hosts the studio.** That is the point of a local editor, so
Python is on by default, but:

- The server listens on `127.0.0.1` only (`HOST=0.0.0.0` to change it) and Python commands require a
  trusted `Host` header (localhost, the host of `NEXT_PUBLIC_BASE_URL`, or `ALLOWED_HOSTS`), which also
  defeats DNS-rebinding attacks from other websites.
- Programs run with a short allow-list of environment variables (never `ANTHROPIC_API_KEY`, the GitHub
  secrets or anything else from the server), a private `HOME`, a timeout (5 min per run, 20 min per install)
  and a 2 MB output cap; aborting kills the whole process tree.
- It is **not a sandbox**. On a shared or public server set `NANOCLI_PYTHON=0` or run the studio in a
  container. The Docker image ships with Python off, and its Alpine base can't install most AI wheels
  (torch and friends need glibc), so use a Debian-based image if you enable it there.

---

## Performance

Measured on a Linux machine over loopback with a production build (`npm run build && npm start`), so treat the figures as a
guide to proportions rather than promises:

| | |
|---|---|
| App JavaScript on first load | **187 KB** gzip (down from 247 KB: Git, Python, Agent, History, Graph, Package panels and the Settings, Templates, Project and output dialogs now load the first time you open them) |
| Code editor | ~570 KB brotli, served from this server and cached for a year (it used to come from a public CDN, which also meant no editor offline). Ready about 1.2 s after a cold load |
| First paint | ~190 ms; the page is interactive before the editor arrives |
| Server | starts serving in ~0.8 s, ~125 MB resident when idle |
| Builds | ~0.6 s for a small program (type-check + IR, WASM or native), two at a time by default (`MAX_CONCURRENT_BUILDS`) |
| Disk (`node_modules`) | ~1.6 GB, of which scriptc's compiler binaries ~410 MB, the bundled zig ~410 MB (offline WASM builds), Next.js ~200 MB and the editor ~105 MB (only its 25 MB `min/` folder is ever served) |

Things that keep it light: the studio makes no request to any third party (models are the only exception, and only the
one you choose); idle MCP sessions close after five minutes; compiled temp files, uv's cache and idle Python environments
are cleaned up (Settings → Maintenance shows and trims them); connectors, the updater and the doctor load their code only when
used. If disk matters more than offline WASM builds, remove `@zigc/*` after install (WASM builds then need zig on your `PATH`).

---

## Other languages

TypeScript compiles with scriptc and Python runs with uv; everything else runs with **its own toolchain on this machine**.
Pick **New project → Other languages** (or open any file) and press **Run**: the **Run** tab (and the terminal's `run`) show
the output, take arguments and standard input, and say exactly what to install when a toolchain is missing.

| | | |
|---|---|---|
| JavaScript (Node), TypeScript on Bun or Deno | Go (modules too) | Rust (single file or Cargo project) |
| C and C++ (your compiler, or the bundled **zig**) | Zig (bundled) | Java (single file or packages) |
| Kotlin, C# (.NET) | Ruby (Bundler), PHP, Lua, Perl | R, Julia, Swift, Dart, Elixir, Haskell, Bash |

Which engine runs a file: `.ts` is scriptc, `.py` is uv, a `deno.json` or `bunfig.toml` moves `.ts`/`.js` to Deno or Bun, a
`package.json` makes `.js` run on Node, and other extensions pick their language. `languages` in the terminal lists what this
machine has. Projects keep their dependencies and build output on the server between runs (`~/.nanocli/run/`), caches (Go,
Cargo, npm, NuGet, zig) are shared, and files a program writes come back into the explorer.

Same trust model as Python: it **runs your code on the machine hosting the studio**, so it is only on when the studio
listens on that machine alone (`NANOCLI_RUN=0` turns it off, `=1` forces it on). Programs get a short allow-list of
environment variables (never the studio's keys), a private `HOME`, a time limit per step (5 min to run, 10 to compile), a 2 MB
output cap, and stopping a run kills the whole process tree. It is not a sandbox.

Checked against the real toolchains here: Node, Bun, Go, Rust, Java, C, C++, Zig, Ruby, PHP, Perl and Bash. The starters for
Deno, Kotlin, C#, Lua, R, Julia, Swift, Dart, Elixir and Haskell are written carefully but were not run on this machine (their
tools aren't installed here), so expect to fix a typo or two the first time.

---

## Maintenance

The studio looks after itself, and asks before it changes anything.

- **Restarts itself.** `npm run dev` and `npm start` run the server under a small supervisor
  (`scripts/supervise.js`): a crash restarts it after a pause that grows to 30 s, an update restarts it at once, and a crash
  loop (more than six in two minutes) stops with a message instead of spinning. Use `npm run start:plain` to run without it;
  the Docker image leaves restarts to the container runtime.
- **Updates, with your approval.** **Settings → Maintenance** checks the git remote (at most every six hours, or **Check now**)
  and lists what is new; the footer shows `↑ N updates`. **Update now** only fast-forwards a clean checkout, reinstalls
  dependencies only if `package.json` or the lock file changed, rebuilds when the server is a production one, and puts the previous
  commit back if any step fails. Nothing updates on its own. A copy without git (or in a container) just says so.
- **Health checks.** The same tab tests the scriptc compiler with a real build, zig, a C toolchain, uv and Python, `npx`/`uvx`
  for the MCP presets, and how much disk the studio uses, and offers one-click fixes that only touch the studio's own folders
  (download uv, prune its cache, remove idle Python environments, clear build leftovers). **Copy report** gives you something to
  paste into a bug report; it holds no keys or project files.
- **Crash recovery.** If the interface crashes you get a screen that explains it instead of a blank page. It always offers a
  download of your project; after a repeat crash it also offers to reset settings and appearance, or to restore the last copy of
  the workspace that loaded and stayed up (the current one is kept aside, never deleted).
- **The agent's fix loop** is the same idea at the code level: it retries builds within a budget, stops when it is going in
  circles, and its edits are only a proposal until you accept them.

Maintenance only works when the studio listens on your own machine (the default); on an exposed server the routes refuse.

---

## Pages

| Route | |
|---|---|
| `/` | Workspace |
| `/landing` | Overview |
| `/faq` | Searchable FAQ |
| `/onboarding` | Three-step tour ending in the workspace with a template (`/?template=<id>`) |
| `/studio` | Redirects to `/` |

---

## Architecture

```
Browser ── Next.js 16 (App Router), React 19, Tailwind v4, Monaco
   │
   ├── POST /api/python     ── src/lib/python.ts ── uv ── ~/.nanocli/python/<project>/  (streamed NDJSON)
   ├── POST /api/compile   ─┐
   ├── POST /api/coverage  ─┼─ src/lib/compiler.ts ── execFile(scriptc) ── temp/  (pruned hourly)
   ├── GET  /api/download  ─┘
   ├── /api/github/*        ── GitHub REST API (OAuth token in an HTTP-only cookie)
   └── ws://…/api/ws        ── server.js collaboration relay (websocket package)
```

`server.js` is a custom Next.js server: it serves the app, routes `/api/ws` upgrades to the
collaboration relay and forwards every other upgrade (e.g. dev HMR) to Next.js.

---

## API

### `POST /api/compile`

```json
{ "code": "console.log('hi')", "filename": "app.ts", "target": "exe", "optimization": "release" }
{ "files": { "src/main.ts": "import { x } from './x'", "src/x.ts": "export const x = 1" }, "entry": "src/main.ts", "target": "wasm" }
```

- `target`: `exe` | `wasm` | `llvm` | `asm` | `obj` | `ir` | `wat` | `lib` | `reactor` (C output was removed in scriptc 0.2).
  `lib` and `reactor` are library builds driven by a `scriptc.profile.json` in the project (see the Library template)
- `optimization`: `release` | `dev` (legacy `O0`–`O3` values are mapped); `strip`, `sanitize`, `dynamic`: booleans;
  `windowsSubsystem`: `console` | `gui`. Options that don't apply to the chosen target are ignored
- The response includes `format` (`text` or `binary`, which says how to read `output`) and `target`
- `platform` / `arch`: optional; anything other than the server host is rejected for `exe`

```json
{
  "success": true,
  "filename": "3f2a…-app",
  "downloadUrl": "/api/download/3f2a…-app",
  "size": 56016,
  "durationMs": 427,
  "output": "<base64 for binaries, text for llvm/asm>",
  "diagnostics": []
}
```

Successful builds include `phases` (`queue`, `write`, `compile`, `package` with milliseconds). On failure,
`diagnostics` holds `{ file, line, column, severity, code, message, hint }` entries and `error` summarizes
the first one. A single file is limited to 512 KB, a project to 200 files / 2 MB, builds to 60 s and
`MAX_CONCURRENT_BUILDS` (default 2) at a time.

### `/api/ai` (hosted model, optional)

`GET` → `{ configured }`. `POST { action: "chat" | "explain" | "fix" | "tests", prompt, history, files, activeFile, selection?, diagnostics }`
→ streamed plain text using the server's `ANTHROPIC_API_KEY`; 503 when it isn't set. Bring-your-own-key
requests never touch this route.

### `/api/python` (uv)

`GET` → `{ enabled, uv: { version, source } | null, pythons: ["3.13.1", …] }`.
`POST { projectId, action, files, env, … }` where `action` is `run` (`entry`, `args`, `packages` for
`--with`), `add` / `remove` (`packages`, `dev`), `sync`, `lock` (`upgrade`), `init`, `tree`, `pin`
(`version`) or `install-uv`. The response is newline-delimited JSON: `{ t: "out", s: "stdout" | "stderr" |
"info", d }` as output arrives, then one `{ t: "done", code, ms, changed, removed, skipped, … }`. Package
names must be plain requirements (no URLs or paths); environment variables can't override `PATH`, `UV_*`,
`PYTHON*` or loader variables.

### `/api/connectors`

`GET` → `{ mode: "local" | "hosted" | "off", node, sqlite }`.
`POST { action: "tools" | "call", connector, tool?, args? }` → `{ ok, tools }` or `{ ok, text, isError }`. The connector's
configuration is validated on every request and travels with it; the server keeps only warm MCP sessions.

### `/api/run` (other languages)

`GET` → `{ enabled, languages: [{ id, name, available, version?, install }] }`. `POST { projectId, entry, files, args?, stdin?, env?, language? }`
streams newline-delimited JSON like `/api/python`: `{ t: "out", s, d }` lines, then `{ t: "done", code, ms, changed, removed, skipped, timedOut?, truncated?, error? }`.
Paths and environment variable names are validated; `PATH`, `HOME`, loader and toolchain variables (`GOPATH`, `CARGO_*`, `JAVA_*`…) can't be set.

### `/api/doctor` and `/api/update` (local only)

`GET /api/doctor` → `{ checks: [{ id, label, status, detail, fix? }], server }`; `POST { fix }` applies one. `GET /api/update`
→ `{ supported, behind, ahead, dirty, commits, canApply, supervised, … }` (`?refresh=1` contacts the remote);
`POST { action: "apply" }` streams `{ t: "out" }` lines then `{ t: "done", ok, from, to, restartRequired, rolledBack?, error? }`;
`POST { action: "restart" }` asks the supervisor to restart. Same-origin and trusted-host checks apply, and all of it is refused
when the server listens beyond localhost.

### `POST /api/coverage`

```json
{ "code": "…" }  →  { "success": true, "statements": 8, "static": 6, "percent": 75,
                      "blockers": [{ "count": 1, "message": "…", "code": "SC2020" }] }
```

### GitHub

```
GET    /api/github/auth                                  Start OAuth
GET    /api/github/callback                              OAuth callback
GET    /api/github/user                                  { authenticated, user }
DELETE /api/github/user                                  Sign out
GET    /api/github/repos                                 Your repositories
GET    /api/github/repos/:owner/:repo/contents?path=     List a directory
GET    /api/github/repos/:owner/:repo/file?path=         Read a file → { content, sha }
PUT    /api/github/repos/:owner/:repo/file               Commit { path, content, message?, sha? }
GET    /api/github/repos/:owner/:repo/branches           { default, branches }
POST   /api/github/repos/:owner/:repo/branches           Create { name, from }
GET    /api/github/repos/:owner/:repo/tree?branch=       Pull every text file → { sha, files, skipped }
POST   /api/github/repos/:owner/:repo/commit             Multi-file commit { branch, message, changes, expectedHead }
POST   /api/github/gists                                 Secret gist { description, files }
```

### Downloads

```
GET /api/download/<filename>
GET /api/download?filename=<filename>
```

---

## Configuration

```bash
NEXT_PUBLIC_BASE_URL=http://localhost:3000
PORT=3000

# GitHub OAuth (create an OAuth app with callback <base>/api/github/callback)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_REDIRECT_URI=http://localhost:3000/api/github/callback

# Collaboration: origins allowed to open sockets (defaults to NEXT_PUBLIC_BASE_URL;
# same-origin connections are always allowed)
WS_ALLOWED_ORIGINS=http://localhost:3000

# Assistant: optional hosted default (users can always bring their own key)
ANTHROPIC_API_KEY=
AI_REQUESTS_PER_10_MIN=30   # per client (first X-Forwarded-For hop)

# Network and Python
HOST=127.0.0.1               # interface to listen on (0.0.0.0 only behind a proxy or in a container)
ALLOWED_HOSTS=               # extra Host names allowed for Python commands, comma separated
NANOCLI_PYTHON=1             # 0 turns Python (uv) off entirely
UV_BIN=                      # path to a specific uv binary
NANOCLI_HOME=                # where Python environments and caches live (default ~/.nanocli)
NANOCLI_PY_TIMEOUT_MS=300000          # per program run
NANOCLI_PY_INSTALL_TIMEOUT_MS=1200000 # per install / sync / lock
NANOCLI_PY_JOBS=3                     # concurrent Python commands
NANOCLI_PY_REQUESTS_PER_10_MIN=120    # per client

# Connectors (agent tools: MCP, databases, web, GitHub)
NANOCLI_RUN=                 # 0 = don't run other languages, 1 = force on; unset = on only when HOST is loopback
NANOCLI_RUN_JOBS=3           # concurrent runs
NANOCLI_RUN_REQUESTS_PER_10_MIN=150
NANOCLI_CONNECTORS=          # 0 = off, 1 = force on; unset = on only when HOST is loopback
NANOCLI_CONNECTOR_CALLS_PER_10_MIN=400  # per client

# Compiler
MAX_CONCURRENT_BUILDS=2
SCRIPTC_LINKER=          # optional: linker driver scriptc uses for executables
```

---

## Scripts

| Command | |
|---|---|
| `npm run dev` | Custom server in development (Next.js + collaboration), supervised: restarts after a crash |
| `npm run build` | Production build |
| `npm start` | Production server, supervised |
| `npm run start:plain` | Production server without the supervisor (containers, process managers) |
| `npm run lint` | ESLint |
| `npm run typecheck` | Generate route types and run `tsc` |
| `npm test` | Unit + scriptc and uv integration tests (`node --test`) |
| `NANOCLI_TEST_NETWORK=1 npm test` | Also installs real packages from PyPI and runs every Python template against fake local LLM servers |
| `npm run templates:build` | Compile every template to `dist/templates/` |
| `npm run templates:wasm` | Same, plus WASM modules (uses the bundled zig) |
| `npm run clean` | Remove `temp/`, `.next/` and `dist/` |

---

## Project structure

```
src/
├── app/                         Pages and API routes (compile, coverage, download, ai, github, ws)
├── components/                  CodeEditor (Monaco + themes + markers), ByteField, SiteHeader
├── workspace/
│   ├── Workspace.tsx            Layout, commands, shortcuts, build/run actions
│   ├── store.tsx                Project, tabs, Git link, history, settings (localStorage)
│   ├── project.ts               Pure helpers: tree, paths, git status, import graph, keybindings
│   ├── wasi.worker.ts           Runs WASI modules off the main thread
│   ├── components/              FileTree, Terminal, CommandPalette, SettingsDialog, dialogs
│   └── panels/                  Build, Git, Assistant, History, Graph, Package
└── lib/                         compiler, zig, python, uv-install, host (server); compiler-browser; github, ai, ai-providers; templates, python-templates
scripts/build-templates.ts       Builds every template with scriptc
tests/                           node:test suites (unit + scriptc integration)
server.js                        Custom server + WebSocket relay
```

---

## Contributing

Contributions are by invitation. Run `npm run lint && npm run typecheck && npm test` before opening a
pull request; contributions are assigned to the owner (see [LICENSE](LICENSE), section 4).

New templates go in `src/lib/templates.ts`; the test suite compiles each one with scriptc, so keep them
inside scriptc's supported surface (narrow `catch` bindings, no `eval`, ES modules).

## License

Proprietary — Copyright © 2026 BrandDeb. All rights reserved. No use, copying, modification or
distribution is permitted without a written agreement; see [LICENSE](LICENSE). Third-party components
(scriptc, Next.js, React, Monaco Editor and others) remain under their own licenses.
