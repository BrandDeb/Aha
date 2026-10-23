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
| **Terminal** | Built-in commands over the project (`ls cd cat mv rm tree echo > file …`, `run`) plus a real shell: anything else (`npm test`, `go test ./...`, `cargo build`, `make`, pipes and `&&`) runs in the project's folder on your machine, and files it changes come back into the editor. `sh …` or `!…` forces the real shell |
| **Layout** | The side panel has four groups: Run (Build, Language, Python, Packages), Agent (Do, Ask, Keep going), Source (Git, Pipelines, History) and Project (Graph, Kit). Run takes program arguments in the field beside it; a program that answers with its usage gets a hint instead of a failure. The status bar shows the branch, the last build and run, the current failure, the agent and the worker, each one click from its panel. A first visit gets a one-minute welcome (what you're building, a model, GitHub) |
| **Build** | Nine outputs from one menu — native, WASM, LLVM IR, scriptc IR (JSON), assembly, WASM text (WAT), object file, static library, WASM reactor — with an output viewer (highlighted text, or a hexdump for binaries), build options (release/dev, strip, dynamic engine, sanitizers, Windows window), pipeline timings, scriptc coverage and a run profile |
| **Create** | One place to start: **describe** an app in plain words and get a plan (language, stack and why) that the agent builds while you review; a **gallery** of 23 apps (dashboards, trackers, landing pages, APIs, games, AI chat) each on the stack that suits it and many in several languages; a **stack builder** (framework, styling, UI kit, data, routing, state, forms, testing, lint, API and database) that writes every dependency into package.json or pyproject.toml and wires each one into working code; and every template and field kit. See [Create](#create) |
| **Live values** | Turn on **Live** above the editor and the entry file (TypeScript, JavaScript or Python) runs after each pause in typing: every line shows what it did, right after the code — the values it set (`sum = 3, 7, 12 ×3` for a loop), what it returned, what it printed and the error it threw — and lines that never ran fade. Hover a line for every value. Local only, like Run; see [Live values](#live-values) |
| **Contracts** | Rules that stay true, written in words and checked by a pattern or a command ("no console.log in src", "every route checks the session", "the tests pass"). The agent is told every one and checks them before it finishes, a proposal that breaks one is never marked verified, the worker fixes broken ones, and the status bar shows how they stand; see [Contracts](#contracts) |
| **Diagnostics** | scriptc errors drawn inline in the right file with their rewrite hint, listed in Problems and counted in the tree |
| **Git** | Pull a branch, see changed files with +/− counts, side-by-side diffs, create branches, multi-file commit & push that refuses to overwrite newer commits |
| **Pipelines** | CI/CD from the project: GitHub Actions or GitLab CI with lint, test and build, deploys (Pages, containers, Vercel, Netlify, Fly.io, release binaries), run locally before you push (or on every save: "works here = works in CI" in the status bar), GitHub run status in the Git tab, failures fixed by the agent; see [DevOps](#devops-pipelines-in-the-studio) |
| **Assistant** | Any model you choose — free tiers (Gemini, Groq, OpenRouter, Cerebras, Mistral), local (Ollama, LM Studio) or your own Anthropic/OpenAI key: explain, fix build errors, generate tests, chat — with one-click Apply that versions the previous file first |
| **Agent** | Give it a goal; it reads your project, edits a private copy, builds and runs it to check its work, and retries within a budget. You review diffs and accept or discard; see [Agent](#agent) |
| **Field kits** | A project plus its playbook, setup, checks and agent house rules, shared as one file; three built in for FDE and ISV work; see [Field kits](#field-kits) |
| **Skills** | Agent Skills (`SKILL.md`), the format Claude uses: 15 built in, install any from GitHub, or write your own; loaded on demand; see [Skills](#skills-what-the-agent-knows-how-to-do) |
| **Worker** | An AI teammate that codes alongside you: fixes failures and editor errors, resolves TODOs, adds tests and takes the next step toward your goal, on its own while you pause (Autonomous) or when you say (Suggest); see [the worker](#the-worker-an-ai-teammate-that-codes-alongside-you) |
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
| **Project templates** | A real project per language (Node.js, Python, Go, Rust, Java, Ruby, PHP, C, C++): a library and a CLI with unit tests in the language's usual framework (node:test, pytest, go test, cargo test, JUnit, Minitest, PHPUnit, make, CTest) and a CI workflow. Run works straight away; the Pipelines tab runs the tests. `npm run verify:templates` runs every one for real |

Native executables are linked for the machine the server runs on. Use the WASM target (or `run`) for a
portable artifact.

---

## Create

**Create** (the button under the file tree, or Ctrl/⌘ + K → Create) is where every project starts. Your current
project is kept in History, so trying something costs nothing.

- **Describe it.** Write what you want ("an expense tracker that saves to a database, with charts by category").
  The studio picks the language and stack by readable rules, not a model, so the plan is instant, free and
  explained line by line: Python for data and AI, Astro for content sites, a TypeScript binary for CLIs, React with
  shadcn/ui for interactive apps, a Hono API and Drizzle + SQLite when it needs to save things, Recharts for charts,
  and so on. A language or library you name always wins ("…in Go", "…with Vue and Bootstrap"). **Create and build
  it** makes the starter and hands the agent a brief; its work arrives as a proposal you review. **Create the
  starter only** if you'd rather write it yourself, and **Adjust the stack** to change any choice first.
- **Gallery.** 23 apps people actually build (Kanban, notes, habits, admin dashboard, expenses, invoices, landing
  page, blog, portfolio, AI chat, agent, data report, REST API, URL shortener, live chat, CLI, scraper, weather,
  Pomodoro, quiz, Snake, recipes, an ERC-20 token), each with why its stack fits. Many come in several languages: the
  todo app in 12, the REST API in Python, TypeScript, Go, Rust, C# and Java. The brief the agent gets is shown, and
  you can edit it.
- **Stack builder.** For the web: React, Vue, Svelte, Solid, Preact or none; Tailwind, plain CSS, CSS Modules, Sass,
  Bootstrap, Bulma, Pico or UnoCSS; then shadcn/ui, daisyUI, Mantine, Lucide, Motion, Sonner, Recharts, TanStack
  Query, SWR, Axios, TanStack Router, React Router, Vue Router, Solid Router, Zustand, Jotai, Redux Toolkit, Pinia,
  VueUse, Zod, React Hook Form, TanStack Form, TanStack Table, date-fns, i18next, Vitest + Testing Library,
  Playwright, ESLint, Prettier, Biome, a Hono API and Drizzle + SQLite. For Python (uv): FastAPI, Flask, Typer or a
  script, plus Pydantic, pydantic-settings, HTTPX, SQLModel, Jinja2, pandas, Polars, NumPy, Matplotlib, the
  Anthropic and OpenAI SDKs, Rich, python-dotenv, Loguru, pytest, Ruff and mypy. Choices that don't fit are greyed
  out with the reason; requirements are added and conflicts resolved, and the panel says what changed. Every
  package goes into package.json, or into pyproject.toml the way `uv add` writes it (tools in the dev group), and
  the panel shows the equivalent `npm install` / `uv add` commands. Each library is **used**, not just installed:
  a card on the home page shows it working (a query that fetches from the API, a form that validates, a sortable
  table, a store, a chart), with tests, lint and typecheck scripts and a README that says why each piece is there.
- **Templates and field kits.** Every starter in 70+ languages, searchable, and the FDE/ISV kits.

`npm run verify:stacks` installs, typechecks, lints, tests and builds a matrix of stacks and every stack in the
gallery for real.

## Live values

The fastest way to understand code is to watch it run. With **Live** on (the toggle above the editor, or
"Turn on live values" in ⌘K), the studio runs your entry file after every pause in typing and writes what
happened onto the code itself:

```ts
const prices = [3, 4, 5];          prices = [3, 4, 5]
let sum = 0;                       sum = 0
for (const p of prices) {          p = 3, 4, 5
  sum += p;                        sum = 3, 7, 12   ×3
}
if (sum > 100) {
  console.log('big');              (faded: never ran)
} else {
  console.log('small', sum);       → small 12
}
```

- **Values** a line declared or assigned (including destructuring, `x++`, `obj.field = …`), the loop
  variable of each iteration, what a function or arrow returned (`↩ 24`), what the line printed (`→ …`),
  and the error it threw (`✕ Error: boom`, on the line that threw it).
- **How often** each line ran (`×3`), and which lines **never ran** (faded) — dead branches show up while
  you write them.
- **Every file** of the project is followed, not just the entry: a helper in another file shows its values too.
- **Hover** a line for the full list of values.

TypeScript and JavaScript are instrumented with the TypeScript compiler (calls added around your statements,
nothing else changed) and run under Node as CommonJS, top-level `await` included. Python runs under a
`sys.settrace` tracer (with uv when the project has a `pyproject.toml`), comparing each line's variables before
and after. While you type a run gets 4 s; a program that runs longer, or loops forever, stops and shows the
start of the run. Results are only drawn on the code they came from: while you type, the last ones move with
your edits until the next run lands.

Live values run your program on the server, so they work where Run does: on your own machine (or with
`NANOCLI_RUN=1`). Your program runs on every pause, so keep it off for code that sends email or writes to a
real database.

## Contracts

A contract is a rule about your project that has to stay true, in words, with the check that proves it.
They live in `.nanocli/contracts.json`, so they travel with the project and get reviewed like code:

```json
{
  "contracts": [
    { "rule": "No console.log left in the source", "kind": "forbid", "pattern": "console\\.log\\(", "files": "src/**/*.{ts,tsx}" },
    { "rule": "Every source file starts with the licence header", "kind": "require", "pattern": "^// Copyright", "files": "src/**/*.ts" },
    { "rule": "The tests pass", "kind": "command", "command": "npm test", "expect": "pass" }
  ]
}
```

- `forbid`: a regular expression that must not match in the files a glob selects (default: every code file).
- `require`: one that must match in every one of them.
- `command`: a command that must exit 0 in the project folder, and optionally print something matching `expect`.

Open **Project → Contracts** to add one (describe it and the agent writes it, pick a starter, or write it by
hand), see each rule with ✓ or ✕ and exactly where it breaks (click to jump to the line), and hand a broken
one to the agent. Pattern contracts are checked on every change; command contracts when you press
**Check all** (on your own machine, like the terminal), and their results are marked stale once the files change.

What holds the agent to them:

- **It is told.** Every rule goes into the agent's instructions, with the order not to change the contracts unless asked.
- **It checks.** A `check_contracts` tool runs them against its pending edits; it is told to run it before it finishes.
- **Its proposals are judged by them.** A proposal that breaks a pattern contract, or whose last contract check
  failed, is never marked verified ("Breaks a contract"). A proposal that edits the contracts is flagged
  ("changes a contract") and needs a closer look, so a rule can't be quietly loosened.
- **The worker keeps them.** A broken contract is the worker's next task after a failing build or run.

### A second reviewer

When the agent finishes, a separate reviewer reads the proposal cold: the goal, the diff (with line numbers),
the evidence and your contracts, without the agent's reasoning or its tools, the way a colleague reviews a pull
request. It looks for bugs first, then whether the goal is really met, safety, claims the evidence doesn't
support, and contracts. Its verdict shows next to the evidence (`reviewer ✓`, `reviewer: 2 to fix`), its findings
under **Second opinion** (severity, file and line, the issue, the fix), and **Send to the agent** hands them back
in one click. A blocking review turns **Ship** into **Accept anyway**. It uses your model, one extra call per
proposal; turn it off in the Agent tab.

### Why-history

Every line an accepted proposal wrote remembers why it is there. A thin accent mark sits beside those lines;
hover the line number for the reason: the goal it served, who asked (you, the debugger or the worker), when it
was accepted, its evidence ("Verified") and the reviewer's verdict. The history lives in `.nanocli/why.json`, so it
is committed with the code and travels with the repository; lines are matched by their text, so the reason
stays attached while the code around them moves or is re-indented.

### The morning report

Come back after a few hours and the studio opens on **While you were away**: what waits on you (finished
proposals with their verdict and the reviewer's, questions the agent asked), what is broken now (the last
failure, CI on save, contracts), what got done, and the worker's next step. Each item opens where you act on
it. Any time from ⌘K: "What happened while I was away".

### Evidence per change

Every proposal also says what its changed lines actually did. Its version of the program runs once with
[live values](#live-values) (automatically when Live is on, otherwise on a click), and the proposal lists
each changed line of code that ran, with the values it produced, and each one that **never ran**: an
untested branch the agent added shows up before you ship it, not after.

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

### Which model for which job

Settings → AI models opens on **Which model for which job**. The studio does four jobs with different needs:
the **Agent** (many tool calls in a row: reliability and coding strength), the **second reviewer** (a careful
cold read, best from a different model family than the agent), **Ask** (fast and cheap) and the **worker**
(many background tasks: cost per task). Pick what matters (best results, free, or private on your machine) and
each job gets a recommended provider and model with the reason, the cost, whether you already have the key,
and a link to the page where you get it. Paste a key and it is checked on the spot; **Use this setup** assigns
each job its model (the agent's becomes the main one), and a job without a ready key keeps the main model.

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

### Debugging, on autopilot

Every failure lands in one place, whatever produced it: a build error, a crash or non-zero exit in any language, a Python
traceback, a runtime error or failed bundle in the preview, a dev server that won't start. A bar under the editor shows what
broke and where: error locations are parsed from each toolchain's output (TypeScript, Node, Python, Rust, Go, Java and Kotlin,
C#, C/C++, Ruby, PHP, Solidity and more), and each one opens the file at that line.

**Debug this** hands it to the agent with everything a good debugger starts from: the error, the code it points at, and
**what changed since the code last worked** (the studio remembers the last version that built or ran cleanly). The agent
follows a fixed method: reproduce, locate, find the root cause, make the smallest fix, then run it again to prove it. The
fix arrives as a proposal with its evidence ("Verified · ran ✓"), and nothing changes until you accept it.

Turn on **Debug failures automatically** in the Agent tab and a debugging proposal starts on its own for each new failure
(once per distinct failure, one at a time). If it needs to run something, the bar says **Approve to continue**.

### The worker: an AI teammate that codes alongside you

The **Worker** tab turns the agent into a colleague who keeps going while you code. It looks at the project the way a good
teammate would and keeps a ranked list of what is worth doing next:

1. **Fix what broke**: the last failure, with the same debugging brief as *Debug this*
2. **Clear editor errors**: type errors and the like, file by file (fix the cause, no `any` casts)
3. **Take the next step toward your goal**: tell it what you are building, and it does one verifiable step at a time
4. **Resolve your TODOs and FIXMEs**: in any language, never in dependencies or build output
5. **Add missing tests**: for files with real logic that no test mentions

**Suggest** shows the list and you start each task. **Autonomous** takes the next task by itself whenever you pause typing
(about 12 s), one at a time, in the background: the result opens as a tab without taking the editor from you, and a pill in
the header says what it is on. Every task runs on a private copy and arrives as a proposal with evidence; nothing reaches
your files until you accept it. It keeps itself in check: a per-hour budget, never the same task twice, waiting for you once
three of its results need review, and pausing after three results that didn't come out verified. **Best of 3** quality runs
each task Harness²-style (the current setup against two variations) and recommends the one that verified.

**It learns from its record.** The studio notes how every proposal turns out in each project: whether it verified, whether
you shipped or discarded it, and which errors kept coming back (the Worker tab shows the tally). Task kinds you keep
shipping move up the list; kinds you keep discarding move down. When results slip (fewer than three in four verified, three
discarded, or the same error three times in the last six or more), the worker adds an **Improve how the agent works here**
task: the agent studies its own failures and proposes changes to `agent/prompt.md`, `agent/lessons.md`, a project skill or
`AGENTS.md`, each tied to the evidence. It never edits your code in that task, and like everything else it is a proposal you
review. The record stays in your browser.

### Skills: what the agent knows how to do

The agent uses **skills** in the open [Agent Skills](https://agentskills.io) format: a folder with a `SKILL.md` whose
frontmatter names the skill and says when to use it, followed by instructions and any reference files. It is the same format
Claude uses, so skills written for Claude and other agents work here unchanged. Like Claude, the agent sees only each skill's
name and description; when a task matches, it loads the instructions with `use_skill` and reads reference files with
`read_skill_file` as it needs them, so hundreds of skills cost a few lines of context. Start a request with `/skill-name` to
use one directly.

- **Built in:** systematic debugging, test-driven development, writing tests, code review, refactoring, security review
  (with a full checklist), performance, API design, CLI design, accessible frontend components, database changes, smart
  contract security (with Foundry patterns), documentation, dependency upgrades, and creating skills.
- **From GitHub:** **Settings → Skills → Add from GitHub** takes `owner/repo`, a folder in it, or a link to a `SKILL.md`,
  lists every skill it finds with its description, and installs the ones you pick, pinned to the commit it read (for example
  `anthropics/skills`). **Update** moves a skill to the latest commit. Private repositories work when you're signed in with
  GitHub. Files are listed with the GitHub API, or with git when the API is rate-limited or blocked.
- **Your own:** write one in **Settings → Skills** (kept for you in `~/.nanocli/skills`), or put it in the project at
  `agent/skills/<name>/SKILL.md` so it travels with the project and with [field kits](#field-kits). The agent can write one
  for you too: ask it to "create a skill for…".

Skills are instructions, not code: installing one runs nothing, text files only (no binaries), with size limits, and paths
can't leave the skill folder. A skill can't override your request or the safety rules, and anything it asks the agent to run
still needs your OK. Installing is available when the studio runs on your own machine (`NANOCLI_SKILLS=1` turns it on for a
server, `0` turns it off); built-in and project skills always work.

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

## DevOps: pipelines in the studio

The **Pipelines** tab sets up CI/CD for the project you have open and runs it before you push.

- **Set up from the project.** The studio reads how the project is built (package.json scripts and lockfile, pyproject.toml
  and uv, go.mod, Cargo.toml, Maven or Gradle, .NET, Ruby, PHP, Elixir, Dart, Deno, Foundry, Zig, CMake or Make, and bare
  scriptc projects) and writes a **GitHub Actions** workflow or a **.gitlab-ci.yml** that installs dependencies and runs
  the checks the project actually has: lint, format, typecheck, test and build. Action versions are pinned to current
  majors, caching is only turned on when there is a lockfile to key it on, and permissions are read-only unless a deploy
  needs more. You see the file before it is added, and after that it is an ordinary file you can edit.
- **Deploy targets.** GitHub or GitLab Pages for static sites, a container image pushed to ghcr.io or the GitLab registry,
  Vercel, Netlify, Fly.io, or release binaries for Linux, macOS and Windows attached to a GitHub release on a `v*` tag (Go,
  Rust, scriptc). Targets that don't fit say why (no Dockerfile yet: one click asks the agent to write one). Deploys only
  run on pushes to the main branch, and the tab lists the secrets each one needs and where to add them.
- **Run it here.** **Run all** (or one job) runs the pipeline on this machine with the project's current files, the way
  the CI service would: `bash -eo pipefail` steps (PowerShell on Windows), the job and step environment, `CI=true`,
  `GITHUB_ENV`, `GITHUB_OUTPUT` and `GITHUB_PATH` between steps, `if:` conditions and `${{ … }}` expressions, `needs`
  ordering, and GitLab stages, `extends` and `rules`. Setup actions use the toolchain on this machine (installing it when
  the studio can); steps that only make sense on the service (caches, artifacts, deploys, releases) are skipped with a
  note, and so are jobs whose conditions don't match a manual run. Dependencies are kept between runs.
- **Failures go to the agent.** A failing step lands in the debug bar with its command and output. **Debug this** hands it
  to the agent, which has a `run_pipeline` tool: it reproduces the failure, fixes the code (or the CI file, when that is
  what's wrong) and proves the fix by running the pipeline again, as a proposal you review. Auto-debug and the worker
  pick pipeline failures up like any other.
- **Status in the Git tab.** For a linked GitHub repository, the Git tab shows the latest run of each workflow on the
  branch (polling while one runs). A failed run offers **Fix with agent**, which reads the failing job's log and starts
  the same reproduce, fix, prove loop, and **Re-run failed**.

Running pipelines locally follows the same rule as running code: only when the studio listens on your own machine (or
`NANOCLI_RUN=1`). Signing in with GitHub now asks for the `workflow` permission, which GitHub requires for commits that
change `.github/workflows/`; sign in again if you signed in before.


### Works here = works in CI

Turn on **Run on every save** in the Pipelines tab (or "Run CI on every save" in ⌘K) and each save (⌘S) runs
the project's CI file on your machine in the background: the same lint, test and build steps CI runs, with a
newer save cancelling the run before it. The status bar shows `CI here · Test` while it runs, then
`CI here ✓ 12 s` or `CI here ✕ Test`; a failure lands in the debugger ("Step “Test” failed: …") with
**Debug this**, so the agent or the worker can fix it before you push.

## Field kits

A **field kit** is a project plus everything that usually lives in someone's head or a wiki page, shared as one file. It
is made for forward-deployed engineers who start at a new customer every few weeks, for ISVs who want developers productive
with their API on day one, and for teams that want everyone to start the same way.

| Part | What it is |
|---|---|
| **Playbook** | The steps of the engagement, ticked off as you go. A step can be handed to the agent with one click ("Learn their API", "Map the fields", "Write the hand-off") |
| **Setup** | The environment variables it needs (secrets are masked) and the connectors the agent should have, with `${VARIABLE}` placeholders where a secret goes |
| **Checks** | Runs with expected output that prove it works here: **Run checks** shows ✓ or the output that failed |
| **House rules** | `agent/prompt.md` and `agent/skills/`: how the agent should work in this codebase (never log keys, a test for every mapping…) |
| **Goal** | Where the [worker](#the-worker-an-ai-teammate-that-codes-alongside-you) should head, set with one click |

Three kits are built in (**New project → Field kits**, or a link like `/?kit=product-mcp-server`), and each runs on sample data
the moment it opens:

- **Customer API integration** (forward-deployed): a sync from a customer's REST API with retries, rate limits, pagination,
  field mapping with tests, and a dry run on fixtures
- **MCP server for your product** (ISV): a dependency-free MCP server with two example tools and a self-test, plus the rules
  for designing tools that agents use well, and a step that writes your customers' install guide
- **Data pipeline proof of concept** (forward-deployed): a customer's CSV export validated and loaded into a warehouse table
  with a rejects report (Python standard library; SQLite first, their Postgres when ready)

**Kit → Export kit** writes a `.nanokit.json`; **Open a kit file…** opens one. **Make this project a kit** starts the
manifest (`.nanocli/kit.json`) for any project. Kits are treated as untrusted input. Paths are checked, and connectors
that would run a program show the command before you add them; once added, every call still asks you first. Exporting
never carries secrets: environment values aren't part of a kit, `.env` files stay behind, and any file that looks like it
holds a key (cloud, model, GitHub, Slack or Stripe keys, private keys, passwords in URLs) is left out and named.

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
| Code editor | ~570 KB brotli, served from this server and cached for a year (it used to come from a public CDN, which also meant no editor offline). The studio page preloads it (an HTTP `Link` header, only on the page itself, never on prefetches from other pages), so it downloads while the page hydrates: drawn **~0.6 s** after a cold load (was ~0.73 s), **~0.17–0.27 s** on later visits |
| First paint | ~0.2 s; the page is interactive before the editor arrives |
| Compression | Next's static chunks are served brotli-compressed (each compressed once, in the background, and kept in memory): 17% less than gzip, e.g. the product page 261 → 216 KB |
| Server | starts serving in ~0.43 s with Node's compile cache (kept in `~/.nanocli/cache`; ~0.51 s without it), ~125 MB resident when idle |
| Builds | ~0.6 s for a small program (type-check + IR, WASM or native), two at a time by default (`MAX_CONCURRENT_BUILDS`) |
| Disk (`node_modules`) | ~1.6 GB, of which scriptc's compiler binaries ~410 MB, the bundled zig ~410 MB (offline WASM builds), Next.js ~200 MB and the editor ~105 MB (only its 25 MB `min/` folder is ever served) |

Things that keep it light: the studio makes no request to any third party (models are the only exception, and only the
one you choose); idle MCP sessions close after five minutes; compiled temp files, uv's cache and idle Python environments
are cleaned up (Settings → Maintenance shows and trims them); connectors, the updater and the doctor load their code only when
used. If disk matters more than offline WASM builds, remove `@zigc/*` after install: the first WASM build then fetches the exact zig version from the npm registry (checked against its sha512) into `~/.nanocli/zig`. The desktop app does this by default and also leaves out source maps, type definitions (except scriptc's) and Next's development runtimes: 537 → 400 MB of dependencies.

---

## Web apps and live preview

Pick a starter under **New project → Web apps** (React, Vue, Svelte, Solid, Preact or plain TypeScript on Vite;
Next.js; Nuxt; SvelteKit; Astro; React Router; Angular), or open any project whose `package.json` uses one of them,
and press **Run**. The studio starts the framework's own dev server and shows the app in a **Preview** pane next to the
editor (Ctrl/⌘ + Alt + P toggles it):

- **Real hot reload.** Edits are synced as you type (only the files that changed), so the framework's HMR updates the
  page and keeps component state; in testing a React edit showed up in about 0.3 s. Accepting an agent proposal
  updates the preview the same way.
- **Installs only when needed.** Dependencies are installed with the lockfile's package manager (npm, pnpm, yarn or Bun)
  on the first start and again only when `package.json` or the lockfile changes.
- **A path bar, reload, Full / Tablet / Phone widths, open in a new tab, and the server's log.** The status bar shows
  where it is running.
- **Isolated.** The page runs on its own origin (`127.0.0.1` and a free port) in a sandboxed frame, so it cannot reach the
  studio. Each project's files live in `~/.nanocli/dev/<project>`.

**In browser, no install.** Vite apps (React, Preact, Vue, Svelte or plain TypeScript) can also run without any server:
switch the Preview to **In browser** (it is the default wherever dev servers are off, such as a hosted studio).
[esbuild](https://esbuild.github.io) compiled to WebAssembly bundles the project in your browser, Vue and Svelte components
are compiled there too, and npm packages load from [esm.sh](https://esm.sh) at the versions in `package.json`. A rebuild
after an edit takes milliseconds; the page reloads, and the app's `console` output and errors appear under **Console**.
It all happens in a frame sandboxed to an opaque origin, so the project's code can't reach the studio, its storage or your
keys. Next.js, Nuxt, SvelteKit, Astro, React Router, Angular and Solid need their dev server.

Like **Other languages** below, this runs your project's code (and its packages' install scripts) on the machine hosting
the studio, so it is on only when the studio listens on that machine alone. `NANOCLI_DEV=0` turns it off and `=1` forces
it on. At most three dev servers run at once (the least recently viewed stops first), a server nobody has looked at for
20 minutes stops, and they all stop with the studio. Every starter is tested for real: installed, served and edited
(`NANOCLI_TEST_NETWORK=1 npm test`).


### Full apps in every language

**New project → Full apps** has the same small app (a page, and a JSON API it talks to) in twelve stacks, each
served by its own server with a live preview the moment you press Run:

| Stack | Served by | Reloads |
|---|---|---|
| Python · FastAPI, Flask (and Django projects) | `uv run uvicorn … --reload` / `flask run --debug` | by itself |
| Go | `go run .` (net/http, standard library) | restarted on change |
| Rust · axum (and actix, rocket, warp) | `cargo build`, then `cargo run` | restarted on change |
| Ruby · Sinatra | `bundle install`, then `bundle exec ruby app.rb` | restarted on change |
| PHP | PHP's built-in server | every request |
| Java | `java Main.java` (the JDK's HTTP server, from source) | restarted on change |
| Node.js · Express (Fastify, Hono, Koa) | `npm install`, then `node --watch` | by itself |
| Bun | `bun --hot` | by itself |
| Deno | `deno run --watch` | by itself |
| C# · ASP.NET Core | `dotnet build`, then `dotnet run` | restarted on change |
| Elixir · Plug | `mix deps.get`, then `mix run --no-halt` | restarted on change |

Your own projects in these stacks are recognised the same way. Dependencies are installed only when a manifest
changes (`pyproject.toml`, `Cargo.toml`, `Gemfile`, `mix.exs`…); a missing toolchain is one click away in
Run → Language. `npm run verify:apps` runs all twelve for real: start, page, API, and an edit served live.

### Optimize: SEO, AEO, GEO and the rest

**Project → Optimize** checks a web project from its files as you edit (no network) and scores eight areas:

| Area | What it checks |
|---|---|
| **SEO** (search engines) | Title and meta description length, canonical URL, robots.txt, sitemap, one `<h1>`, no accidental `noindex` |
| **AEO** (answer engines, voice) | schema.org JSON-LD, FAQ data or question-shaped headings answered in the first sentence |
| **GEO** (ChatGPT, Claude, Perplexity, AI Overviews) | `llms.txt`, AI search crawlers not blocked, content that exists without JavaScript, a clear entity (Organization / Product data), enough specific text to cite |
| **Social** | Open Graph tags, a share image, the X/Twitter card |
| **Accessibility** | `lang`, image alt text, descriptive link text, zoom not disabled |
| **Mobile and app** | Viewport, icon, web app manifest |
| **Performance** | Render-blocking scripts, image dimensions (layout shift), heavy images |
| **International** | `hreflang` links when the project has several languages |

Each finding says what it found and why it matters. **Fix N automatically** adds the missing tags and files
(robots.txt, sitemap.xml, llms.txt, a manifest, a favicon, JSON-LD, Open Graph and Twitter tags) using the site
address you give; everything that needs real content or framework-specific code (an FAQ, a share image,
prerendering, Next.js metadata) becomes one brief for the agent, which comes back as a proposal you review.

The studio's own site does the same: canonical URLs and full social cards on every page, a generated share image,
`/sitemap.xml`, `/robots.txt` (search engines and AI assistants welcome; set `SITE_AI_TRAINING=off` to turn away
AI training crawlers only), `/manifest.webmanifest`, `/llms.txt` and `/llms-full.txt` (the docs and FAQ as plain
text for language models), and schema.org data: Organization, WebSite and SoftwareApplication with the plans as
offers, FAQPage on the FAQ and pricing pages, TechArticle and breadcrumbs on every docs page. Set
`NEXT_PUBLIC_SITE_URL` to the public address in production.

### CSS frameworks

Every popular way to style a web app works out of the box, in the in-browser preview (no install) and with the
real dev server and production build:

| Framework | In the browser preview | Starter |
|---|---|---|
| **Tailwind CSS** v4 (and v3) | Tailwind's browser build (v3: the Play CDN); `@theme`, `@apply` and friends go to it | Tailwind CSS (React) |
| **daisyUI** | its stylesheet, on Tailwind | daisyUI |
| **UnoCSS** | the UnoCSS runtime (`virtual:uno.css` is handled) | UnoCSS |
| **Bootstrap**, **Bulma**, **Pico**, any npm stylesheet | `import 'pkg/…/x.css'` and CSS `@import "pkg/…"` load from the package at your version | Bootstrap, Bulma, Pico CSS |
| **Sass / SCSS** | dart-sass in the page: `@use` partials, npm packages (`bootstrap/scss/…`), Vue `<style lang="scss">` | Sass (SCSS) |
| **Less** | less.js in the page | Less |
| **CSS Modules** | `*.module.css` (and `.module.scss`/`.less`): classes scoped per file, imported as an object | CSS Modules (React) |

Each starter is a real Vite project (with `@tailwindcss/vite`, `unocss/vite`, `sass` or `less` set up) that
`npm run build`s for production. Styled-components, Emotion and other CSS-in-JS libraries work through npm as usual.

## Other languages

TypeScript compiles with scriptc and Python runs with uv; everything else runs with **its own toolchain**, which the studio
installs for you. Pick **New project → Other languages** (or open any file) and press **Run**: the **Run** tab (and the
terminal's `run`) show the output, take arguments and standard input.

| | | |
|---|---|---|
| JavaScript (Node), TypeScript on Bun or Deno | Go (modules too), Rust (file or Cargo) | C and C++ (your compiler, or the bundled **zig**), Zig |
| Java, Kotlin, Scala, Clojure, Groovy | C# and F# (.NET) | Ruby (Bundler), PHP, Perl, Lua, Bash |
| R, Julia | Swift, Dart | Elixir, Erlang, Gleam, Haskell |
| Nim, Crystal, Odin, D | OCaml, Racket, Fortran | |

**Projects with tests and CI:** besides a single-file starter, 17 languages have a real project to start from (Node, Python,
Go, Rust, Java, Ruby, PHP, C, C++, Bun, Deno, C#, Kotlin, Swift, Zig, Dart, Elixir): the same small command-line tool,
split into a library and a program, with unit tests in the language's own framework and a CI workflow. `npm run
verify:templates` runs every one and its CI for real.

**Smart contracts:** Solidity with Foundry (build plus unit and fuzz tests; `forge` fetches the `solc` each contract asks for),
Vyper (ABI and bytecode), Cairo for Starknet (Scarb), and Move for Sui (build and test).

### Toolchains, installed and kept current

- **Out of the box.** If a language isn't installed, the first **Run** installs it (or press **Install** in the Run tab), with
  [mise](https://mise.jdx.dev): about 1 MB for Lua, 75 MB for Go, a few hundred for Swift or .NET. A tool's runtime comes
  with it (Kotlin, Scala and Clojure bring Java; Elixir brings Erlang; Vyper runs through uv).
- **Yours first.** Anything already on your `PATH` is used as is. The studio's toolchains live in `~/.nanocli/mise` with
  their own data, config and caches, so they never touch your own mise, `~/.rustup` or `~/.cargo`.
- **Patched as soon as releases ship.** Each tool is pinned to its major line (`go = "1"`, `zig = "0.16"`, `rust = "stable"`).
  The studio checks every 12 hours and applies updates within the line automatically, removes what they replaced, and keeps
  mise itself current. A new major version is shown with an **Upgrade** button and never installed on its own.
- **Verified downloads.** mise comes from its official mirror and is checked against the release's SHA-256 list before it
  runs; mise checks the toolchains it installs.
- Switches: `NANOCLI_TOOLCHAIN_AUTO_INSTALL=0` and `NANOCLI_TOOLCHAIN_AUTO_UPDATE=0`, or the two checkboxes in the Run tab.

Which engine runs a file: `.ts` is scriptc, `.py` is uv, a `deno.json` or `bunfig.toml` moves `.ts`/`.js` to Deno or Bun, a
`package.json` makes `.js` run on Node, and other extensions pick their language (Gleam, Cairo, Move and Solidity projects
need their `gleam.toml`, `Scarb.toml`, `Move.toml` or `foundry.toml`). `languages` in the terminal lists what this machine
has. Projects keep their dependencies and build output on the server between runs (`~/.nanocli/run/`), caches are shared,
and files a program writes come back into the explorer.

Same trust model as Python: it **runs your code on the machine hosting the studio**, so it is only on when the studio
listens on that machine alone (`NANOCLI_RUN=0` turns it off, `=1` forces it on). Programs get a short allow-list of
environment variables (never the studio's keys), a private `HOME`, a time limit per step (5 min to run, 10 to compile), a 2 MB
output cap, and stopping a run kills the whole process tree. It is not a sandbox.

**Tested for real**, with the studio installing each missing toolchain itself (`NANOCLI_TEST_NETWORK=1 npm test`): Node, Bun,
Deno, Go, Rust, C, C++, Zig, Java, Kotlin, C#, F#, Ruby, PHP, Perl, Lua, R, Julia, Swift, Dart, Elixir, Erlang, Gleam, Clojure,
Groovy, Nim, Crystal, Odin, D, Bash, and the Solidity, Vyper and Cairo contracts. Not yet run end to end: Scala and Racket
(their downloads failed behind the test machine's TLS proxy), Move (Sui fetches its framework from GitHub, which that machine
blocks), and Haskell, OCaml and Fortran, which use your own install (ghcup, opam, gfortran) because mise has no reliable build
of them.

---

## Signing in with GitHub

Sign-in (and sign-up: GitHub's page offers a free account) needs one GitHub OAuth app and **no domain**:

1. GitHub → Settings → Developer settings → OAuth Apps → **New OAuth App**. Any homepage URL (the repository's is fine);
   callback URL `http://127.0.0.1/api/github/callback`.
2. In the new app's settings, tick **Enable Device Flow**. You don't need a client secret.
3. Give the studio its client ID: `GITHUB_CLIENT_ID=…` for a server, and the repository variable
   `NANOCLI_GITHUB_CLIENT_ID` (Settings → Secrets and variables → Actions → Variables) so the desktop builds include it.
   A client ID is public; it is not a secret.

**Sign in** then shows a one-time code: open github.com/login/device, enter it, authorize, and the studio signs you in by
itself. That works on localhost, in the desktop app (whatever port it picked) and on a server reached by IP. With a
domain later, add `GITHUB_CLIENT_SECRET` and `GITHUB_REDIRECT_URI` on that host and sign-in switches to the usual redirect
for visitors of that host. The token lives in an httpOnly cookie on the studio's server (Secure when served over HTTPS)
and never reaches the page; your avatar's menu signs out.

## Desktop app (Windows and macOS)

NanoCLI Studio also ships as a native app built with [Tauri](https://tauri.app). The shell is deliberately thin (a 4.5 MB
Rust binary): it starts the studio's server with a bundled Node.js on a free loopback port, shows a loading screen, then
points a native window at it, using the system's own web view (WebView2 on Windows, WebKit on macOS) rather than shipping a
browser. The page gets no native APIs and runs exactly as it does in a browser, with the same security model.

- Links that leave the studio open in your browser; downloads go to your Downloads folder.
- A second launch focuses the running app. Quitting stops the server, and the server also stops on its own if the app
  disappears without saying so.
- On macOS the server gets your login shell's `PATH`, so compilers you installed with Homebrew, rustup and the like are used.
- Builds write to the app's cache folder (the install folder is read-only).
- zig (needed for WebAssembly builds, ~400 MB) isn't shipped: the first WASM build fetches the exact version scriptc expects
  from the npm registry, checked against its sha512, into `~/.nanocli/zig` (about 90 MB to download, once).

Build it yourself on the platform you're packaging for (Rust, and on Linux the WebKitGTK dev packages):

```bash
npm ci
node scripts/desktop-prepare.mjs     # the studio build + production dependencies + a verified Node.js 24
npx tauri build                      # installers in src-tauri/target/release/bundle/
```

**Download:** the [/download](/download) page (also the Download section on the landing page) links to the latest
installers, highlights the one for the visitor's system and shows how to install it: `NanoCLI-Studio-macOS-arm64.dmg` and
`NanoCLI-Studio-Windows-x64-setup.exe` in the `desktop-latest` release, with `SHA256SUMS.txt`. Point it at another repository
with `NEXT_PUBLIC_DOWNLOADS_REPO=owner/repo`.

CI (`.github/workflows/desktop.yml`) builds the macOS (Apple silicon) `.dmg` and the Windows installer on pull requests that
touch the app, on pushes to main, on version tags, and on demand, then publishes them under those stable names: a `v*` tag
gets its own release, and every other build replaces the files of the rolling `desktop-latest` pre-release (builds from
forks stay workflow artifacts). Builds are unsigned unless the `APPLE_*` signing secrets are set; macOS then asks you to
confirm the first launch (right-click → Open).

## Maintenance

The studio looks after itself, and asks before it changes anything.

- **Restarts itself.** `npm run dev` and `npm start` run the server under a small supervisor
  (`scripts/supervise.js`): a crash restarts it after a pause that grows to 30 s, an update restarts it at once, and a crash
  loop (more than six in two minutes) stops with a message instead of spinning. Use `npm run start:plain` to run without it;
  the Docker image leaves restarts to the container runtime.
- **Updates, with your approval.** **Settings → Maintenance** checks the git remote (at most every six hours, or **Check now**)
  and lists what is new; the footer shows `↑ N updates`. **Update now** only fast-forwards a clean checkout, reinstalls
  dependencies only if `package.json` or the lock file changed, rebuilds when the server is a production one, and puts the previous
  commit back if any step fails. A copy without git (or in a container) just says so.
- **Autopilot.** While it runs, the studio checks itself every ten minutes: free disk, build leftovers, package caches, its own
  memory and how quickly it responds. It applies the safe fixes on its own (clear build leftovers, prune caches, and when the
  disk is nearly full remove idle Python environments, which are rebuilt on demand), and a server that has grown past 2 GB
  or stopped responding restarts itself under the supervisor, only once nobody has used it for ten minutes. **Update
  automatically** (off by default) applies updates the same way **Update now** does, once the studio has been idle for 30
  minutes and at most every six hours; after the restart the new version must answer its health check, and if it keeps
  crashing instead the supervisor puts the previous commit back. Everything it does is listed in **Settings → Maintenance →
  Autopilot**, where both switches and **Check now** live.
- **Out-of-date pages fix themselves.** After an update, a tab that is still open asks for code that no longer exists; the page
  reloads itself once (never more than once a minute) instead of showing an error.
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
| `/landing` | Product page |
| `/pricing` | Plans (Free, Pro, Premium) and a comparison; edit them in `src/lib/pricing.ts` |
| `/docs` | Developer docs, made from this README: one page per section, with search |
| `/llms.txt`, `/llms-full.txt` | The site and its docs as plain text for language models |
| `/sitemap.xml`, `/robots.txt`, `/manifest.webmanifest` | For search engines, crawlers and installing the app |
| `/faq` | Searchable FAQ |
| `/onboarding` | Three-step tour ending in the workspace with a template (`/?template=<id>`) |
| `/?kit=<id>` | Opens a built-in [field kit](#field-kits) |
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

### `/api/skills`

`GET` lists skills (built in and installed); `GET ?name=` returns one, `GET ?name=&file=` one of its files. `POST` with `action`: `discover` / `install` (GitHub), `update`, `create`, `enable`, `remove` (same-origin, local only).

### `/api/connectors`

`GET` → `{ mode: "local" | "hosted" | "off", node, sqlite }`.
`POST { action: "tools" | "call", connector, tool?, args? }` → `{ ok, tools }` or `{ ok, text, isError }`. The connector's
configuration is validated on every request and travels with it; the server keeps only warm MCP sessions.

### `/api/devserver` (web apps)

`POST { action: 'start', projectId, files }` writes the project, installs when needed and starts the dev server
(it returns at once); `{ action: 'sync', projectId, changed, removed }` applies edits; `{ action: 'stop', projectId }`.
`GET ?projectId=…&since=N` returns the status (`installing`, `starting`, `ready`, `stopped`, `failed`), the URL and the
log lines after `N`. Same checks as `/api/run`: same origin, a trusted host, a rate limit, and only where it is enabled.

### `/api/toolchains` (local only)

`GET` → `{ enabled, mise, tools: [{ tool, requested, version, update?, major? }], autoUpdate, autoInstall, lastCheck, lastUpdate }`.
`POST { action: 'install', language }`, `{ action: 'update' }` and `{ action: 'upgrade', tool }` stream progress as
newline-delimited JSON; `{ action: 'settings', autoUpdate?, autoInstall? }`. Same checks as `/api/run`.

### `/api/pipelines` (local only)

`GET` → `{ enabled }`. `POST { projectId, files, file, job? }` runs a CI file (`.github/workflows/*.yml` or
`.gitlab-ci.yml`) on this machine and streams newline-delimited JSON: `{ t: "job", id, status }`, `{ t: "step", job, index,
name, status, note? }` and `{ t: "out", s, d }` as it runs, then `{ t: "done", ok, jobs, ms, error? }`. Same-origin,
trusted-host and run-enabled checks apply.

### `/api/run` (other languages)

`GET` → `{ enabled, languages: [{ id, name, available, version?, install }] }`. `POST { projectId, entry, files, args?, stdin?, env?, language? }`
streams newline-delimited JSON like `/api/python`: `{ t: "out", s, d }` lines, then `{ t: "done", code, ms, changed, removed, skipped, timedOut?, truncated?, error? }`.
Paths and environment variable names are validated; `PATH`, `HOME`, loader and toolchain variables (`GOPATH`, `CARGO_*`, `JAVA_*`…) can't be set.

### `/api/live` (local only)

`GET` → `{ enabled }`. `POST { projectId, entry, files, args?, quick? }` runs the entry with live values and returns
`{ ok, files: { [path]: { statementLines, lines: { [line]: { hits, values: { [name]: { n, first, last } } } } } }, output, code, ms, truncated?, error? }`.
`return`, `out` and `threw` are the reserved value names. `quick` (while typing) limits the run to 4 s, otherwise 15 s.

### `/api/doctor` and `/api/update` (local only)

`GET /api/doctor` → `{ checks: [{ id, label, status, detail, fix? }], server }`; `POST { fix }` applies one. `GET /api/update`
→ `{ supported, behind, ahead, dirty, commits, canApply, supervised, … }` (`?refresh=1` contacts the remote);
`POST { action: "apply" }` streams `{ t: "out" }` lines then `{ t: "done", ok, from, to, restartRequired, rolledBack?, error? }`;
`POST { action: "restart" }` asks the supervisor to restart. Same-origin and trusted-host checks apply, and all of it is refused
when the server listens beyond localhost.

### `/api/autopilot` and `/api/health`

`GET /api/autopilot` → `{ autoRepair, autoUpdate, journal: [{ at, kind, message }], lastUpdateCheck?, pendingVerify? }`;
`POST { autoRepair?, autoUpdate? }` saves the switches and `POST { action: "run" }` runs a round now (local only, like the
doctor). `GET /api/health` → `{ ok: true }` for anyone (for load balancers and the updater's check); on your own machine it
also reports uptime, memory, Node version and the latest autopilot entries.

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
GET    /api/github/repos/:owner/:repo/actions?branch=    Latest workflow runs → { runs }
GET    /api/github/repos/:owner/:repo/actions?run=       A run's jobs and steps → { jobs }
GET    /api/github/repos/:owner/:repo/actions?job=       The end of a job's log → { log }
POST   /api/github/repos/:owner/:repo/actions            Re-run failed jobs { action: "rerun", run }
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
NEXT_PUBLIC_SITE_URL=https://your-domain   # canonical URLs, sitemap, social cards, llms.txt (defaults to NEXT_PUBLIC_BASE_URL)
SITE_AI_TRAINING=on                       # off: robots.txt turns away AI training crawlers (search and AI answers still allowed)
PORT=3000

# Pricing page: checkout links for the paid plans (https only; until set, the buttons
# say paid plans open soon and lead to the free studio)
NEXT_PUBLIC_CHECKOUT_PRO_URL=
NEXT_PUBLIC_CHECKOUT_PREMIUM_URL=
NEXT_PUBLIC_SALES_URL=

# GitHub OAuth (create an OAuth app with callback <base>/api/github/callback)
GITHUB_CLIENT_ID=             # enough on its own: sign-in with a one-time code (see Signing in)
GITHUB_CLIENT_SECRET=         # optional: the redirect flow, for a host with a fixed address
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
NANOCLI_AUTOPILOT=1          # 0 = no background checks at all
NANOCLI_AUTOREPAIR=1         # default for "Repair automatically" (0 = off)
NANOCLI_AUTOUPDATE=0         # default for "Update automatically" (1 = on)
NANOCLI_PY_TIMEOUT_MS=300000          # per program run
NANOCLI_PY_INSTALL_TIMEOUT_MS=1200000 # per install / sync / lock
NANOCLI_PY_JOBS=3                     # concurrent Python commands
NANOCLI_PY_REQUESTS_PER_10_MIN=120    # per client

# Connectors (agent tools: MCP, databases, web, GitHub)
NANOCLI_RUN=                 # 0 = don't run other languages, 1 = force on; unset = on only when HOST is loopback
NANOCLI_RUN_JOBS=3           # concurrent runs
NANOCLI_DEV=                 # web app dev servers: 0 = off, 1 = force on; unset = on only when HOST is loopback
NANOCLI_DEV_SERVERS=3        # dev servers running at once
NANOCLI_TOOLCHAIN_AUTO_INSTALL=1   # 0 = never install a missing toolchain on Run
NANOCLI_TOOLCHAIN_AUTO_UPDATE=1    # 0 = don't apply toolchain updates on their own
TRUST_PROXY_HOPS=1           # reverse proxies in front of the studio (rate limits use the address the last one saw)
COMPILE_REQUESTS_PER_10_MIN=300
NANOCLI_RUN_REQUESTS_PER_10_MIN=150
NANOCLI_PIPELINE_JOBS=2       # local pipeline runs at once
NANOCLI_PIPELINE_RUNS_PER_10_MIN=60
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

## Security

What protects each part of the studio, what it deliberately does not (running a project is not a sandbox), and the
latest audit: [SECURITY.md](SECURITY.md).

## License

Proprietary — Copyright © 2026 BrandDeb. All rights reserved. No use, copying, modification or
distribution is permitted without a written agreement; see [LICENSE](LICENSE). Third-party components
(scriptc, Next.js, React, Monaco Editor and others) remain under their own licenses.
