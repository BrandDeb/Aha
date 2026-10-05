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
WASM output additionally needs **zig** (scriptc uses it as the wasm32-wasi linker).

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
   `sudo apt install clang lld`; Windows: use WSL). Optional: [zig](https://ziglang.org/download/) for WASM and
   the terminal's `run`.
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

The workspace at `/` is a monochrome glass IDE built around scriptc.

| Area | What it does |
|---|---|
| **Projects** | File tree with folders, create/rename/move/delete, entry file, relative imports between files, autosave to the browser |
| **Terminal** | A shell over the project (`ls cd cat mv rm tree echo > file …`). `run` compiles to WASM and executes it in a Web Worker in the tab with the project mounted; files it writes appear in the explorer |
| **Build** | Native, WASM, LLVM IR or assembly; pipeline timings (queue → write → compile → package), artifact size and download, scriptc coverage, run profile (exit code, time, memory) |
| **Diagnostics** | scriptc errors drawn inline in the right file with their rewrite hint, listed in Problems and counted in the tree |
| **Git** | Pull a branch, see changed files with +/− counts, side-by-side diffs, create branches, multi-file commit & push that refuses to overwrite newer commits |
| **Assistant** | Any model you choose — free tiers (Gemini, Groq, OpenRouter, Cerebras, Mistral), local (Ollama, LM Studio) or your own Anthropic/OpenAI key: explain, fix build errors, generate tests, chat — with one-click Apply that versions the previous file first |
| **Formatting** | Prettier in the browser, format on save, configurable rules |
| **History** | Versions on save, on successful builds and before pulls/restores/assistant edits; compare and restore |
| **Graph** | Import graph from the entry, cycle detection, unused files, unresolved imports, external modules |
| **Export** | ZIP export/import, secret GitHub Gist, share links that carry the whole project |
| **Editing** | Split view, zen mode, command palette (⌘K), remappable shortcuts with export/import, built-in extensions (minimap, word wrap, bracket pairs, sticky scroll, TODO highlights, byte field) |
| **Accessibility** | Light, dark and high-contrast themes; ARIA tree, tabs and dialogs with focus management; skip link; live regions for builds and toasts; reduced motion respected |
| **Templates** | Ten starter projects including a multi-file CLI; CI compiles every one with scriptc |

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

**Fetch models** lists what your key can use (OpenRouter's free models first); **Test connection** sends a
one-word prompt and reports latency. Ollama accepts requests from `localhost` pages by default; when the
studio is hosted elsewhere, start it with `OLLAMA_ORIGINS=https://your-studio.example ollama serve`.

---

## Pages

| Route | |
|---|---|
| `/` | Workspace |
| `/landing` | Overview |
| `/unified` | Toolkit — demo panels (AI gateway, auth, URL shortener, analytics use simulated data) |
| `/faq` | Searchable FAQ |
| `/onboarding` | Three-step tour ending in the workspace with a template (`/?template=<id>`) |
| `/studio` | Redirects to `/` |

---

## Architecture

```
Browser ── Next.js 16 (App Router), React 19, Tailwind v4, Monaco
   │
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

- `target`: `exe` | `wasm` | `llvm` | `asm` (C output was removed in scriptc 0.2)
- `optimization`: `release` | `dev` (legacy `O0`–`O3` values are mapped)
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

# Compiler
MAX_CONCURRENT_BUILDS=2
SCRIPTC_LINKER=          # optional: linker driver scriptc uses for executables
```

---

## Scripts

| Command | |
|---|---|
| `npm run dev` | Custom server in development (Next.js + collaboration) |
| `npm run build` | Production build |
| `npm start` | Production server |
| `npm run lint` | ESLint |
| `npm run typecheck` | Generate route types and run `tsc` |
| `npm test` | Unit + scriptc integration tests (`node --test`) |
| `npm run templates:build` | Compile every template to `dist/templates/` |
| `npm run templates:wasm` | Same, plus WASM modules (needs zig) |
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
└── lib/                         compiler (server), compiler-browser, github, ai, ai-providers, templates
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
