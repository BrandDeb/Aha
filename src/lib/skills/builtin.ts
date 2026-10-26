/**
 * The skills every studio starts with. Each is a folder in the Agent Skills
 * format: SKILL.md (frontmatter + instructions) and, for some, reference files
 * the agent reads only when the instructions point to them.
 */

import { ECOSYSTEM_SKILLS } from './ecosystem.ts';

type Folder = Record<string, string>;

const skill = (name: string, description: string, body: string, extra: Folder = {}): [string, Folder] => [
  name,
  { 'SKILL.md': `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\nlicense: Proprietary (Aha!)\n---\n\n${body.trim()}\n`, ...extra },
];

export const BUILTIN_SKILLS: Record<string, Folder> = Object.fromEntries([
  skill(
    'systematic-debugging',
    'Find and fix the root cause of a bug, crash, failing test or wrong output. Use whenever something fails or behaves unexpectedly, before changing any code.',
    `
# Systematic debugging

Never guess-and-patch. A fix you can't explain is a new bug waiting.

1. **Reproduce.** Run the failing build, test or program and capture the exact error and output. If you can't reproduce it, say so and stop: report what you tried.
2. **Read the error fully.** The first error is usually the real one; later ones are often consequences. Note file, line, the values involved.
3. **Locate.** Open the code at the location; read the caller and the callee. Search for where the bad value comes from (search for assignments, not just uses).
4. **Form one hypothesis** that explains *all* the symptoms. Write it in your plan.
5. **Test the hypothesis cheaply** before fixing: add a temporary print/assert, run a smaller input, or read the data. If it is wrong, go back to 3; don't stack fixes.
6. **Fix the cause, minimally.** Prefer correcting the data or the contract at its source over adding a guard where it explodes. No catch-all try/except, no \`as any\`, no disabling the test.
7. **Prove it.** Re-run the exact reproduction, then the related tests. Remove temporary prints.
8. **Guard against regression.** If there is a test setup, add a test that fails without the fix.

Report: root cause (one sentence), the fix, and the evidence (command and result).

Red flags that you are guessing: changing several things at once, "trying" versions of a fix, fixing a symptom in a different file than the cause, a fix you can't connect to the error message.
`
  ),
  skill(
    'test-driven-development',
    'Build a feature or fix a bug test-first: write a failing test, make it pass, refactor. Use when adding behaviour to code that has (or should have) tests.',
    `
# Test-driven development

Red, green, refactor, in small steps.

1. **Pick the next smallest behaviour** from the goal ("an empty cart totals 0", "a negative quantity is rejected").
2. **Red:** write one test for it, using the project's test setup. Run it and *watch it fail for the right reason* (an assertion, not a typo or import error).
3. **Green:** write the simplest code that passes. Don't generalise yet. Run the test, then the whole suite.
4. **Refactor:** remove duplication and improve names with the tests green. Run them again.
5. Repeat until the goal is covered: normal cases, edge cases (empty, zero, maximum, unicode, duplicate), error cases.

Rules:
- Test behaviour through the public interface, not private details.
- One reason to fail per test; name tests as sentences ("rejects a negative quantity").
- Never weaken or delete a failing test to get green; if the test is wrong, say why before changing it.
- If the project has no tests, set up the language's standard runner first (node:test, pytest/unittest, go test, cargo test, JUnit…) with one passing smoke test.
`
  ),
  skill(
    'writing-tests',
    'Add or improve tests for existing code: what to cover, how to structure them, and idiomatic runners per language. Use when asked to add tests, raise coverage, or before refactoring untested code.',
    `
# Writing good tests

1. Read the code and list its behaviours: inputs to outputs, side effects, errors it raises, state it changes.
2. Cover, in this order: the main path; boundaries (empty, one, many, zero, negative, max size); invalid input and error messages; anything that has broken before (look at git history, TODOs, bug notes).
3. Arrange–act–assert, one behaviour per test, descriptive names. Keep fixtures small and inline unless shared.
4. Make tests deterministic: no real network, clock or randomness; inject or fake them. Use temp directories for files.
5. Run the suite; every new test must pass, and must fail if you break the code it covers (try it once mentally or for real).

Runners: see reference/runners.md for the idiomatic setup per language.

Do not change the code under test unless a test reveals a real bug. If it does, fix it and say so.
`,
    {
      'reference/runners.md': `# Test runners by language

| Language | Runner | Test file | Run |
|---|---|---|---|
| TypeScript / JavaScript (Node) | node:test + node:assert/strict | \`*.test.ts\` / \`*.test.js\` | \`node --test\` |
| Python | unittest (stdlib) or pytest | \`test_*.py\` | \`python -m unittest\` / \`pytest\` |
| Go | testing | \`*_test.go\` | \`go test ./...\` |
| Rust | built-in | \`#[cfg(test)] mod tests\` / \`tests/\` | \`cargo test\` |
| Java / Kotlin | JUnit 5 | \`src/test/...\` | \`mvn test\` / \`gradle test\` |
| C# | xUnit | \`*.Tests\` project | \`dotnet test\` |
| Ruby | minitest / RSpec | \`test/*_test.rb\` / \`spec/\` | \`ruby -Itest\` / \`rspec\` |
| Solidity | Foundry | \`test/*.t.sol\` | \`forge test\` |
| Elixir | ExUnit | \`test/*_test.exs\` | \`mix test\` |

Prefer the runner the project already uses (check package.json scripts, pyproject, Cargo.toml, go.mod, build files).
`,
    }
  ),
  skill(
    'code-review',
    'Review a change (a diff, a proposal or a file) for correctness, security, clarity and tests before it ships. Use when asked to review, and on your own work before you finish.',
    `
# Code review

Review like the person who will be paged for it.

Read the whole change first, then go through, in priority order:

1. **Correctness.** Does it do what the goal says, for all inputs? Off-by-one, null/undefined, empty collections, error paths, concurrency and ordering, resource cleanup.
2. **Security.** Untrusted input reaching a shell, SQL, file path, HTML or URL; secrets in code or logs; missing auth checks. (See the security-review skill for depth.)
3. **Behaviour changes.** Anything callers rely on that changed: signatures, defaults, error types, output formats.
4. **Tests.** Is the new behaviour tested? Would the tests fail if the change were reverted?
5. **Clarity.** Names, comments where intent isn't obvious, dead code, duplication.
6. **Fit.** Matches the codebase's patterns; no unrelated changes.

Report findings as: severity (blocking / should fix / nit), file:line, what's wrong, and a concrete fix. Lead with blockers. Say plainly when something is fine; don't invent issues.
`
  ),
  skill(
    'refactoring',
    'Restructure code without changing what it does: extract, rename, split, remove duplication. Use for cleanups and before adding features to tangled code.',
    `
# Safe refactoring

The rule: behaviour stays identical, proven by tests.

1. Make sure tests cover the code you'll touch. If not, add characterization tests first (assert what it does today, even if odd).
2. Change in small, named steps (extract function, rename, inline, move, split module, replace conditional with lookup). Run the tests after each.
3. Never mix a refactor with a behaviour change in the same step. If you find a bug, note it and fix it separately.
4. Keep public interfaces stable unless the goal is to change them; if you must, update every caller (search for all uses).
5. Finish with the full test suite and a build.

Smells worth fixing: functions longer than a screen, deep nesting (use early returns), boolean parameters, duplicated logic, names that need a comment to explain.
`
  ),
  skill(
    'security-review',
    'Find security problems in code: injection, unsafe file and network access, secrets, auth and crypto mistakes. Use for any code that handles untrusted input, credentials, files, shell commands, SQL or HTTP.',
    `
# Security review

Trace untrusted data from where it enters (HTTP params, files, env, CLI args, messages from other systems, AI output) to where it is used (sinks). For each sink, check it is safe:

- Shell: no string-built commands; pass argument arrays, never \`shell: true\` with input.
- SQL: parameterised queries only.
- Files: resolve and check paths stay inside an allowed root (no \`..\`, no absolute paths, watch symlinks).
- HTML: escape on output; no innerHTML with input.
- URLs/fetch from user input: allowlist hosts; block private addresses (SSRF).
- Deserialisation: no eval, pickle or YAML load of untrusted data.

Then check secrets (none in code, logs or error messages), authentication and authorisation on every endpoint, and crypto (no homemade crypto, constant-time comparison for tokens, strong randomness).

Use reference/checklist.md for the full checklist. Report each finding with severity, the data flow (source to sink), and the fix. Fix only what is asked; note the rest.
`,
    {
      'reference/checklist.md': `# Security checklist

## Input
- [ ] Every external input validated (type, length, format) at the boundary
- [ ] Size limits on bodies, uploads and loops driven by input
## Injection
- [ ] No shell strings; argv arrays only
- [ ] SQL parameterised; no string concatenation into queries
- [ ] Paths resolved and confined to a root; reject \`..\`, NUL, absolute
- [ ] Output encoded for its context (HTML, attribute, URL, JSON)
## Network
- [ ] Outbound requests to user-supplied URLs: scheme and host allowlist, private ranges blocked, redirects re-checked
- [ ] TLS verification never disabled
## Auth
- [ ] Authorisation checked server-side on every action, not only in the UI
- [ ] Sessions: HttpOnly, Secure, SameSite cookies; CSRF protection for state changes
## Secrets
- [ ] Not in source, logs, error messages, URLs or client bundles
- [ ] Loaded from env or a secret store; examples use placeholders
## Dependencies
- [ ] Pinned versions and a lock file; known advisories checked
## Crypto
- [ ] Standard libraries only; constant-time comparison; CSPRNG for tokens
`,
    }
  ),
  skill(
    'performance',
    'Make code faster or use less memory, guided by measurements. Use when something is slow, times out, or uses too much CPU or memory.',
    `
# Performance work

Measure, don't guess.

1. **Define the target**: which operation, how slow now, how fast it must be, on what input size.
2. **Measure a baseline** with a repeatable command (time it; run 3+ times; note variance). Profile if available (\`node --cpu-prof\`, \`python -m cProfile\`, \`go test -bench\`, \`cargo bench\`).
3. **Find the hot spot**: usually one loop, one query, or repeated I/O. Look for N+1 queries, work repeated inside loops, quadratic algorithms on growing data, synchronous I/O in hot paths, missing indexes, unbounded caches.
4. **Fix the biggest cost first** with the simplest change: better algorithm or data structure, batching, caching with a bound, moving work out of loops.
5. **Measure again** with the same command. Keep the change only if it helps; report before/after numbers.

Never trade correctness for speed: run the tests after each change.
`
  ),
  skill(
    'api-design',
    'Design or change an HTTP/JSON API: resources, methods, status codes, errors, pagination, versioning. Use when adding endpoints or a client for one.',
    `
# HTTP API design

- **Resources as nouns**, methods as verbs: \`GET /orders\`, \`POST /orders\`, \`GET /orders/{id}\`, \`PATCH /orders/{id}\`, \`DELETE /orders/{id}\`.
- **Status codes that mean something**: 200 OK, 201 Created (+ Location), 204 No Content, 400 invalid input, 401 not signed in, 403 not allowed, 404 not found, 409 conflict, 422 validation failed, 429 rate limited (+ Retry-After), 5xx only for server faults.
- **One error shape** everywhere: \`{ "error": { "code": "invalid_quantity", "message": "Quantity must be at least 1", "field": "quantity" } }\`.
- **Validate at the edge**; reject unknown fields if strictness matters; limit body size.
- **Pagination** for every list: cursor based (\`?cursor=…&limit=50\`, response \`next_cursor\`) for large or changing data.
- **Idempotency** for retries: PUT/DELETE idempotent; POST accepts an \`Idempotency-Key\` when duplicates would hurt.
- **Compatibility**: adding fields is safe; removing or renaming is breaking. Version in the path (\`/v2\`) only for breaking changes.
- **Times** in ISO 8601 UTC; money as integer minor units plus currency; ids as strings.

Write the contract (request, response, errors) before the handler, and test each status code.
`
  ),
  skill(
    'cli-design',
    'Build command-line tools people enjoy: arguments, help text, exit codes, output for humans and scripts. Use when writing or improving a CLI.',
    `
# Command-line tools

- \`--help\` (and \`-h\`) prints usage, a one-line description, every option with its default, and an example. \`--version\` prints the version.
- Arguments: positional for the main thing, flags for options. Support \`--flag=value\` and \`--flag value\`; \`--\` ends options.
- Exit codes: 0 success, 1 failure, 2 usage error. Never exit 0 after an error.
- Output: results to stdout, diagnostics and progress to stderr, so piping works. Offer \`--json\` for machine-readable output.
- Errors say what went wrong and how to fix it: "config.json not found. Create it with \`tool init\`."
- No colour or spinners when stdout isn't a TTY or \`NO_COLOR\` is set.
- Read from stdin when given \`-\`; never prompt when stdin isn't a TTY.
- Be safe by default: confirm or require \`--force\` for destructive actions; support \`--dry-run\`.

Test: help output, each flag, bad usage (exit 2), and one end-to-end run.
`
  ),
  skill(
    'frontend-components',
    'Build accessible, responsive UI components (React or plain HTML/CSS). Use when creating or changing interface code.',
    `
# Frontend components

- **Semantics first**: real \`<button>\`, \`<a href>\`, \`<label for>\`, headings in order, lists for lists. A div with onClick is a bug.
- **Keyboard**: everything reachable with Tab, operable with Enter/Space, visible focus ring, Escape closes overlays, focus returns to the trigger.
- **Names**: every control has an accessible name (label text or aria-label); images have alt text (empty for decoration).
- **State**: loading, empty, error and success states all designed; errors next to the field, announced (\`role="alert"\` / aria-live).
- **Responsive**: works from 360 px wide; no horizontal scroll; touch targets at least 40 px.
- **Contrast** at least 4.5:1 for text; don't signal state by colour alone.
- **Motion**: respect \`prefers-reduced-motion\`.
- **React**: keep state minimal and derived where possible; effects only for syncing with the outside world, with a block body and a cleanup; keys stable and unique.

Check your work in the preview at desktop and phone widths, and with the keyboard only.
`
  ),
  skill(
    'database-changes',
    'Change a database schema or write data migrations without downtime or data loss. Use for migrations, new tables or columns, indexes, and backfills.',
    `
# Database changes

1. **Write a migration**, never edit the schema by hand. Each migration is small, ordered, and has a down/rollback where possible.
2. **Expand, then contract** for anything in use: add the new column/table (nullable or with a default) → deploy code that writes both → backfill in batches → switch reads → remove the old one in a later release.
3. **Never** rename or drop a column that running code reads, in the same deploy.
4. **Large tables**: add indexes concurrently (Postgres \`CREATE INDEX CONCURRENTLY\`), backfill in batches of a few thousand rows with progress logging, avoid long locks.
5. **Constraints**: add NOT NULL / foreign keys after the backfill; validate separately where the database allows (\`NOT VALID\` then \`VALIDATE\`).
6. **Test** the migration up and down on a copy with realistic data; check query plans for new queries (\`EXPLAIN\`).

Queries against a customer's or production database are read-only unless the user explicitly says otherwise.
`
  ),
  skill(
    'smart-contract-security',
    'Write and review Solidity (and other EVM) smart contracts safely, with Foundry tests. Use for any contract code or audit request.',
    `
# Smart contract security

Contracts are public, immutable and hold money: assume every function is called by an attacker, in any order, with any input.

Check every function for:
- **Reentrancy**: follow checks-effects-interactions; update state before external calls; use a reentrancy guard where calls go out.
- **Access control**: who may call it? \`onlyOwner\`/roles on every privileged function; initialisers can't be called twice.
- **Arithmetic**: Solidity ≥0.8 reverts on overflow, but check precision loss (divide last), rounding direction, and \`unchecked\` blocks.
- **External calls**: check return values; prefer pull over push payments; beware of tokens that don't return bool or take fees.
- **Oracles and prices**: no spot prices from a single pool (flash-loan manipulation); use TWAPs or trusted oracles with staleness checks.
- **Denial of service**: no unbounded loops over user-growable arrays; a single failing transfer can't block everyone.
- **Front-running**: commit–reveal or slippage limits where order matters.

Test with Foundry: unit tests for each function including reverts (\`vm.expectRevert\`), fuzz tests for invariants, and an attacker contract for reentrancy. See reference/foundry.md. Run \`forge test\` and show the output.
`,
    {
      'reference/foundry.md': `# Foundry patterns

\`\`\`solidity
// test/Vault.t.sol
import {Test} from "forge-std/Test.sol";
import {Vault} from "../src/Vault.sol";

contract VaultTest is Test {
    Vault vault;
    address alice = makeAddr("alice");

    function setUp() public {
        vault = new Vault();
        vm.deal(alice, 10 ether);
    }

    function test_DepositAndWithdraw() public {
        vm.prank(alice);
        vault.deposit{value: 1 ether}();
        vm.prank(alice);
        vault.withdraw(1 ether);
        assertEq(alice.balance, 10 ether);
    }

    function test_RevertWhen_WithdrawingTooMuch() public {
        vm.prank(alice);
        vm.expectRevert(Vault.InsufficientBalance.selector);
        vault.withdraw(1);
    }

    // Fuzz: any amount up to the balance round-trips
    function testFuzz_RoundTrip(uint96 amount) public {
        vm.assume(amount > 0 && amount <= 10 ether);
        vm.startPrank(alice);
        vault.deposit{value: amount}();
        vault.withdraw(amount);
        vm.stopPrank();
        assertEq(address(vault).balance, 0);
    }
}
\`\`\`

- \`forge test -vvv\` shows traces for failures; \`forge coverage\` shows untested lines.
- Invariant tests: \`function invariant_TotalMatchesBalance() public\` with a handler contract.
`,
    }
  ),
  skill(
    'documentation',
    'Write READMEs, guides and code comments people can act on. Use when asked to document, explain setup, or write a hand-off.',
    `
# Documentation

Write for someone who has five minutes and wants to get something done.

**README**, in this order: what it is (one sentence); quick start that works when copy-pasted (install, configure, run, expected output); common tasks; configuration (every env var, with defaults); how to test; troubleshooting for the errors people actually hit.

**Rules**
- Show, then explain: a command or code sample before the prose about it.
- Every command must be one you ran; every output one you saw.
- Use the reader's words, not internal names. Short sentences; active voice.
- Never include real secrets; use placeholders like \`YOUR_API_KEY\`.

**Code comments** say *why*, not what: the constraint, the trade-off, the bug it avoids. Delete comments that restate the code.
`
  ),
  skill(
    'dependency-upgrades',
    'Upgrade libraries, frameworks or language versions safely. Use for version bumps, security advisories and migrations to new major versions.',
    `
# Dependency upgrades

1. **Inventory**: current versions, what's outdated (\`npm outdated\`, \`pip list --outdated\`, \`cargo outdated\`, \`go list -m -u all\`), and advisories (\`npm audit\`, \`pip-audit\`, \`cargo audit\`).
2. **One upgrade at a time** for anything major; batch only patch/minor updates of unrelated libraries.
3. **Read the changelog** / migration guide for every major bump; list the breaking changes that touch this codebase (search for each changed API).
4. **Upgrade, then fix** compile and test failures one by one. Prefer the library's documented replacement over workarounds.
5. **Verify**: build, full tests, and run the app's main path. Commit the lock file.
6. If an upgrade is blocked, pin it, note why and what would unblock it.
`
  ),
  skill(
    'creating-skills',
    'Write a new agent skill (a SKILL.md folder) that teaches the agent a repeatable workflow. Use when the user asks to create, improve or save a skill.',
    `
# Creating a skill

A skill is a folder with a SKILL.md, in the open Agent Skills format.

\`\`\`markdown
---
name: release-notes
description: Write release notes from merged changes. Use when the user asks for release notes, a changelog entry or a summary of what shipped.
---

# Release notes

1. ...
\`\`\`

- **name**: lowercase letters, digits and hyphens, up to 64 characters; the same as the folder name.
- **description**: the most important line. Say what it does *and when to use it*, with the words a user would say. Up to 1024 characters. The agent sees only this until it decides to load the skill.
- **body**: concrete steps, rules and examples; what good output looks like; common mistakes. Keep it under ~500 lines; move long reference material into separate files (e.g. reference/api.md) and point to them from the body, so they're read only when needed.

Where to put it:
- **This project** (shared with everyone who has the project): \`agent/skills/<name>/SKILL.md\`. Create it with write_file.
- **For the user everywhere**: they can create it in Settings → Skills, or install skill folders from any GitHub repository there.

Test a new skill by running a task that should trigger it and checking the agent loads and follows it.
`
  ),
  ...ECOSYSTEM_SKILLS,
]);
