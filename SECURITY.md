# Security

NanoCLI Studio compiles and runs code, talks to your models and services, and can update itself. This page says what
protects each of those, what the studio deliberately does not protect against, and what the last audit found.

To report a vulnerability, email the maintainers privately rather than opening a public issue.

## Threat model

| Who | Can | Must not be able to |
| --- | --- | --- |
| **You**, on your own machine | Run anything: that is the point of a local IDE | |
| **A website you visit** while the studio runs | Load in your browser next to it | Make your studio compile, run, install, connect, update, read your files or use your keys (CSRF, DNS rebinding, clickjacking) |
| **Someone on your network** | Reach your machine's ports | Reach the studio: it listens on `127.0.0.1` unless you set `HOST` |
| **Visitors of a hosted studio** (`HOST=0.0.0.0`) | Edit, compile to WASM, use the assistant within rate limits | Run code on the server (Python, other languages, dev servers, connectors, maintenance are off) |
| **A collaborator** in a live session | Edit the project with you | Join without the invite link; send oversized or path-escaping files |
| **The AI model / a prompt injection** in files or web pages it reads | Propose edits, read the project | Change your files without your accept, run commands or reach connectors without your approval |
| **A malicious package** in a project you run | Whatever any `npm install` / `uv sync` can do on your machine | — this is not a sandbox; see below |

**Not a sandbox.** Running a project (Python, the other languages, a web app's dev server and its packages' install
scripts) executes that code with your user's rights, exactly as it would in a terminal. Only run projects you trust, or
run the studio in a container or VM. The in-browser runner (WASM) and the preview frame are isolated from the studio;
host runners are not.

## Layers

**Network exposure**
- The server binds to `127.0.0.1` by default. Every feature that executes code or touches the machine (Python, other
  languages, dev servers, connectors, doctor and updates) switches on only when it listens on loopback, and each has a
  kill switch: `NANOCLI_PYTHON`, `NANOCLI_RUN`, `NANOCLI_DEV`, `NANOCLI_CONNECTORS`.
- The Docker image sets all of them off explicitly and runs as the unprivileged `node` user.

**Requests from other sites**
- State-changing routes require a same-origin `Origin` header. Browsers send it on every cross-site POST, including
  `text/plain` "simple" requests that skip CORS preflight.
- `/api/compile` and `/api/coverage` stay callable from scripts (no `Origin`) but refuse anything a browser marks as
  cross-site (`Origin` from another site, or `Sec-Fetch-Site: cross-site`).
- DNS rebinding (an attacker's domain pointed at `127.0.0.1`, so its Origin and Host agree) is closed by a trusted-`Host`
  check on every sensitive route and on the collaboration WebSocket: only `localhost`, `127.0.0.1`, `::1`,
  `NEXT_PUBLIC_BASE_URL` and `ALLOWED_HOSTS`.
- Headers on every page: a Content-Security-Policy (scripts only from the studio, no plugins, no `<base>` hijacking, no
  framing), `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy and a restrictive `Permissions-Policy`.

**Inputs**
- Paths are checked by one rule on both sides (no `..`, no absolute paths, no odd characters); writes into tool-owned
  folders (`node_modules`, `.next`, `.venv`, `.git`…) are refused.
- JSON bodies are read with a hard size limit that also stops chunked uploads without `Content-Length`.
- Environment variables a program receives are an allow-list with a private `HOME`; the server's own secrets never reach
  it. Commands run with an argument list, never through a shell.
- Rate limits per client on every expensive route. Behind a proxy the client is the address the proxy appended
  (`TRUST_PROXY_HOPS`, default 1), not whatever the client wrote into `X-Forwarded-For`.

**Running things**
- Time and output limits, a concurrency cap, and the whole process tree killed on stop or timeout.
- Dev servers bind to `127.0.0.1` on a free port; the preview shows them in a sandboxed frame on their own origin, so the
  page cannot reach the studio. Idle servers stop after 20 minutes and all stop with the studio.

**Connectors and the agent**
- Web fetches resolve DNS first, refuse private and link-local addresses, pin the checked address and re-check
  redirects (SSRF). Database connectors are read-only (SQLite read-only mode; Postgres `READ ONLY` transaction and a
  single-statement guard).
- The agent edits a private copy. Builds and reads need no approval; running commands and every connector call ask
  first. Nothing reaches your files until you accept a proposal, and accepting saves a History snapshot.

**Secrets**
- Your model keys stay in your browser and go straight to the provider; the CSP keeps third-party scripts away from
  them. The GitHub token is an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production); OAuth uses a single-use,
  constant-time-compared `state`.

**Live collaboration**
- Rooms are 128-bit random IDs shared by invite link (they used to be the project's name). Rooms are capped in size and
  number, each connection is rate-limited, sender identity comes from the connection, and incoming edits are checked like
  your own (valid path, at most 1 MB, at most 500 files).

**Dependencies**
- `npm audit --omit=dev` runs in CI. Self-update only fast-forwards from the configured remote and rolls back on a
  failed build.

## Audit, 22 October 2026

| Finding | Severity | Fix |
| --- | --- | --- |
| Next.js 16.3.8 affected by an unauthenticated RCE in the image optimizer (SVG) and an App Router DoS | Critical | Upgraded to 16.4.2; image optimizer turned off (no `next/image` is used) |
| `/api/compile` and `/api/coverage` accepted cross-site `text/plain` POSTs (any page could make your studio build) and had no rate limit or body limit | High | Cross-site requests refused, per-client rate limit, bounded body reader |
| Collaboration WebSocket accepted DNS-rebinding origins | High | Trusted-`Host` check; per-connection message rate limit; room size and count caps |
| Collaboration rooms were named after the project, so strangers using the default project shared a room on a hosted server; incoming edits were applied without checks | High | Random room IDs shared by invite link; incoming paths and sizes validated |
| No Content-Security-Policy or frame protection: the studio could be framed to trick clicks on approvals | Medium | CSP, `frame-ancestors 'none'`, `X-Frame-Options`, `nosniff`, referrer and permissions policies |
| Rate limits keyed on the first `X-Forwarded-For` entry, which the client controls | Medium | Key on the entry the trusted proxy appended |
| `/api/ai` (the operator's key) passed DNS-rebinding requests | Medium | Trusted-`Host` check |
| Sign-out (`DELETE /api/github/user`) could be triggered by another site | Low | Same-origin check |
| Docker image ran as root | Low | Runs as `node`; runners, dev servers and connectors explicitly off |
| `dompurify` (via Monaco) affected by DOM-XSS advisories | Low | Pinned to the fixed 3.4.17 with an npm override |
| `braces` / `micromatch` stack-exhaustion DoS in ESLint's file globbing | Low (development only, not shipped) | No fixed release yet; tracked |

Verified by tests (`tests/security.test.ts` and the route tests) and by probing the running server: forged and missing
origins, rebinding hosts, `text/plain` CSRF, oversized chunked bodies, path traversal into `node_modules`, the WebSocket
with foreign and rebinding origins, a server exposed on all interfaces and every kill switch. The full app was exercised
under the CSP (editor, TypeScript worker, compile, WASM run, every panel and dialog, live preview, the agent) with no
violations.
