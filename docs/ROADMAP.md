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

**Status.** Shipped: the launch key (`scripts/launch-key.js`, SECURITY.md) and `npm run open` / `aha`; opening a folder
in place with outside changes; large repositories (every name at once, text on demand and in the background, a tree
that starts closed); Run, the terminal and the dev server in the folder itself, never rewriting it. Next: the File System
Access API for browsers, and the 50k-file open time in the performance budget.

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

### A5. Sign in on first launch, on macOS, Windows and Linux

**Why.** An account carries your settings, plan, keys you choose to sync and team membership from one machine to the
next, and it is what Team and Business plans (below) are billed and administered by.

**What.**
- **On first open** of the desktop app (macOS, Windows and, new, Linux) and of a fresh browser profile, the studio
  asks you to sign in with **GitHub** or **Google**.
  - GitHub uses the device flow the studio already has.
  - Google uses the installed-app flow: the system browser opens, and the answer returns to a loopback address with
    PKCE. A desktop app needs no domain for this, but it does need a Google OAuth client (*needs you*).
- **Continue without an account** stays available for local, private use (principle 3). The studio works fully
  offline with your own or a local model; signing in is what unlocks sync and the paid plans.
- **Linux desktop app:** an AppImage and a `.deb` from the same Tauri build, in the release workflow next to the
  macOS and Windows builds.
- The session token stays in the operating system's keychain (Keychain, Credential Manager, Secret Service), never
  in the page.

**Done when** a browser test signs in with each provider against mock OAuth servers, the desktop builds for all three
platforms show the sign-in screen on first launch, and "continue without an account" leaves no network calls behind.

**Status.** Shipped: the signed account session; GitHub and Google sign-in (device flow, tested against mock providers);
the first-launch screen (skipped when a server has no provider or someone is signed in) and the top-bar menu; the Linux
desktop build in CI (AppImage and `.deb`, with an install-and-start smoke test) and on the download page. Waiting on the
owner: a Google OAuth client, and the decision whether the released installers embed it.

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

## Strategy, part two: what nobody else ships

Tracks A and B make Aha as good as the heavyweights and easy to move to. This part is about the reasons someone tells
a friend to switch. It starts from what the field shipped in 2026 and what developers say is still broken.

### What the field shipped in 2026

| Who | What they shipped | What it tells us |
|---|---|---|
| **Cursor** | Cursor 3 (April): an Agents Window running agents locally, in worktrees, in the cloud and over SSH, plus Design Mode and a built-in browser. Composer 2, their own model. Since September: Security Review on every PR, Rollouts (deploy health per PR), remote control of local agents from iOS, canvases from cloud agents, an Agent SDK with evals. | The IDE is turning into mission control for many agents. Their trust features (Security Review, Rollouts) are for Teams and Enterprise plans only. |
| **Lovable** | Design systems on paid plans, Figma import, design questions when a prompt leaves the look open (October). `/goal` runs of up to 10 hours. Drafts (try changes on a copy). Tests written for business rules. Migrations that refuse breaking changes. WebMCP tools in generated apps. Domains bought from chat. | Prompt to app is now prompt to *product*: design taste, long autonomous runs, safety rails on data. |
| **GitHub Copilot** | Local sandboxing generally available (files, network, credentials). CLI generally available. Computer use in preview. | Agent containment is becoming expected. |
| **Google Antigravity 2.0** | A standalone agent app: parallel subagents, async and scheduled tasks, workspaces that span several folders. | The same move to mission control. |
| **Zed** | 1.0. The Agent Client Protocol (ACP, with JetBrains), so Claude Code, Codex and Gemini CLI run inside the editor. Delta: diffs next to agent chats, commented on live by a team. | Agents are becoming plug-ins; the editor that hosts them best wins. |
| **Kiro** | Specs (requirements, design, tasks), steering files, hooks on file events. | Planning before code is now a product. |
| **Claude Code** | Background subagents by default, `/fork`, routines (scheduled cloud runs), a desktop app with sessions, diffs and preview. | Unattended work is normal. |
| **Platform** | WebMCP (W3C draft from Google and Microsoft, in a Chrome origin trial): sites declare tools that browser agents call. YC's Fall 2026 request for startups lists multiplayer AI. | The web is becoming agent-readable; teams want to share agent sessions. |

Sources: the [Cursor changelog](https://cursor.com/changelog), [InfoQ on Cursor 3](https://www.infoq.com/news/2026/04/cursor-3-agent-first-interface/),
the [Lovable changelog](https://docs.lovable.dev/changelog), the [GitHub changelog](https://github.blog/changelog/label/copilot/),
[XDA on Antigravity 2.0](https://www.xda-developers.com/google-antigravity-2-beats-claude-code-codex-at-their-own-game/),
the [Claude Code changelog](https://code.claude.com/docs/en/changelog) and the
[WebMCP tutorial](https://www.datacamp.com/tutorial/webmcp-tutorial). Dates and details come partly from secondary
coverage and are checked again before anything is said publicly.

### What is still broken

- **Trust.** In Sonar's 2026 State of Code survey, 96% of developers don't fully trust AI-generated code and only 48%
  always check it before committing. 38% say AI code takes more effort to review than human code.
  ([Sonar](https://www.sonarsource.com/blog/state-of-code-developer-survey-report-the-current-reality-of-ai-coding/))
- **Almost right.** The most common frustration (66% in Stack Overflow's 2025 survey) is a fix that is almost right,
  but not quite. ([The Register](https://www.theregister.com/2025/07/29/coders_are_using_ai_tools/))
- **Usage.** 90% of professional developers use AI agents at work every week, 68% daily (JetBrains Developer Ecosystem
  Survey 2026). The review load grows with every agent added.
- **Cost surprises.** Cursor's credit changes drew a public apology and cancellations, and the same agent task can cost
  very different amounts from run to run.
  ([TechCrunch](https://techcrunch.com/?p=3025199), [cost per task](https://www.kunalganglani.com/blog/ai-agent-cost-per-task-2026))
- **Everything looks the same.** Generated sites share a fingerprint: purple gradients, Inter, three rounded cards, the
  same hero. Banning one tell moves the model to the next most likely look.
  ([why AI sites look the same](https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website))
- **Nobody proves the work.** No one ships verifiable proof that an agent's change does what it claims. The field
  measures cost per attempt, not cost per change that was accepted.

Everyone is racing to run *more* agents. Our bet is the other half of the problem: **making agent output provable,
so a person can say yes in seconds.** More agents only help if someone can check their work.

### The bets

Each bet starts from something Aha already has that the others don't (evidence, a reviewer, risk scores, rewind, live
values, fork the future, the design pass), so these are extensions of working code, not new products.

#### C1. Any agent, checked by Aha

**Headline:** *Use Claude Code, Codex or Gemini. Aha checks their work.*

**Why.** Developers have favourite agents and won't give them up. Zed made ACP the standard for hosting them. We host
them and add what nobody else has: every change becomes a proposal with evidence, a second review and a risk score.
This turns every agent's users into potential Aha users instead of a rival's customers.

**What.**
- An ACP client in Aha: pick Claude Code, Codex, Gemini CLI or Aha's own agent per task.
- Whatever the agent writes lands in a proposal: built, run, tested, reviewed, risk-scored, with its why-history.
- Agents run in a sandbox (files, network and credentials scoped per task). This matches Copilot's sandboxing and is
  on every plan, not just Enterprise.

**Done when** a Claude Code task and a Codex task each arrive as proposals with evidence, in a browser test with mock
ACP agents, and a sandboxed agent can't read outside its project or reach a host that isn't allowed.

#### C2. Receipts: proof that travels with the change

**Headline:** *The first AI changes that come with proof.*

**Why.** "Trust me" is the industry standard. A receipt is a link anyone can open to see what the change did, without
installing anything or trusting the author.

**What.**
- **Contents:** the task, the plan, the diff, the commands that ran with their output, the tests (old and new) with
  results, the reviewer's notes, the risk score, the cost and the model.
- **Replay:** the rewind recording, played back in the browser.
- **Tamper evidence:** hashes over everything, so an edited receipt shows as edited.
- **In PRs:** attached to the night shift's and companion mode's PRs (A2, A4) as a link with a summary.
- **Badge:** an "Aha-verified" check on GitHub that links to the receipt.

**Done when** a receipt opens from a PR in a fresh browser with no account, replays the run, and fails its check when
one byte of it is changed.

#### C3. Behaviour diff: what changed when it ran, not just in the text

**Headline:** *Don't read the diff. Watch what changed.*

**Why.** "Almost right" is a behaviour problem, and a text diff hides it.

**What.** Aha runs the code before and after the change against the same inputs and shows what *behaved*
differently:
- **Web apps:** screenshots side by side, with changed regions highlighted.
- **APIs:** the same recorded requests, with responses diffed.
- **Functions:** the live values of the changed lines, before and after.
- **Tests:** which ones changed outcome.

Anything that changed but wasn't in the task is flagged first. That is where "almost right" hides.

**Done when** a planted off-by-one in a proposal shows up as a flagged behaviour change that the text diff and the
tests both missed, in a browser test.

#### C4. Taste: prompt to a site that doesn't look generated

**Headline:** *Prompt to a website a designer would sign.*

**Why.** Lovable's lead is the look, and every generated site still looks related. Taste can be measured and
searched for: a different look can be designed in on purpose rather than hoped for.

**What.**
- **Art directions first:** before any code, three distinct directions as live previews from fork the future (type
  pairing, palette, density, layout grammar). You pick one or mix them.
- **Design DNA:** pull a design system from a URL, a screenshot or a Figma file (tokens, type scale, spacing, motifs)
  and hold every later change to it.
- **Slop score:** a measured check for the known tells (default gradients, default font, the card trio, centred-hero
  sameness) next to the design pass's contrast, type and spacing scores. The agent iterates until both pass.
- **On the proposal:** the before and after images and the score change, as the design pass already does.

**Done when** ten fixed prompts produce sites that pass the slop check and the design pass. In a blind comparison
against the same prompts in Lovable and v0, the results are published whatever they say.

#### C5. Ship-ready check: tested by simulated users, ready for agents

**Headline:** *Every app gets tested by ten AI users before it ships.*

**Why.** Lovable tests business rules, and Cursor reviews security on Teams plans. Nobody runs the app as its users
will.

**What.**
- **Personas:** browser agents with given goals use the preview:
  - a first-time visitor;
  - a keyboard and screen-reader user;
  - a phone user on a slow network;
  - someone entering hostile input.
- **Findings:** each persona reports with a recording and a reproducing test, as proposals.
- **Agent-ready:** every generated app ships `llms.txt` and WebMCP tools for its main actions, and the check runs an
  agent against those tools too.

**Done when** the personas find planted issues (an unlabelled button, a form that breaks on a phone, an unescaped
field) in a template app, each with a test that fails before the fix and passes after.

#### C6. Open a repo with a link, work on it together

**Headline:** *`aha.new/<any GitHub repo>` and it's running.*

**Why.** Aha runs in a browser, which no heavyweight does as its main product. A link is the shortest path from
curiosity to use, and every README badge is distribution.

**What.**
- **The link:** `aha.new/github.com/owner/repo` clones, installs and runs the repo, and opens a preview.
- **The badge:** "Open in Aha" for READMEs.
- **Together:** share a session link and a teammate joins in the browser, with the same files, terminal, preview and
  agents. People and agents comment on proposals live (YC's request for multiplayer AI, done in the browser).
- **From the phone:** approve, reject or comment on proposals over the phone preview link (PWA, no app store),
  matching Cursor's iOS remote control.

**Done when** a public template repo opens from a link to a running preview in under 30 s on the hosted plan, and two
browsers edit and review one proposal together in a browser test.

#### C7. The price is known before the work starts

**Headline:** *Pay for changes you accept.*

**Why.** Cost surprises are the most common reason people say they left Cursor.

**What.**
- **Before:** an estimate before every agent task, from the plan and past runs.
- **During:** a hard cap per task that is never exceeded.
- **Scoreboard:** cost per accepted change, as a measure (B4).
- **Hosted plan:** a pay-per-accepted-proposal option is costed out. If it can't be offered profitably, the cap and
  the estimate ship alone.
- **Keys:** your own keys and local models always work, at no charge from us.

**Done when** across the benchmark's tasks no task exceeds its cap, and the estimate lands within 30% of the actual
cost on four tasks in five.

### Matched, not led

These are worth having and others already have them. We match them where they fit, inside existing items, and don't
lead with them:
- mission control for parallel agents: the channel and night shift become the view;
- scheduled agents (watchers already do this);
- spec-first planning (specs to tests already exists; add Kiro-style requirements and design steps);
- drafts (fork the future);
- deploy health per change (production to fix, extended to watch a deploy);
- Figma import (inside C4).

### Considered and dropped

- **Our own coding model.** Cursor spent a year on Composer. We use the best model for each job (the model advisor) and
  win on checking, not generating.
- **Cloud VMs for 300 repositories.** That needs infrastructure capital. Companion mode and the desktop app cover big
  repos locally; hosted runs stay small.
- **A plugin marketplace now.** Open VSX and MCP already give us a catalog. A marketplace comes after the user base.

### Order, and how it fits Tracks A and B

| Step | Ships | Why here |
|---|---|---|
| 1 | A1 (real projects on disk) | Nothing else works on a real repo without it |
| 1b | A5 (sign-in on first launch, Linux desktop app) and the Team and Business plans | Accounts are what the plans, sync and seat admin hang on; companies can't adopt without them |
| 2 | C1 (any agent, checked) and A2 (Git) | The broadest reason to try Aha, and the PR path for receipts |
| 3 | C2 (receipts) and C3 (behaviour diff) | The launch: "AI changes that come with proof" |
| 4 | C4 (taste) and C5 (ship-ready check) | The second launch, for people building apps from prompts |
| 5 | C6 (links and multiplayer) and A3 (bring my setup) | Growth: every repo and README becomes a way in |
| 6 | C7 (price), B1 to B6 throughout | Each one removes a reason to go back |

Each launch goes out with a public benchmark run (B4), a 60-second video of the real flow, and the receipts from the
demo, so anyone can check the claims.

---

## Plans for small and medium businesses

**Why.** Today there are Free, Pro (one developer) and Premium (FDE and ISV teams). A company of 5 to 250 developers has
nothing that fits: it needs one bill, its own sign-in, controls over models and data, and a price that is clearly
cheaper than Cursor's or Copilot's business tiers for what it gets.

**The plan (proposal; prices in US dollars).**

| Plan | For | Price | Adds |
|---|---|---|---|
| **Free** | Anyone | $0 | The whole studio, your own or local model (unchanged) |
| **Pro** | One developer | $16/mo, $12 yearly | Unchanged |
| **Team** | 2 to 50 developers | $24 per seat/mo, $20 yearly | Shared project memory, contracts, kits and skills; a team night shift with one budget; receipts (C2) shared in the team; sign-in with the company's Google Workspace or GitHub organisation; one invoice; admin for seats and spend caps per seat |
| **Business** | 25 to 250 developers | $45 per seat/mo, $38 yearly | Everything in Team; SAML SSO and SCIM; audit log of what agents read, ran and sent; policies (which models, local-only mode, which connectors); the agent benchmark (B4) run on your own repository; priority support with a response-time commitment; invoice and purchase-order billing |
| **Enterprise** | 250+ | Talk to us | Everything in Business; self-hosting; custom terms (today's Premium kit publishing for ISVs moves here and into Business) |

**Principles for the price.**
- **Bring your own key, or local models, always costs nothing extra.** Seats pay for the studio, not for tokens.
- **Hosted model use** (optional) is billed at cost plus a stated margin, with the estimate before each task and a
  hard cap (C7). Admins set caps per seat and per team. Nobody gets a surprise bill.
- **Fewer seats than you think:** reviewers who only open receipts and approve proposals are free seats.
- **Discounts:** 50% for startups under two years old and for non-profits; 20% for yearly billing (in the prices
  above).
- **Trial:** Team for 14 days, no card, from the pricing page.

**Build.** Plans in `src/lib/pricing.ts` and the pricing page (cards, the comparison table, the FAQ); seat and plan
checks behind sign-in (A5); checkout links per plan (`NEXT_PUBLIC_CHECKOUT_TEAM_URL`, `..._BUSINESS_URL`); an
admin page for seats and caps.

**Needs you:** a payment provider account, the final prices, and whether Premium is retired into Business or kept.

**Status.** The pricing page shows the five plans with a comparison and a seat calculator. A signed-in account can start
the 14-day Team trial and add and remove seats at `/billing`, against a stand-in provider (`src/lib/billing.ts`, state in
`~/.aha/billing.json`). Premium is retired on the page, as proposed. Still to do: a real payment provider, caps that
stop a hosted-model task, and the Team features marked "Soon" on the page.

**Done when** the pricing page shows the five plans with their comparison, a Team trial can be started and a seat
added in a browser test against a mock billing provider, and caps stop a hosted-model task before it overspends.

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
