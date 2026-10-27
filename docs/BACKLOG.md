# Aha! backlog

> The order and the specs for what comes next are in [ROADMAP.md](ROADMAP.md).

Everything we have talked about or recommended, in one place, with where it stands. **Done** items shipped on
`claude/aha-repository-yvfgce` (PR #15) with tests and a browser check; **Now** is being built; **Next** is queued
in this order; **Later** needs a decision, an account or a bigger piece of work first. Items marked *needs you*
wait on something only the owner can do (a domain, a key, an account).

Goal: an editor that competes with VS Code, JetBrains, Zed, Cursor, Windsurf, Devin and Remix IDE by being
lighter and faster, and by doing things none of them do: the agent and the editor as one workspace, every change
as a proposal with evidence, and vibe coding and hand-writing as equals.

---

## 1. Novel features (our edge)

| Feature | Status | Notes |
|---|---|---|
| Proposals with evidence (agent work as reviewable tabs) | Done | builds, runs, contracts, reviewer, per-file accept |
| Second reviewer on every proposal | Done | a different model can review |
| Harness² approaches (compare variants of the agent's setup) | Done | |
| Live values (what each line did, inline) | Done | TS, JS, Python |
| **Rewind** (scrub through a run, variables at every moment) | Done | crash-first, ask about a moment |
| Contracts (rules with checks, held on every proposal) | Done | |
| **Specs → property tests** (plain English to fast-check / Hypothesis + contract) | Done | 9 properties offline, agent for the rest |
| **Risk score + auto-accept** | Done | holds secrets, CI, auth, schema, removed tests |
| Why-history (the reason behind every line) | Done | |
| Morning report | Done | |
| Autonomous debugging + worker | Done | |
| **Click-to-edit preview** (pick an element, edit text/classes in source, or ask) | Done | exact for React/Preact |
| **Fork the future** (3 directions at once, compared live side by side) | Done | |
| **Build from a picture** (screenshot or sketch to app) | Done | needs a vision model |
| **Remix** (a GitHub repo or a website, your way) | Done | licence shown; sites rebuilt as original |
| AI autocomplete (any model, cached, cancel-as-you-type) | Done | |
| Model advisor (which model for which job, and why) | Done | |
| Vibe dial (from "just make it work" to "explain every line") | Next | one setting that shapes the agent's brief, review depth and how much it asks |
| Design pass (one click: spacing, type scale, colour, contrast, empty states) | Next | agent skill + visual audit of the preview |
| Publish (one click to a public URL; CLI binaries to a release page) | Next | static export for web apps; GitHub release for CLIs |
| Mobile preview by QR code | Next | LAN URL of the dev server as a QR; needs the desktop app or a local server |
| Community gallery (share a project as a remixable link) | Later | needs hosting and moderation |
| Night shift (queue tasks, the worker runs them overnight inside a budget) | Next | builds on the worker and morning report |
| Production to fix (paste a stack trace or a Sentry link, get a reproduction and a fix) | Next | |
| Project memory and guided tour (what this codebase is, for a newcomer, in 5 stops) | Next | |
| Supply-chain guard (new dependencies checked for typosquats, install scripts, advisories, licence) | Next | extends the risk score |
| **Watchers: proactive agents** (schedule, interval, change and failure triggers; restraint log; budgets) | Done | background running and webhook triggers: Next |
| **Agent channels** (proposals message each other; typed messages; open / ask first / off; searchable history) | Done | a bridge to external relays: Later |

## 2. Table stakes (what every top editor has)

| Feature | Status | Notes |
|---|---|---|
| Monaco editor, tabs, split, zen, command palette, keybindings | Done | |
| Terminal (real shell locally, WASM sandbox otherwise) | Done | |
| Git and GitHub (branches, pull, commit, PR-friendly) | Done | |
| Formatting, diagnostics for TS/JS | Done | |
| **Extensions** (VS Code-style, from Open VSX) | Done (themes, snippets) | keybindings, language configuration and icon themes next; see section 4 |
| Debugger (breakpoints, step, watch) | Done (TypeScript, JavaScript, Python) | conditional breakpoints, exceptions, Go and Rust next |
| Language intelligence beyond TS (LSP: Python, Go, Rust) | Done | Solidity, code actions and formatting next |
| Merge-conflict editor (3-way) | Next | |
| Vim and Emacs keymaps | Next | monaco-vim; ships as an extension |
| Remote development (SSH / containers / Codespaces-style) | Later | desktop app first |
| Multi-root workspaces | Later | |
| Settings sync across devices | Later | needs accounts (*needs you*: sign-in domain) |

## 3. Skills (built in, work out of the box)

Skills are instruction folders the agent loads when a task calls for them (Agent Skills format). Built-ins ship
with the studio; more install from any GitHub repository.

| Pack | Status |
|---|---|
| Core engineering (debugging, TDD, tests, review, refactoring, security, performance, API and CLI design, components, database changes, smart-contract security, docs, upgrades, creating skills) | Done |
| **Popular open-source ecosystems** (Done, 31 skills): React/Next.js, Vue/Nuxt, Svelte/SvelteKit, Tailwind, shadcn/ui, Node/Express/Hono, TypeScript strictness, Vite, Prisma/Drizzle, Python/FastAPI, Django, pandas, pytest, Go, Rust/cargo, Docker, GitHub Actions, Kubernetes basics, Playwright, Vitest/Jest, OpenAPI, GraphQL, PostgreSQL, Redis, accessibility, SEO, i18n, Conventional Commits and releases, Solidity/Foundry/Hardhat, viem/wagmi dapps | Done |
| Popular skill collections one click away (Anthropic, Superpowers, Trail of Bits, Hugging Face, Vercel) | Done |

## 3b. Connectors

| Piece | Status |
|---|---|
| Built-in connectors: GitHub, web fetch and search, SQLite, PostgreSQL, custom commands | Done |
| **Connector catalog**: 52 MCP servers in 12 categories, checked to exist, one-step add and test, OAuth through mcp-remote | Done |
| Catalog kept fresh: a CI job that checks every package and URL still resolves | Next |
| OAuth for remote MCP servers handled in the studio itself (no mcp-remote), so they work in the browser too | Later |

## 4. Extensions (VS Code-style)

Running real VS Code extensions needs VS Code's extension host, which is heavy (a full Node process per window)
and would undo the "lightweight" goal. The plan instead:

| Piece | Status |
|---|---|
| Declarative extensions from **Open VSX** (the open VS Code marketplace): colour themes and snippets | Done |
| Keybindings, language configurations, file icon themes | Next |
| Extensions panel: search Open VSX, install, enable/disable, uninstall, per-project recommendations (`.vscode/extensions.json`) | Done |
| Curated popular list: One Dark Pro, Dracula, GitHub, Catppuccin, Tokyo Night, Nord, ES7+ React snippets | Done |
| Vim keymap | Next, as Vim mode (monaco-vim), since VSCodeVim is code |
| Native extension API (commands, panels, status-bar items, code actions) in a sandboxed iframe or worker | Next |
| TextMate grammars (vscode-textmate + oniguruma wasm), loaded only for languages in use | Later |
| LSP-based language extensions | Later (with language intelligence) |

## 5. Web3: Remix IDE-level tooling for smart contracts and dapps

| Piece | Status |
|---|---|
| Solidity, Vyper, Move, Cairo starters; smart-contract-security skill | Done |
| **Solidity compiler in the browser** (solc-js, version picked from the pragma) with errors in the editor | Done |
| **Deploy & run**: an in-browser EVM (no node, no faucet), accounts with test ETH, deploy, and a form per ABI function (call/transact, payable value, events, gas used) | Done |
| Static analysis (common pitfalls: reentrancy, tx.origin, unchecked calls, floating pragma…) | Done |
| Injected wallet (MetaMask etc.) to deploy to a real testnet | Done |
| Etherscan / Sourcify verification from the panel | Next |
| Foundry and Hardhat projects: `forge test` / `npx hardhat test` as contracts in the studio; gas report | Next (runs where commands run) |
| Debugger for transactions (opcode/source stepping) | Later |
| Dapp starter: Vite + React + wagmi + viem, talking to the deployed contract | Done |

## 6. Performance and lightweight

| Item | Status |
|---|---|
| Measured cold start, bundle split, lazy panels, Monaco on demand | Done |
| Everything heavy is loaded only when used (preview bundler, compilers, solc, extensions) | Ongoing rule |
| Performance budget: JavaScript per page, editor ready, keystroke latency and memory with 20 files, checked in CI | Done |
| Web worker for language services and search; virtualised file tree and long lists | Next |
| Startup trace and a perf panel in Settings → About | Later |

## 7. Waiting on the owner (*needs you*)

| Item | Why |
|---|---|
| Google sign-in | needs a domain |
| GitHub OAuth app (`AHA_GITHUB_CLIENT_ID`) | GitHub sign-in in production |
| `NEXT_PUBLIC_SITE_URL` | canonical URLs, sitemap, OG images |
| Tauri updater signing key | signed desktop updates |
| Testing the macOS app on a real Mac | |
