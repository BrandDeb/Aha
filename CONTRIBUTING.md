# Contributing

Contributions are by invitation. If you have been invited, thank you; this page is what a change needs before it
is merged. Read [docs/OVERVIEW.md](docs/OVERVIEW.md) first for how the code fits together.

## Setup

```bash
npm install
npm run dev        # http://localhost:3000
```

Node.js 24 or newer. Native builds need clang on the `PATH`.

## Before you open a pull request

```bash
npm run lint
npm run typecheck
npm test
```

All three must pass. CI runs the same checks, plus a production build, the desktop apps and the Docker image.

- **Tests.** Logic lives in `src/lib/` as plain functions with unit tests in `tests/`. A change to behaviour comes
  with a test that fails without it.
- **UI changes.** Check the real flow in a browser, light and dark theme, and say what you checked in the pull
  request.
- **Docs.** User-facing behaviour is documented in [docs/guide.md](docs/guide.md); the `/docs` pages are generated
  from it (`npm run docs:sync`, also run by `npm run build`).
- **Next.js.** This project uses Next.js 16, which changed APIs and conventions. Read the matching guide in
  `node_modules/next/dist/docs/` before writing Next.js code.
- **Secrets.** Never commit keys or tokens. Users' keys stay in their browser; the server reads its own from the
  environment.

## Pull requests

One change per pull request, with a description of what changed, why, and how it was verified. Keep commits
focused; the history is read.

By contributing you agree to the terms in [LICENSE](LICENSE), section 4.

## Reporting a vulnerability

Privately, as described in [SECURITY.md](SECURITY.md). Never in a public issue.
