# Project overview for collaborators

Read this first. It covers what the project is now, how the code is laid out, how to run and test it, what state
the work is in, and what is waiting on whom. The README covers features for users. [ROADMAP.md](ROADMAP.md) covers
what we build next, and [BACKLOG.md](BACKLOG.md) has the status of every item.

## What this is now

An editor where you and an AI agent share one workspace, in the browser or as a desktop app. You can write code by
hand, or describe what you want and let the agent do it. The agent's work comes back as **proposals with evidence**
(diffs, test runs, screenshots, a risk score), and you accept or reject them like a pull request.

**About the name.** The project started as *NanoCLI Studio*: write TypeScript, get a native CLI binary (through the
`scriptc` compiler). That still works (the Build panel), but the product grew into a general editor with 40+ languages,
web app previews, an agent, connectors and web3 tools, so it was renamed **Aha!**. Everything moved with it:
`package.json` is `aha`, browser storage uses `aha:*`, the home folder is `~/.aha/`, projects keep their files in
`.aha/`, and settings variables are `AHA_*`. Saved data carries over by itself on first start (`src/lib/legacy-names.ts`),
and the old `NANOCLI_*` variables still work. The desktop app keeps its old bundle identifier (`dev.nanocli.studio`) so
installed copies update in place.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000, under a supervisor that restarts on crash
npm test             # unit tests (Node's test runner, no build needed)
npx tsc --noEmit     # type check
npx eslint src tests # lint
npm run build        # production build (also regenerates the /docs pages from the README)
```

You don't need any keys to start. Models are bring-your-own-key (Settings → Models); without a key the agent features
explain what to add. Language toolchains (Python via uv, zig, Go, Rust and others via mise) are installed on first use.

## How it fits together

```
Browser (Next.js client, React 19)            Server (Next.js routes + server.js)
┌──────────────────────────────────┐         ┌──────────────────────────────────────┐
│ src/app/page.tsx → Workspace     │  HTTP   │ src/app/api/*  (compile, run, python,  │
│  ├ Monaco editor (CodeEditor)    │ ──────▶ │   devserver, ai, connectors, skills,   │
│  ├ panels/ (Build, Agent, Git,   │         │   solc, pipelines, doctor, update…)    │
│  │   Python, Web3, Worker…)      │  WS     │ server.js: terminal + live channels    │
│  ├ proposals.tsx (agent work)    │ ◀─────▶ │ src/lib/*: the logic behind each route │
│  └ store.tsx (project state)     │         │ ~/.aha/: toolchains, caches        │
└──────────────────────────────────┘         └──────────────────────────────────────┘
        Desktop app: src-tauri/ wraps the same app and runs the server locally
```

- **The studio runs where its server runs.** Run it on your own machine (the local studio or the desktop app) and
  it can run programs, start dev servers and launch local MCP servers. As a hosted, shared site it switches those off
  (see `src/lib/host.ts`) and runs code in the browser only (WASI and esbuild-wasm).
- **Keys and connectors stay in the user's browser** (localStorage). They go to the server only with the request that
  needs them, and the server never stores them.
- **The agent** (`src/lib/agent/`) runs a tool loop (`loop.ts`) against a staged copy of the project (`stage.ts`).
  It collects evidence (`evidence.ts`), gets a second opinion (`review.ts`) and scores the risk (`risk.ts`). The client
  side (`src/workspace/proposals.tsx`) turns runs into proposal tabs you review.

## Where things are

| Path | What it holds |
|---|---|
| `src/app/` | Pages (studio `/`, `/docs`, `/pricing`, `/download`, landing) and API routes under `api/` |
| `src/workspace/` | The studio UI: `Workspace.tsx` (layout), `store.tsx` (project state), `actions.ts` (commands), `proposals.tsx` |
| `src/workspace/panels/` | One file per tool panel (Build, Agent, Git, Python, Web3, Worker, Pipelines…) |
| `src/workspace/components/` | Shared UI: file tree, terminal, dialogs, settings, connector catalog, proposal view |
| `src/components/CodeEditor.tsx` | The Monaco editor wrapper (models, markers, live values, why-history) |
| `src/lib/agent/` | Agent loop, tools, evidence, review, risk |
| `src/lib/connectors/` | Connectors: MCP client, built-ins (GitHub, web, SQL), the 52-server catalog |
| `src/lib/skills/` | Agent skills (SKILL.md): built-ins, ecosystem skills, install from GitHub |
| `src/lib/web3/` | Solidity compile (solc), static analysis, in-page EVM chain and wallet deploys |
| `src/lib/live/` | Live values, coverage, rewind (recorded runs) |
| `src/lib/pipelines/` | CI pipelines inside the studio |
| `src/lib/*-templates.ts`, `gallery.ts`, `stack/` | Project templates, app gallery, stack builder |
| `src-tauri/` | Desktop app (Tauri, Rust): Windows and macOS |
| `tests/` | Unit tests, one file per area (`*.test.ts`) |
| `scripts/` | Docs generator, supervisor, template and app verifiers |
| `docs/` | This overview, roadmap and backlog |

## How we work

- **Branches and pull requests.** Work happens on a branch and lands on `main` through a pull request once CI is
  green. One change per pull request (see [CONTRIBUTING.md](../CONTRIBUTING.md)).
- **Before every commit:** type check, lint and `npm test` with `fail 0`. Changes to the UI also get a browser check
  (Playwright) of the real flow.
- **Docs come from the guide.** The `/docs` site is built from the `##` sections of [guide.md](guide.md)
  (`scripts/build-docs.mjs` writes `src/lib/docs-guide.ts`), so a feature is documented by editing the guide.
- **Next.js 16 has breaking changes.** Read `node_modules/next/dist/docs/` before writing Next code (see `AGENTS.md`).
- **No secrets in the repo.** Keys come from the user's settings or environment variables.

### CI (on every push)

| Workflow | What it checks |
|---|---|
| `ci.yml` | Lint, typecheck, production build, unit tests, a scriptc native build, `npm audit`, and the performance budget |
| `docker-build.yml` | The Docker image for amd64 and arm64 (pushed to GHCR from `main`) |
| `desktop.yml` | Desktop apps for macOS (Apple silicon) and Windows; publishes the downloads from `main` and on `v*` tags |
| `scriptc.yml` | Every CLI template compiles to native and WebAssembly on Linux and macOS |

## State of the work

**Done** (details in BACKLOG.md):
- **Editor.** Monaco with TypeScript intelligence, terminal, Git, file tree, command palette, themes, VS Code themes and snippets from Open VSX, a debugger for TypeScript, JavaScript and Python, and language servers for Python, Go and Rust, and a three-way merge with a conflict editor for Git pull and proposals.
- **Languages.** 40+ languages run in the studio; Python via uv; TypeScript to a native binary via scriptc.
- **Web apps.** Templates, an app gallery and a stack builder, with a live preview (in the browser, or real dev servers when local).
- **Agent.** Proposals with evidence, a second reviewer, a risk score and auto-accept, a supply-chain guard on new dependencies, fork-the-future variants, rewind, live values, why-history, project memory the agent cites, a five-stop tour for newcomers, a vibe dial from "just make it work" to "explain every line", specs to tests.
- **Autonomy.** An autonomous worker, auto-debug, production errors to a reproducing test and a fix, watchers (agents on schedules, changes and failures), a night shift (a queue run inside a budget), a channel where running agents coordinate, and a morning report.
- **Connectors and skills.** A 52-server MCP catalog plus built-ins; ecosystem skills.
- **Web3.** Solidity compile and analysis, an in-page chain, wallet deploys and a dapp starter.
- **Platform.** Desktop apps, Docker, self-healing and self-updating, the docs site, the pricing page.

**Next** (specs in ROADMAP.md):
1. Design pass, publish and phone preview.
2. Extensions, round two: keybindings, language configuration, icon themes.
3. Watchers, round two: webhooks and running with the window closed.

### Waiting on the owner

These need an account, a key or a decision only the owner can provide:

| Item | Needed for |
|---|---|
| Domain for Aha! (e.g. getaha.dev) | The public site address |
| `NEXT_PUBLIC_SITE_URL` | Correct canonical URLs, sitemap and social cards for the public site |
| Google sign-in domain | Sign in with Google |
| GitHub OAuth client id | Sign in with GitHub (device flow) |
| Tauri signing key | Signed desktop updates |
| macOS test on real hardware | Confirming the desktop install fix on a Mac |

## Known rough edges

- The editor creates Monaco models ahead of time for at most 150 TypeScript/JavaScript/JSON files (Monaco warns
  about a listener leak at 200). In bigger projects, imports from files beyond that resolve once those files are
  opened.
- `next dev` rewrites `AGENTS.md` (a heading level). Commit the change rather than fighting it.
