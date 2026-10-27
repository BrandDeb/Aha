# Aha! roadmap

What we build next, as short specs: why it matters, what the user sees, how we build it, and when it counts as
done. [BACKLOG.md](BACKLOG.md) lists everything with its status; this file is the order and the detail for what is
next. Specs are written before code and updated when a decision changes.

## Principles

Every item is held to these. If a feature can't meet them, it changes until it can.

1. **Proposals, not surprises.** Anything an agent changes arrives as a proposal with evidence. Nothing autonomous
   writes to your files without the same review path (or an explicit, scoped auto-accept).
2. **Light by default.** Nothing heavy loads until it is used (compilers, EVMs, previews, extensions). Every release
   stays inside the performance budget (item 3).
3. **Local first, private by default.** Keys and connectors live in the user's browser or machine; the server never
   stores them. Anything that runs programs works only where the studio runs on the user's own machine.
4. **Vibe and hand-written are equal.** Every agent feature has a hand path, and every hand feature has an agent path.
5. **Verified, not claimed.** A feature ships with unit tests, a browser test of the real flow, and docs in the README
   (which is also the `/docs` site).

---

## Strategy: the editor people switch to

### The thesis

Agents now write a growing share of code. The work left to the developer shifts from typing to **steering, checking
and accepting**. The editors in use today were built for typing and add AI on top:

- **VS Code:** carries its extension API.
- **Cursor:** carries the VS Code fork it is built on.
- **Zed:** carries its native, editor-first design.
- **JetBrains:** carries its JVM.

None of them can rebuild around verification without breaking what their users already rely on. Aha has no such
weight to carry.

**The best editor of the next few years is the one where you can trust what you didn't type.** Aha wins by being:

1. **Fast where it is felt:** under the thresholds people perceive, so nobody leaves over feel.
2. **Compatible where it counts:** your repo, settings, keys, rules and extensions come with you, so nobody leaves
   over what they would lose.
3. **Clearly ahead on agent work:** changes arrive built, run, tested, reviewed and risk-scored, with the evidence.
   This is the reason to come.

### Where each heavyweight is strong, and how we answer

| | Their edge | Their limit | Our answer |
|---|---|---|---|
| **VS Code** | Extensions, reach | AI is bolted on; changes aren't verified | Run their extensions; verify every agent change |
| **Cursor** | Polished AI editing, Tab | Agent edits are trusted, not proven; tied to their credits | Proposals with evidence; any model, including local; unattended night runs |
| **Zed** | Native speed, collaboration | Small ecosystem; editing comes first, the agent second | Native core for the hot paths; an agent loop built in from the start |
| **JetBrains** | Deep semantic understanding | Heavy, slow to start, costly | One index shared by you and the agent, plus runtime values no static IDE has |
| **Copilot / Windsurf** | Distribution, price | Same verification gap | Measured acceptance rate, published |

### The scoreboard (published, run in CI, against the others on the same machine)

| Measure | Target | Today |
|---|---|---|
| Keystroke latency, p95, 20 files open | ≤ 16 ms (one frame) | 24–32 ms |
| Editor ready from launch | ≤ 800 ms | about 0.9–1.1 s |
| Open a 50k-file repository | ≤ 2 s to first edit | not possible yet (projects live in browser storage) |
| Search 1M lines | ≤ 300 ms | not measured |
| Install to first accepted proposal on your own repo | ≤ 5 min | not possible yet |
| Agent changes accepted without edits (fixed task set) | ≥ 70%, ahead of each rival | not measured |
| Regressions caught before review | reported per run | evidence and reviewer exist; not measured |

A target either has a test that measures it or is not a target.

### Tracks, in order

Track A makes switching cost nothing. Track B makes staying obvious. A comes first: without it nobody arrives to see B.

---

### A1. Real projects on disk

**Why.** Today a project lives in browser storage (about 5 MB), so nobody's real repository fits. Nothing else in this
plan matters until it does.

**What.**
- **Desktop app:** opens any folder, reads and writes it in place, and watches it for changes made by other tools.
- **Browser:** uses the File System Access API where the browser supports it, or clones from Git.
- **`aha .`** from a terminal, like `code .`.
- **Large repos:** files are indexed in the background, and the editor never waits on the whole tree.
- **Security:** the per-launch secret for every local route that runs programs ships with this item. A studio that
  reads your disk must not answer other local processes.

**Done when** a 50k-file repository opens in under 2 s to first edit, a change made outside Aha shows up within a
second, and the performance budget measures both.

### A2. Git as the backbone

**What.**
- Real Git on the opened folder: status, stage, commit, branches and merge (the conflict editor already exists).
- Every proposal is a branch and every accepted proposal a commit, so agent work fits the review flow teams already
  use. The night shift can open a PR per task with its evidence in the description.

**Done when** a proposal pushed as a branch shows up as a PR with its evidence, in a browser test against a local Git
server.

### A3. Bring my setup

**What.** On first launch, Aha finds Cursor, VS Code, Zed, Windsurf and JetBrains on the machine and offers to import,
each step previewed and optional:

| Kind | What is imported |
|---|---|
| Editor | Theme, font, editor settings, keybindings (your shortcuts by default) and recent folders |
| Extensions | Matched to Open VSX, with a list of anything that has no match |
| AI setup | `.cursorrules`, `.cursor/rules`, `.github/copilot-instructions.md` and `CLAUDE.md`, merged into `AGENTS.md` and project memory |
| MCP servers | From Cursor, VS Code and Claude Desktop configs, into connectors (commands shown in full before they are added) |
| Model keys | Found in the environment, never stored on the server |

**Done when** a real Cursor profile imports in a browser test with its theme, keybindings, rules and MCP servers, and
an existing user goes from install to first accepted proposal on their own repo in under 5 minutes.

### A4. Companion mode

**Why.** The easiest switch is not having to switch.

**What.** Aha attaches to a repository you keep editing in another IDE. The night shift, watchers, production errors
to fixes and the design pass work on their own branches and deliver PRs (or branches) with evidence. You review them
wherever you already work, and move in when Aha has earned it.

**Done when** a repo edited elsewhere gets a night-shift PR with evidence and no Aha window open during review.

---

### B1. Feel: under the perception thresholds

**What.**
- **Native core in the desktop app:** the Tauri app already has a Rust side. Move the hot paths into it:
  - file walking and watching;
  - full-text search (ripgrep's engine);
  - the symbol index;
  - Git status.
- **Editor tuning:** Monaco stays the editor surface; tune it until keystrokes stay under one frame.

**Done when** the scoreboard's keystroke, launch and search targets pass in CI on both the browser and the desktop
build.

### B2. One understanding of the code, shared by you and the agent

**What.**
- **One index** over tree-sitter, the language servers, the import graph, the why-history and runtime values (live
  values, rewind).
- **Inputs to the agent:** it gets the same view you do, plus what the code *did* when it ran. Static IDEs don't have
  the second.
- **TypeScript:** full language intelligence through tsserver, and more languages through LSP.

**Done when** go-to-definition, references and rename work across TypeScript, Python, Go and Rust on a large repo, and
the agent's brief includes the runtime values of the lines it changes.

### B3. Extensions people actually use

**What.**
- **Desktop app:** a VS Code-compatible extension host, so the top 100 Open VSX extensions run for real (language
  extensions, linters, formatters, Vim).
- **Browser:** keeps the declarative subset (themes, snippets, grammars).

**Done when** the top 20 extensions by installs work in a browser test of the desktop build, each one listed.

### B4. The best agent results, measured

**What.**
- **A public benchmark:** a fixed set of 50 real tasks (fix the failing test, add the endpoint, upgrade the
  dependency, migrate the API) run through Aha, Cursor's agent and Copilot's agent on the same model.
- **What it measures:** acceptance without edits, regressions caught before review, and minutes of human review per
  task.
- **What we do with it:** results are published with every release. Anything we lose becomes the next item.

**Done when** the benchmark runs on demand and its numbers go into the release notes.

### B5. Private by default, local when you want

**What.**
- One switch for local models only, with an audit log of everything the agent read, ran and sent.
- Presets for local servers (Ollama, LM Studio and colibri for large mixture-of-experts models), each added only after
  a measured run shows it can finish an agent task within a time the preset states.

**Done when** a full proposal (plan, edits, build, review) completes with no network access beyond the machine.

### B6. Table stakes, no gaps

Vim mode, multi-root workspaces, remote development over SSH and dev containers (desktop app first), settings sync and
inline next-edit tuned against Cursor's Tab. Each ships with a browser test, and each one closes a reason to go back.

---

## Now

### 1. Proactive agents: watchers

> **Shipped** (first version): schedule, interval, file-change and failure triggers; suggest or start; one run per
> event; premise check; review and daily-budget limits; the hold-back log. Still to do from this spec: the message
> trigger (webhooks, agent channels), running with the window closed (desktop app) and money/token budgets.

*Inspired by [proactiveagents.dev](https://proactiveagents.dev): agents that wake on their own instead of waiting to
be asked, keep state between runs, and know when not to act.*

**Why.** The worker and auto-debug already act on their own, but only on what happens inside the editor while it is
open. Teams want "every morning, check the dependencies", "when CI goes red, start a fix", "when an issue is labelled
`agent`, draft it".

**What the user sees.** A **Watchers** panel (Agent group). A watcher is a sentence plus a trigger:

| Trigger | Examples |
|---|---|
| **Time** | every weekday 08:00; every 15 minutes while open |
| **Change** | a file matching `src/**/*.ts` changes; a contract breaks; a dependency gets an advisory; a GitHub issue gets a label; CI fails |
| **Message** | a webhook URL (local studio / desktop app) or a message from another agent (item 2) |

Each watcher shows its last runs, what it did, and what it **decided not to do** and why (a restraint log), so
silence is visible.

**How.**
- `lib/watchers.ts` (pure): watcher definitions, cron parsing, change matching, a dedupe key per event
  (idempotency), "is the premise still true?" checks before acting (stop when stale).
- Runs use the existing proposal machinery with a per-watcher budget (runs per day, tokens, money); over budget →
  paused with a notice.
- State in `.aha/watchers.json` (definitions, travel with the project) and the browser/desktop store (run history).
- Desktop app and local studio keep watchers running in the background; the browser runs them while open.
- Webhook trigger: a signed URL per watcher (HMAC secret), local studio only.

**Done when.** A "dependency check every morning" watcher and a "CI failed → debug proposal" watcher run end to end
in a browser test with a mock model; duplicates of the same event start one run; over-budget pauses; the restraint
log records skipped runs; docs written.

**Risks.** Noise (too many proposals): default to "Suggest" (notify only) with "Act" opt-in per watcher.

### 2. Agent channels (agents that talk to each other)

> **Shipped** (first version): the channel, the five agent tools, open / ask first / off, questions to you with a
> notice, searchable history in `.aha/channels/`. Still to do: a bridge to an external relay so a teammate's agent can
> join, and per-proposal access settings.

*Inspired by [Agent Relay](https://agentrelay.com): agents message each other directly instead of the human copying
answers between them.*

**Why.** Big changes cross boundaries: the front-end proposal needs to know the API the back-end proposal is changing.
Today each proposal runs alone and the user relays.

**What the user sees.** A **channel** per project in the Agent tab: running proposals post decisions ("renamed
`/api/items` to `/api/products`"), ask each other questions, and hand off tasks. The user reads and writes in the same
channel. Each proposal shows the messages it sent and received next to its evidence.

**How.**
- New agent tools: `post_message`, `ask_agent` (blocks with a timeout, answered by the other proposal's agent between
  its steps) and `list_agents`. Messages are typed with a small schema (decision, question, answer, handoff).
- Access: per proposal **open / ask first / closed**; the user approves "ask first" requests.
- History saved in `.aha/channels/<date>.jsonl`, searchable, so later agents learn past decisions.
- Later: bridge a channel to an external relay (Agent Relay or MCP) so a teammate's agent can join.

**Done when.** Two forked proposals coordinate an API rename through the channel in a browser test (mock model), the
user can answer a question in the channel, and the history is searchable.

### 3. Performance budget in CI

> **Shipped:** `npm run perf` and the *Performance budget* CI job (sizes +5%, timings +50% over `perf-budget.json`).
> A deliberate 150 KB regression on `/docs` fails it. Not measured yet: lazy chunks on first paint as a separate number.

**Why.** "Lightweight and fast" must be measured or it decays.

**What.** A CI job that builds the app and fails when the budget is exceeded: first-load JS for `/` and `/docs`, the
number of lazy chunks loaded on first paint, cold start to an interactive editor (Playwright), keystroke latency with
20 tabs open, memory after opening 20 files.

**How.** `scripts/perf-budget.ts` reads Next's build manifest and runs a Playwright trace; thresholds in
`perf-budget.json`; the report is posted as a job summary.

**Done when.** The job runs on every PR, has today's numbers as the baseline (+5%), and a deliberate regression in a
test branch makes it fail.

### 4. Extensions (VS Code-style, from Open VSX)

> **Shipped** (first version): the Extensions panel (search, popular, project recommendations, on/off, uninstall),
> colour themes and snippets. Dracula and the ES7 React snippets pass a browser test, and uninstalling restores the
> studio theme. Still to do: keybindings, language configuration and icon themes. The Vim keymap moves to Vim mode
> (item 68 in the backlog), because VSCodeVim is code, not a declarative contribution.

**Why.** Users expect their theme, snippets and keymap.

**What.** An **Extensions** panel: search [Open VSX](https://open-vsx.org), install, enable/disable, per-project
recommendations from `.vscode/extensions.json`. Supported contributions: colour themes, snippets, keybindings,
language configuration (brackets, comments), icon themes. Curated defaults: One Dark Pro, Dracula, GitHub theme,
Catppuccin, Tokyo Night, Nord, ES7 React snippets, Python and Solidity snippets, Vim keymap.

**How.** The server fetches the `.vsix` (a zip) from Open VSX and extracts only declarative JSON (no code runs).
Themes become Monaco themes, snippets become completion providers, keybindings map to studio commands. Extensions
with code are listed as "not supported yet". Running real extension code (a sandboxed extension host) is under Later.

**Done when.** Installing Dracula, the ES7 React snippets and the Vim keymap works in a browser test; uninstall
reverts cleanly; nothing from the `.vsix` is executed.

---

## Next

### 5. Debugger (Debug Adapter Protocol)

> **Shipped:** breakpoints in the gutter, step over/into/out, call stack, variables, watches, hover values and a
> debug console, for TypeScript and JavaScript (Node inspector) and Python (debugpy over DAP). Both pass a browser
> test. Next: conditional breakpoints and logpoints, break on exceptions, Go and Rust (Delve, CodeLLDB).

Breakpoints, step, call stack, watch and hover values for Node (inspector protocol) and Python (debugpy), in the
editor gutter, local studio only. Rewind already covers "what happened"; this adds "stop here". *Done when* a
breakpoint in a TS and a Python program stops, steps and shows locals in a browser test.

### 6. Language intelligence beyond TypeScript (LSP)

> **Shipped:** Python (Pyright), Go (gopls) and Rust (rust-analyzer): completion, hover, go to definition (across
> files, in tabs), references, rename across files and diagnostics. Servers come from the PATH or install on first
> use. Bridged over HTTP with a long poll rather than a WebSocket, so it uses the same checks as every other route.
> Rename and go-to-definition pass a browser test in Python and Go. Next: Solidity, code actions and formatting.

Language servers (pyright/basedpyright, gopls, rust-analyzer, solidity-ls) started on demand on the local runtime and
bridged to Monaco over a WebSocket: completion, hover, go to definition, rename, diagnostics. *Done when* rename and
go-to-definition work in Python and Go projects.

### 7. Merge-conflict editor

> **Shipped:** Pull merges into your changes (three-way, line by line); conflicts open side by side with keep
> yours / theirs / both and an editable result. Proposals that touch files you edited since merge the same way.
> A conflicted pull resolves in a browser test.

Three-way view (yours, theirs, result) with accept-per-hunk, used by Git pull and by proposals that conflict with
newer edits. *Done when* a conflicted pull resolves without leaving the studio.

### 8. Night shift

> **Shipped:** a queue, a start time, per-task and whole-night budgets for time and tokens (a new token cap in the agent
> loop), and a Night shift section first in the morning report. Three tasks became three proposals and a runaway task
> was stopped by its token budget in a browser test. Still to do: running with the window closed (desktop app).

Queue tasks before you leave; the worker runs them overnight inside a money and time budget; the morning report shows
the results as proposals. Built on watchers (item 1) with a time trigger. *Done when* three queued tasks produce three
proposals and a report, and the budget stops a runaway task.

### 9. Production to fix

> **Shipped:** Fix a production error (Debug tab, command palette) reads Node and Python traces, logs and Sentry links,
> maps server paths to project files, and asks for a reproducing test first (node:test or unittest beside the module),
> then the fix and the same test passing. A pasted Node trace and a pasted Python traceback each ended in a proposal with
> a test that failed before the fix and passed after it, in a browser test.

Paste a stack trace, a Sentry issue link (through the Sentry connector) or a log excerpt: the agent maps frames to
source, writes a failing test that reproduces it, fixes it, and shows the test passing. *Done when* a pasted Node and
Python trace each end in a proposal with a reproducing test.

### 10. Supply-chain guard

> **Shipped:** new dependencies in a proposal are checked for look-alike names (npm, PyPI, crates.io), names not on
> the registry, install scripts, age and downloads, OSV advisories and licence, before the risk score; each finding
> holds auto-accept and is listed on the proposal. With auto-accept on, `expresss` and a made-up package were held
> with their reasons and `zod` went through, in a browser test against the live registries.

Every new dependency in a proposal is checked before the risk score is computed: typosquats (edit distance to popular
names), install scripts, age and downloads, known advisories (OSV), licence. Findings hold auto-accept. *Done when* a
proposal adding a typosquatted package is held with the reason shown.

### 11. Project memory and guided tour

> **Shipped:** `.aha/memory.md` with decisions, conventions and gotchas, written by the agent's `remember` tool as part
> of a proposal (memory edits hold auto-accept), given to every task and cited as `[m2]`; the proposal lists what it
> relied on. A five-stop tour built from the import graph and the why-history, offered when a project is first opened.
> In a browser test, a new project offered its tour and each stop opened its file, one proposal recorded a convention,
> and a later proposal was told it and cited it.

`.aha/memory.md` the agent maintains (decisions, conventions, gotchas), and a five-stop tour of any codebase for
newcomers generated from the import graph and the why-history. *Done when* a new project gets a tour and the agent
cites memory in a later proposal.

### 12. Vibe dial, design pass, publish, phone preview

> **Vibe dial shipped:** four stops in the Agent tab shape the agent's brief (how much it explains, when it asks) and the
> reviewer's depth; the middle stop changes nothing. In a browser test, the agent and the reviewer each got the
> setting's instructions, the summary followed them, and the setting was kept across a reload.
>
> **Design pass shipped:** a button on the in-browser preview measures the rendered page (type scale, spacing grid,
> WCAG contrast, empty lists) and reads the source for missing loading and empty states; the agent gets the findings
> and a screenshot, and the proposal shows before and after with the numbers. In a browser test, a messy React page
> went from 3 contrast failures and 7 off-grid spacing values to none.
>
> **Phone preview shipped:** Phone in the preview bar opens a keyed proxy on the machine's network address to the dev
> server (which stays on 127.0.0.1) and shows its QR code; pages and the hot-reload websocket pass through, everything
> else gets a 403, and it closes when stopped, unused or the dev server stops. In a browser test, an emulated phone
> opened the link, an edit in the studio reached it by hot reload, a visitor without the key was refused, and the link
> died on Stop. Publish is next.

- **Vibe dial:** one setting from "just make it work" to "explain every line", shaping the brief, review depth and
  how often the agent asks.
- **Design pass:** one click on the preview: spacing scale, type scale, contrast, empty and loading states, as a
  proposal with before/after screenshots.
- **Publish:** web apps to a static host (Vercel/Netlify/Cloudflare connectors) and CLIs to a GitHub release, from one
  button.
- **Phone preview:** a QR code for the dev server's LAN address (local studio and desktop app).

### 13. Contract verification and more web3
Verify deployed contracts on Etherscan and Sourcify from Deploy & run; Foundry `forge test` results inside the panel;
a transaction debugger (opcode and source stepping) later.

---

## Later

- **Extension host** for extensions that run code, in a sandboxed worker with a narrow API.
- **TextMate grammars** (vscode-textmate + oniguruma wasm), loaded only for languages in use.
- **Remote development** over SSH and dev containers (desktop app first).
- **Multi-root workspaces** and **settings sync** (needs accounts and a domain).
- **Community gallery**: share a project as a remixable link (needs hosting and moderation).

---

## How an item moves

1. The spec above is agreed (problem, user-visible behaviour, approach, done-when).
2. Built behind no flag unless it is risky; unit tests for the pure parts, a browser test for the real flow.
3. README section written (it is also the `/docs` page); BACKLOG status updated.
4. Merged when CI is green and the done-when holds.
