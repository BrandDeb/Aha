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
Queue tasks before you leave; the worker runs them overnight inside a money and time budget; the morning report shows
the results as proposals. Built on watchers (item 1) with a time trigger. *Done when* three queued tasks produce three
proposals and a report, and the budget stops a runaway task.

### 9. Production to fix
Paste a stack trace, a Sentry issue link (through the Sentry connector) or a log excerpt: the agent maps frames to
source, writes a failing test that reproduces it, fixes it, and shows the test passing. *Done when* a pasted Node and
Python trace each end in a proposal with a reproducing test.

### 10. Supply-chain guard
Every new dependency in a proposal is checked before the risk score is computed: typosquats (edit distance to popular
names), install scripts, age and downloads, known advisories (OSV), licence. Findings hold auto-accept. *Done when* a
proposal adding a typosquatted package is held with the reason shown.

### 11. Project memory and guided tour
`.aha/memory.md` the agent maintains (decisions, conventions, gotchas), and a five-stop tour of any codebase for
newcomers generated from the import graph and the why-history. *Done when* a new project gets a tour and the agent
cites memory in a later proposal.

### 12. Vibe dial, design pass, publish, phone preview
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
