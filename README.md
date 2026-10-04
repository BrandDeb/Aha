# NanoCLI Studio

> **TypeScript in. Native binary out.**

A browser IDE for building command-line tools. Write ordinary TypeScript, compile it on the server with
[scriptc](https://scriptc.dev) — Vercel Labs' TypeScript-to-native compiler — and download a single
executable that runs without Node.js.

[![CI/CD Pipeline](https://github.com/BrandDeb/Aha/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/BrandDeb/Aha/actions/workflows/ci-cd.yml)
[![scriptc](https://github.com/BrandDeb/Aha/actions/workflows/scriptc.yml/badge.svg)](https://github.com/BrandDeb/Aha/actions/workflows/scriptc.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

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

| | |
|---|---|
| **scriptc 0.2 compilation** | Native executable, WASM (WASI Preview 1), LLVM IR or assembly from the same source |
| **Inline diagnostics** | scriptc errors (code, location, rewrite hint) are drawn in the editor and listed under Problems |
| **Coverage analysis** | "Check coverage" runs `scriptc coverage`: percentage that compiles statically, plus each blocker |
| **Templates** | Nine starter programs; CI compiles every one with scriptc on Linux and macOS |
| **Monaco editor** | TypeScript IntelliSense configured for Node programs (no DOM globals), ⌘↵ to compile |
| **GitHub** | Browse repos and folders, open a file, commit changes back with conflict detection |
| **Live collaboration** | WebSocket relay with origin checks and server-assigned identities |
| **Share links** | Encode the current program in a URL |

Native executables are linked for the machine the server runs on (no cross-compilation in the default
image). Use the WASM target for a portable artifact.

---

## Pages

| Route | |
|---|---|
| `/` | Editor — templates, editor, Problems/Output/Console, build inspector and coverage |
| `/studio` | Studio — multi-file explorer, simulated terminal, GitHub browser and commits |
| `/unified` | Toolkit — editor plus demo panels (AI gateway, auth, URL shortener, analytics use simulated data) |
| `/landing` | Overview / marketing page |
| `/faq` | Searchable FAQ |
| `/onboarding` | Three-step tour ending in the editor with a template loaded (`/?template=<id>`) |

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

On failure, `diagnostics` holds `{ line, column, severity, code, message, hint }` entries and `error`
summarizes the first one. Sources are limited to 512 KB, builds to 60 s and `MAX_CONCURRENT_BUILDS`
(default 2) at a time.

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
├── app/
│   ├── page.tsx                 Editor
│   ├── studio/ unified/ landing/ faq/ onboarding/
│   ├── globals.css              Design tokens (Geist-style dark system)
│   └── api/                     compile, coverage, download, github, ws
├── components/
│   ├── CodeEditor.tsx           Monaco + theme + scriptc markers
│   └── SiteHeader.tsx           Header, nav and footer
├── edge/index.ts                Edge request handlers (auth check, URL shortener)
└── lib/
    ├── compiler.ts              scriptc wrapper (server only)
    ├── compiler-browser.ts      Client for the compile/coverage APIs
    ├── templates.ts             Starter programs (compiled in CI)
    ├── github.ts                GitHub REST helpers
    └── websocket.ts             Collaboration client
scripts/build-templates.ts       Builds every template with scriptc
tests/                           node:test suites
server.js                        Custom server + WebSocket relay
```

---

## Contributing

1. Fork and branch from `main`
2. `npm run lint && npm run typecheck && npm test`
3. Open a pull request

New templates go in `src/lib/templates.ts`; the test suite compiles each one with scriptc, so keep them
inside scriptc's supported surface (narrow `catch` bindings, no `eval`, ES modules).

## License

MIT
