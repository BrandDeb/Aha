/**
 * Built-in skills for the popular open-source ecosystems: the conventions, commands and traps of each, so the
 * agent works the way experienced maintainers of those projects do. Each description says when to load it;
 * the body is the playbook. No network, no install: they ship with the studio and work out of the box.
 */

type Folder = Record<string, string>;

const skill = (name: string, description: string, body: string): [string, Folder] => [
  name,
  { 'SKILL.md': `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\nlicense: Proprietary (Aha!)\n---\n\n${body.trim()}\n` },
];

export const ECOSYSTEM_SKILLS: [string, Folder][] = [
  // ─── Web front end ─────────────────────────────────────────────────────────
  skill('react', 'Write or change React components, hooks and state (React 19). Use for any .jsx/.tsx UI work, forms, effects, context, performance problems or "it re-renders too much".', `
# React

- Components are functions of props and state. Derive values during render; don't mirror props into state.
- **Effects are for synchronising with something outside React** (subscriptions, timers, the DOM, network). Not for computing values, not for reacting to your own state changes, not for "on mount, set state". If an effect only calls setState from other state/props, delete it and compute the value.
- Keys: stable ids from the data, never the array index for lists that reorder or filter.
- State updates that depend on the previous value use the updater form: \`setCount((c) => c + 1)\`.
- Lift state to the nearest common parent; reach for context only for truly global values (theme, user, locale). For server data use the project's data library (TanStack Query, SWR) or framework loaders, not useEffect + fetch.
- Forms: controlled inputs for small forms; React Hook Form (with Zod) for big ones. In React 19, \`<form action={fn}>\`, \`useActionState\` and \`useFormStatus\` handle submission state.
- Performance: measure first (React DevTools Profiler). If the project uses the React Compiler, don't add useMemo/useCallback by hand. Otherwise memoise only expensive computations and props of memoised children.
- Accessibility: real elements (\`<button>\`, \`<a href>\`, \`<label>\`), not clickable divs; every input has a label; images have alt text.
- Types: \`function Card({ title, children }: { title: string; children?: React.ReactNode })\`. Avoid \`React.FC\`.
- Test with Testing Library: query by role and label (\`getByRole('button', { name: 'Save' })\`), assert what the user sees.
`),
  skill('nextjs', 'Build or change a Next.js app (App Router): pages, layouts, server components, server actions, route handlers, metadata, caching, deployment. Use when the project has next in package.json or an app/ directory.', `
# Next.js (App Router)

**First, check the version** in package.json and read node_modules/next/dist/docs (or the project's AGENTS.md) when it exists: APIs change between majors.

- Files: \`app/<route>/page.tsx\` (UI), \`layout.tsx\` (shared shell), \`loading.tsx\`, \`error.tsx\` (client component), \`not-found.tsx\`, \`route.ts\` (HTTP handlers: export GET/POST…).
- Components are **server components by default**: they can be async and read data directly. Add \`'use client'\` only at the top of files that need state, effects, event handlers or browser APIs, and keep those leaves small.
- Never import server-only code (database, secrets, node:fs) into a client component. Pass serialisable props across the boundary.
- Mutations: server actions (\`'use server'\` functions) called from forms or client code; revalidate after writing (\`revalidatePath\` / \`revalidateTag\`).
- Dynamic route params and searchParams may be async in recent versions: \`const { slug } = await params\`.
- SEO: export \`metadata\` or \`generateMetadata\` from pages; \`app/sitemap.ts\`, \`app/robots.ts\`, \`opengraph-image.tsx\`.
- Images with \`next/image\` (width/height or fill + sizes); links with \`next/link\`; fonts with \`next/font\`.
- Environment: only \`NEXT_PUBLIC_*\` reaches the browser. Secrets stay server-side.
- Check your work with \`next build\`: it type-checks, lints and catches server/client boundary mistakes that dev mode lets through.
`),
  skill('vue', 'Write or change Vue 3 or Nuxt code: single-file components, Composition API, Pinia stores, Vue Router. Use for .vue files or projects with vue/nuxt in package.json.', `
# Vue 3 / Nuxt

- Use \`<script setup lang="ts">\` and the Composition API. \`ref\` for primitives, \`reactive\` for objects you never reassign, \`computed\` for derived values, \`watch\` only for side effects.
- Props: \`const props = defineProps<{ title: string; count?: number }>()\`; events: \`const emit = defineEmits<{ save: [id: string] }>()\`. \`v-model\` on components via \`defineModel()\`.
- Don't destructure reactive objects without \`toRefs\`; you lose reactivity.
- Lists: \`v-for\` with a stable \`:key\`; never \`v-if\` and \`v-for\` on the same element.
- Shared state: Pinia (\`defineStore\` with setup syntax). Server data in Nuxt: \`useFetch\` / \`useAsyncData\`, not onMounted + fetch.
- Nuxt: pages in \`pages/\`, auto-imported composables in \`composables/\`, server routes in \`server/api/\`. Runtime config via \`useRuntimeConfig()\`; only \`public\` keys reach the client.
- Styles: \`<style scoped>\`; avoid deep selectors unless styling a child library.
- Test with Vitest + @vue/test-utils (or @testing-library/vue); type-check with \`vue-tsc --noEmit\`.
`),
  skill('svelte', 'Write or change Svelte 5 or SvelteKit code: runes, components, load functions, form actions. Use for .svelte files or projects with svelte/@sveltejs/kit.', `
# Svelte 5 / SvelteKit

- Svelte 5 uses **runes**: \`let count = $state(0)\`, \`const double = $derived(count * 2)\`, \`$effect(() => …)\` for side effects only, \`let { title, onsave } = $props()\`.
- Events are props now: \`<button onclick={save}>\` (not \`on:click\`). Callbacks are passed as props instead of createEventDispatcher.
- Two-way binding: \`bind:value\`; bindable props with \`$bindable()\`.
- Snippets replace slots: \`{#snippet row(item)}…{/snippet}\` and \`{@render row(item)}\`.
- SvelteKit: \`+page.svelte\` (UI), \`+page.ts\`/\`+page.server.ts\` \`load\` for data, \`+server.ts\` for endpoints, form \`actions\` in \`+page.server.ts\` with \`use:enhance\`.
- Secrets in \`$env/static/private\` (server only); \`PUBLIC_\` variables for the client.
- Check with \`npx svelte-check\` and build with \`vite build\`.
`),
  skill('tailwind', 'Style UI with Tailwind CSS (v3 or v4): layout, spacing, responsive design, dark mode, design tokens, cleaning up long class lists. Use when the project has tailwindcss.', `
# Tailwind CSS

- **Check the major version.** v4: configured in CSS (\`@import "tailwindcss";\` and \`@theme { --color-brand: … }\`), no tailwind.config.js needed, uses \`@tailwindcss/vite\` or \`@tailwindcss/postcss\`. v3: \`tailwind.config.js\` with \`content\` globs and \`@tailwind base/components/utilities\`.
- Mobile first: unprefixed classes are the phone layout; add \`sm:\` \`md:\` \`lg:\` for wider screens.
- Spacing and type come from the scale (\`p-4\`, \`gap-6\`, \`text-lg\`); avoid arbitrary values (\`p-[13px]\`) unless matching a spec.
- Dark mode with \`dark:\` variants; colours from the theme, not hex in markup.
- Class names must be complete strings in the source (\`bg-red-500\`, not \`bg-\${color}-500\`), or the build won't generate them. Map variants to full class names.
- Merge conditional classes with \`clsx\` and resolve conflicts with \`tailwind-merge\` (the \`cn()\` helper in shadcn projects).
- Repeated combinations become a component, not an \`@apply\` soup.
- Focus states: keep visible focus (\`focus-visible:ring-2\`); don't remove outlines without a replacement.
`),
  skill('shadcn-ui', 'Add or customise shadcn/ui components (Radix + Tailwind) in a React project: dialogs, forms, tables, menus, theming. Use when the project has components.json or components/ui.', `
# shadcn/ui

- Components are **copied into the project** (components/ui/*), not imported from a package: edit them freely.
- Add one with the CLI: \`npx shadcn@latest add button dialog form\`. It reads components.json for paths, aliases and style.
- Theme lives in CSS variables (\`--background\`, \`--primary\`, …) in the global stylesheet; change colours there, not per component.
- Use \`cn()\` from lib/utils to merge classes.
- Forms: the Form component wraps React Hook Form; pair with a Zod schema and \`zodResolver\`.
- Keep Radix accessibility: don't replace \`DialogTitle\` / \`DialogDescription\`; use \`asChild\` to render your own element without losing behaviour.
- Icons: lucide-react.
`),
  skill('vite', 'Configure or debug a Vite project: dev server, build, env variables, aliases, plugins, proxying an API, library mode. Use when the project has vite in package.json.', `
# Vite

- Env: \`import.meta.env.VITE_*\` reaches the client; anything without the prefix doesn't. \`.env\`, \`.env.local\`, \`.env.production\`.
- Aliases: \`resolve.alias\` in vite.config plus matching \`paths\` in tsconfig.
- Proxy an API in dev: \`server.proxy: { '/api': 'http://localhost:8787' }\` to avoid CORS.
- Static files in \`public/\` are served as-is at the root; imported assets get hashed.
- Build output in \`dist/\`; preview the production build with \`vite preview\`.
- Large bundles: dynamic \`import()\` for routes and heavy libraries; inspect with rollup-plugin-visualizer.
- Library mode: \`build.lib\` with \`formats\` and externalised peer dependencies.
`),
  skill('typescript-strict', 'Make TypeScript code type-safe: fix type errors properly, remove any, model data with unions and generics, configure tsconfig strictness. Use for type errors or "make this type-safe".', `
# TypeScript, strictly

- Keep \`"strict": true\`. Fix errors at their source; never silence with \`any\`, \`as unknown as X\`, \`@ts-ignore\` or non-null \`!\` without proof.
- Model states as **discriminated unions**: \`type Result = { ok: true; value: T } | { ok: false; error: string }\`, then narrow with \`if (r.ok)\`.
- Validate untrusted data (JSON, env, request bodies) at the boundary with Zod (or valibot) and infer the type: \`type User = z.infer<typeof User>\`.
- Prefer \`unknown\` over \`any\` for values you haven't checked; narrow with typeof/in/instanceof or a schema.
- \`satisfies\` checks a value against a type without widening it: \`const routes = { … } satisfies Record<string, Route>\`.
- Exhaustiveness: in a switch over a union, end with \`const never: never = x\` so new cases fail to compile.
- Generics carry relationships (\`function first<T>(xs: T[]): T | undefined\`); don't add type parameters that appear only once.
- Run \`tsc --noEmit\` to prove it; type errors in tests count too.
`),

  // ─── Back end and data ─────────────────────────────────────────────────────
  skill('node-api', 'Build or change an HTTP API in Node.js or Bun with Hono, Express or Fastify: routes, validation, errors, auth middleware, CORS. Use for server-side JavaScript/TypeScript endpoints.', `
# Node HTTP APIs (Hono, Express, Fastify)

- Validate every request body, query and param at the edge (Zod: \`@hono/zod-validator\`, or a schema in Fastify). Reject with 400 and a useful message.
- One error handler: map known errors to status codes, log the rest and return 500 without leaking stack traces.
- Status codes: 201 for created (with the resource), 204 for no content, 404 for missing, 409 for conflicts, 422 for valid JSON that breaks rules.
- Auth in middleware; check authorisation per resource (can *this* user touch *this* row?), not just "logged in".
- Never build SQL with string concatenation; use the query builder or parameters.
- CORS: list allowed origins explicitly; no \`*\` with credentials.
- Express 5 handles rejected promises in handlers; Express 4 needs a wrapper or errors hang the request.
- Config from env, validated at start-up; fail fast when a required variable is missing.
- Test endpoints in-process (Hono's \`app.request()\`, supertest for Express, \`fastify.inject()\`).
`),
  skill('prisma-drizzle', 'Change a database schema or queries with Prisma or Drizzle ORM: models, relations, migrations, transactions, avoiding N+1. Use when the project has prisma/schema.prisma or drizzle-orm.', `
# Prisma and Drizzle

**Prisma**
- Edit \`prisma/schema.prisma\`, then \`npx prisma migrate dev --name <change>\` (creates SQL + applies) and \`npx prisma generate\`. In CI/prod: \`prisma migrate deploy\`.
- Fetch relations with \`include\`/\`select\` in one query instead of looping.
- Multi-step writes in \`prisma.$transaction([...])\` or the interactive form.
- One PrismaClient per process (a module singleton), especially with hot reload.

**Drizzle**
- Schema in TypeScript (\`pgTable\`, \`sqliteTable\`); \`npx drizzle-kit generate\` for SQL migrations, \`drizzle-kit migrate\` to apply (\`push\` only for prototypes).
- Queries are SQL-shaped: \`db.select().from(users).where(eq(users.id, id))\`; relations via the relational query API (\`db.query.users.findMany({ with: { posts: true } })\`).

Both: every migration is reviewed SQL; never edit an applied migration; add indexes for columns you filter or join on; make destructive changes in two steps (add new, backfill, then drop).
`),
  skill('fastapi', 'Build or change a Python API with FastAPI: endpoints, Pydantic models, dependencies, async, auth, tests. Use for FastAPI projects or "a Python API".', `
# FastAPI

- Request and response bodies are Pydantic models (v2): \`class ItemIn(BaseModel): name: str = Field(min_length=1)\`. Set \`response_model\` so output is filtered and documented.
- Dependencies with \`Annotated\`: \`SessionDep = Annotated[Session, Depends(get_session)]\`, then \`def read(session: SessionDep)\`. Reuse them for auth (\`CurrentUser = Annotated[User, Depends(current_user)]\`).
- \`async def\` only when everything inside awaits (httpx.AsyncClient, async DB drivers). Blocking libraries in \`async def\` freeze the server; use plain \`def\` for them.
- Errors: \`raise HTTPException(status_code=404, detail="Item not found")\`.
- Settings with pydantic-settings (\`BaseSettings\`), read from env once.
- Routers per area (\`APIRouter(prefix="/items", tags=["items"])\`).
- Test with \`TestClient(app)\` and pytest; override dependencies with \`app.dependency_overrides\`.
- Run: \`uv run fastapi dev main.py\` (or uvicorn). Docs at /docs come free; keep models documented.
`),
  skill('django', 'Build or change a Django project: models, migrations, views, templates, forms, admin, Django REST Framework. Use for projects with manage.py or django in dependencies.', `
# Django

- Models in \`<app>/models.py\`; after changing them run \`python manage.py makemigrations\` then \`migrate\`. Commit migrations; never edit applied ones.
- Querysets are lazy; avoid N+1 with \`select_related\` (foreign keys) and \`prefetch_related\` (many-to-many / reverse).
- Validation in forms/serializers and model \`clean()\`, not views.
- Views: class-based generic views for CRUD; function views for one-offs. Always check permissions (\`LoginRequiredMixin\`, \`permission_required\`).
- Templates auto-escape; never mark user content \`|safe\`.
- Settings from env; \`DEBUG=False\`, \`ALLOWED_HOSTS\` and a real \`SECRET_KEY\` in production.
- DRF: ModelSerializer + ViewSets + routers; permissions per view; pagination on list endpoints.
- Tests: \`python manage.py test\` or pytest-django; use the test client and factories.
`),
  skill('pandas-data', 'Analyse or clean data with pandas or Polars: loading CSV/Parquet, joins, group-bys, time series, charts, performance on big files. Use for data analysis, notebooks or "make a report from this data".', `
# Data work with pandas / Polars

- Look before you compute: shape, dtypes, \`head()\`, missing values, duplicates, value ranges. Write down what each column means.
- Parse types on load (\`parse_dates\`, \`dtype\`), not later. Prefer Parquet over CSV for anything reused.
- Vectorise: no row loops (\`iterrows\`) for arithmetic; use column operations, \`np.where\`, \`.map\`, \`merge\`, \`groupby().agg()\`.
- Avoid chained assignment; use \`.loc[mask, "col"] = value\` (or Polars expressions, which are immutable).
- Joins: check key uniqueness first (\`validate="one_to_one"\`/"many_to_one") so rows don't silently multiply.
- Big data: Polars lazy frames (\`scan_parquet\` … \`.collect()\`) or DuckDB SQL over files.
- Every chart has a title, labelled axes with units and a source note. Pick the chart for the question (trend: line; comparison: bar; distribution: histogram).
- Report numbers with their denominators and time range; say what was excluded and why.
`),
  skill('pytest', 'Write or fix Python tests with pytest: fixtures, parametrize, mocking, async tests, coverage, flaky tests. Use for any Python testing task.', `
# pytest

- Plain \`assert\`; pytest shows the values. One behaviour per test, named \`test_<what>_<when>_<expected>\`.
- Fixtures for setup (\`@pytest.fixture\`), \`tmp_path\` for files, \`monkeypatch\` for env and attributes.
- \`@pytest.mark.parametrize("value,expected", [...])\` instead of loops in a test.
- Exceptions: \`with pytest.raises(ValueError, match="positive"):\`.
- Mock at the boundary you own (HTTP via respx/responses, time via freezegun or a clock parameter), not deep internals.
- Async: pytest-asyncio or anyio markers.
- Property-based tests with Hypothesis for parsers, encoders and maths.
- Run: \`uv run pytest -q\`; one test with \`-k name\`; stop at first failure with \`-x\`; coverage with pytest-cov.
`),
  skill('go', 'Write or change Go code: modules, errors, interfaces, goroutines and channels, HTTP servers, tests and benchmarks. Use for .go files or go.mod projects.', `
# Go

- \`gofmt\`/\`go vet\` clean, always. Run \`go test ./...\` and \`go vet ./...\` before finishing.
- Errors are values: return them, wrap with context \`fmt.Errorf("load config: %w", err)\`, check with \`errors.Is/As\`. Don't panic for expected failures.
- Accept interfaces, return concrete types; keep interfaces small and defined where they're used.
- Every goroutine has an owner and a way to stop (context cancellation). Pass \`ctx context.Context\` as the first parameter of anything that does I/O.
- Protect shared state with a mutex or own it in one goroutine; run tests with \`-race\`.
- HTTP: \`net/http\` with the Go 1.22+ patterns (\`mux.HandleFunc("GET /items/{id}", h)\`, \`r.PathValue("id")\`); set server timeouts.
- Table-driven tests with \`t.Run\`; \`t.Helper()\` in helpers; benchmarks with \`b.Loop()\` or \`b.N\`.
- Dependencies: \`go get pkg@version\`, then \`go mod tidy\`.
`),
  skill('rust', 'Write or change Rust code: ownership and borrowing errors, Result-based error handling, traits, async with tokio, cargo, clippy, tests. Use for .rs files or Cargo.toml projects.', `
# Rust

- Fix borrow-checker errors by restructuring ownership (shorter borrows, cloning cheap data, splitting structs), not by sprinkling \`Rc<RefCell<>>\` or \`unsafe\`.
- Errors: \`Result<T, E>\` and \`?\`. Libraries define error enums (thiserror); applications use anyhow with \`.context("…")\`. No \`unwrap()\` outside tests and proven invariants (use \`expect("why")\`).
- Prefer \`&str\` / slices in parameters, owned types in structs.
- Iterators over index loops; \`collect::<Result<Vec<_>, _>>()\` to stop at the first error.
- Async: tokio; don't block inside async (use \`spawn_blocking\`); never hold a std Mutex across \`.await\`.
- \`cargo fmt\`, \`cargo clippy -- -D warnings\` and \`cargo test\` before finishing.
- Unit tests in \`#[cfg(test)] mod tests\`; integration tests in tests/.
`),

  // ─── Quality, testing, delivery ────────────────────────────────────────────
  skill('vitest-jest', 'Write or fix JavaScript/TypeScript unit tests with Vitest or Jest: mocks, fake timers, async code, component tests, snapshot hygiene. Use for *.test.ts / *.spec.ts work.', `
# Vitest / Jest

- Arrange, act, assert; one behaviour per test; names that read as sentences.
- Test behaviour through public APIs, not private functions or implementation details.
- Mock modules at the boundary (\`vi.mock('./api')\` / \`jest.mock\`), reset between tests (\`restoreMocks\` in config).
- Time: \`vi.useFakeTimers()\` + \`vi.advanceTimersByTime()\`; dates with \`vi.setSystemTime\`.
- Async: \`await expect(promise).rejects.toThrow('…')\`; never leave a promise un-awaited.
- Components: Testing Library with \`userEvent\`, queries by role/label; jsdom or happy-dom environment.
- Snapshots only for small, stable output; review every snapshot update.
- Run one file or test: \`npx vitest run path -t "name"\`; coverage with \`--coverage\`.
`),
  skill('playwright-e2e', 'Write or fix end-to-end browser tests with Playwright: locators, auto-waiting, auth state, flaky tests, traces, CI. Use for e2e tests or "test it in a real browser".', `
# Playwright

- Locate like a user: \`page.getByRole('button', { name: 'Sign in' })\`, \`getByLabel\`, \`getByText\`; \`getByTestId\` only when nothing else is stable. No CSS chains or XPath.
- Use web-first assertions that wait: \`await expect(locator).toBeVisible()\`, \`toHaveText\`, \`toHaveURL\`. Never \`waitForTimeout\` to "fix" flakiness.
- Log in once in a setup project and reuse \`storageState\`.
- Each test independent: its own data, no order dependence.
- Mock third-party network with \`page.route\`; keep your own API real when possible.
- Debug with \`npx playwright test --ui\` or \`--debug\`; on CI keep traces on first retry (\`trace: 'on-first-retry'\`) and read them with \`npx playwright show-trace\`.
`),
  skill('github-actions', 'Write or fix GitHub Actions workflows: CI for tests and lint, caching, matrices, releases, deployments, secrets, failing jobs. Use for .github/workflows files or "set up CI".', `
# GitHub Actions

- Trigger on \`pull_request\` and \`push\` to the default branch; add \`concurrency: { group: \${{ github.workflow }}-\${{ github.ref }}, cancel-in-progress: true }\`.
- Least privilege: \`permissions: { contents: read }\` at the top; grant more per job only when needed.
- Pin actions to a major version from trusted publishers (actions/checkout@v4, actions/setup-node@v4…) or to a commit SHA for third parties.
- Cache dependencies through the setup actions (\`cache: npm\`, \`cache: pip\`) or uv's \`enable-cache\`.
- Matrix for versions/OSes; \`fail-fast: false\` when you want every result.
- Secrets via \`\${{ secrets.NAME }}\`; never echo them; forked PRs don't get secrets (don't use \`pull_request_target\` to work around it with untrusted code).
- Don't interpolate untrusted input (issue titles, branch names) straight into \`run:\`; pass it through \`env:\`.
- Debug a red job by reading the first error in the log, reproducing the same command locally, and fixing the cause; re-running is not a fix.
`),
  skill('docker', 'Write or fix Dockerfiles and docker compose files: small secure images, multi-stage builds, caching, healthchecks, dev setups with a database. Use for containerising an app.', `
# Docker

- Multi-stage: build in one stage, copy only the output into a slim runtime image (\`node:<ver>-slim\`, \`python:<ver>-slim\`, distroless, or \`scratch\` for static Go/Rust binaries).
- Order for cache: copy lockfiles, install dependencies, *then* copy the source.
- Pin base image versions; add a \`.dockerignore\` (node_modules, .git, .env, build output).
- Run as a non-root \`USER\`; no secrets in the image or build args; pass them at runtime.
- One process per container; \`CMD ["node", "server.js"]\` exec form so signals reach it.
- \`HEALTHCHECK\` or compose \`healthcheck\` + \`depends_on: { db: { condition: service_healthy } }\`.
- Compose for local dev: app + Postgres/Redis with named volumes; environment from \`.env\`.
`),
  skill('kubernetes', 'Write or review Kubernetes manifests or Helm charts: deployments, services, ingress, config and secrets, probes, resources. Use for k8s YAML or "deploy this to Kubernetes".', `
# Kubernetes basics

- Deployment with readiness and liveness probes (readiness gates traffic; liveness restarts a stuck pod; don't make them identical heavy checks).
- Always set resource requests (and memory limits); unknown requests make scheduling unreliable.
- Config in ConfigMaps, secrets in Secrets (or an external secret manager); mount or env-inject, never bake into images.
- Run as non-root with \`securityContext\` (\`runAsNonRoot: true\`, \`readOnlyRootFilesystem: true\` where possible).
- Service for in-cluster traffic, Ingress (or Gateway) for HTTP from outside, with TLS.
- Rolling updates with \`maxUnavailable\`/\`maxSurge\`; a PodDisruptionBudget for anything that must stay up.
- Validate before applying: \`kubectl apply --dry-run=server -f\` or \`helm template | kubeconform\`.
`),
  skill('openapi', 'Design, document or generate clients from an OpenAPI (Swagger) spec; keep an API and its spec in sync. Use for openapi.yaml/json files or "document this API".', `
# OpenAPI

- One source of truth: generate the spec from code (FastAPI, Hono's zod-openapi, tsoa) or generate code from the spec, not both by hand.
- Every operation: \`operationId\`, summary, request schema, every response code it can return with a schema, and examples.
- Reuse schemas under \`components/schemas\`; errors share one error schema.
- Version the API in the path or a header; breaking changes go to a new version.
- Lint with Spectral or Redocly; generate typed clients with openapi-typescript / openapi-fetch or orval.
`),
  skill('graphql', 'Build or change a GraphQL API or client: schema design, resolvers, DataLoader for N+1, pagination, errors, codegen. Use for .graphql files or GraphQL servers/clients.', `
# GraphQL

- Schema first: nouns as types, verbs as mutations named \`createPost\`, \`updatePost\`, each taking one input object and returning a payload (the result plus user errors).
- Batch with DataLoader per request to avoid N+1 queries in nested resolvers.
- Cursor pagination (connections: edges, node, pageInfo) for lists that grow.
- Authorise in resolvers (or a directive) per field that needs it.
- Limit query depth/complexity on public servers.
- Clients: generate types with GraphQL Code Generator; colocate fragments with components.
`),
  skill('postgres', 'Write SQL or tune PostgreSQL: schema design, indexes, query plans (EXPLAIN), constraints, migrations without downtime, JSONB. Use for SQL work or slow database queries.', `
# PostgreSQL

- Types: \`bigint generated always as identity\` or uuid keys, \`timestamptz\` for times, \`numeric\` for money, \`text\` over varchar(n), \`jsonb\` only for genuinely schemaless data.
- Constraints are free correctness: NOT NULL, UNIQUE, CHECK, foreign keys with the right ON DELETE.
- Index what you filter, join and sort on; composite index column order matters (equality first, then range). Check with \`EXPLAIN (ANALYZE, BUFFERS)\`.
- Avoid \`SELECT *\` in app code; paginate with keyset (\`WHERE id > $1 ORDER BY id LIMIT 50\`) for big tables.
- Zero-downtime changes: add nullable column, backfill in batches, then add NOT NULL; \`CREATE INDEX CONCURRENTLY\`.
- Always parameterise queries; never interpolate user input.
`),
  skill('redis', 'Use Redis for caching, rate limiting, queues, sessions or pub/sub: key design, TTLs, data structures. Use when the project uses Redis/Valkey or needs a cache.', `
# Redis

- Keys: \`app:entity:id[:field]\`; every cache key has a TTL (\`SET key value EX 300\`).
- Cache-aside: read cache, on miss load from the database and set with TTL; invalidate (DEL) on write.
- Pick the structure: hashes for objects, sorted sets for leaderboards/time windows, sets for membership, streams for durable queues.
- Rate limiting: \`INCR\` + \`EXPIRE\` per window, or a sorted-set sliding window, done atomically (MULTI or a Lua script).
- Never use \`KEYS *\` in production; \`SCAN\` instead.
- Redis is not your source of truth unless persistence is configured on purpose.
`),
  skill('accessibility', 'Make a UI accessible (WCAG 2.2 AA): semantics, keyboard use, focus, labels, contrast, screen readers, ARIA. Use for any UI review or "make it accessible".', `
# Accessibility (WCAG 2.2 AA)

- Native elements first: \`<button>\` for actions, \`<a href>\` for navigation, \`<label for>\` for inputs, headings in order, one \`<h1>\`, landmarks (\`<main>\`, \`<nav>\`).
- Everything works with the keyboard alone: visible focus, logical tab order, Escape closes dialogs, focus moves into dialogs and returns after.
- Text contrast ≥ 4.5:1 (3:1 for large text and UI parts). Don't rely on colour alone.
- Images: meaningful \`alt\`; decorative ones \`alt=""\`. Icon buttons have an accessible name.
- ARIA only when no native element fits; a wrong role is worse than none. Live regions (\`aria-live="polite"\`) for async status.
- Forms: errors tied to fields (\`aria-describedby\`), not only red borders; don't disable submit without saying why.
- Respect \`prefers-reduced-motion\`; targets at least 24×24 px.
- Check with axe (e.g. @axe-core/playwright) and by tabbing through the page yourself.
`),
  skill('seo-web', 'Improve a site for search and AI answer engines: titles and meta, Open Graph, structured data (JSON-LD), sitemaps, robots, Core Web Vitals, llms.txt. Use for "SEO", "rank", "share previews" or marketing pages.', `
# SEO, AEO and GEO for web apps

- Each page: a unique \`<title>\` (≤ 60 chars) and meta description (≤ 155), one \`<h1>\`, canonical URL, \`lang\` on \`<html>\`.
- Social previews: Open Graph (\`og:title\`, \`og:description\`, \`og:image\` 1200×630) and \`twitter:card\`.
- Structured data in JSON-LD for what the page is (Organization, Product, Article, FAQPage, SoftwareApplication, BreadcrumbList).
- \`sitemap.xml\` listing canonical URLs; \`robots.txt\` pointing at it; noindex for private and duplicate pages.
- For AI answer engines: plain, quotable answers near the top, FAQ sections, an \`/llms.txt\` summary, stable URLs, and allow the answer bots you want in robots.txt.
- Core Web Vitals: LCP image preloaded and sized, no layout shift (width/height on media), minimal blocking JS.
- Content is server-rendered or prerendered; client-only rendering hides it from many crawlers.
`),
  skill('i18n', 'Add or fix internationalisation: extracting strings, i18next / next-intl / vue-i18n, plurals, dates and numbers, right-to-left. Use for translation or locale work.', `
# Internationalisation

- No user-visible string in code: keys in message files per locale (\`en.json\`, \`fr.json\`), loaded per route.
- Whole sentences with placeholders (\`"greeting": "Hello, {name}"\`), never concatenated fragments.
- Plurals and gender through ICU message format, not \`count === 1 ? … : …\`.
- Dates, numbers and currency with \`Intl.DateTimeFormat\` / \`Intl.NumberFormat\` for the user's locale.
- Right-to-left: \`dir="rtl"\` and logical CSS properties (\`margin-inline-start\`).
- Locale from the URL (\`/fr/…\`) for shareable, indexable pages, with \`hreflang\` alternates.
`),
  skill('releases-conventional-commits', 'Write commit messages, changelogs and releases: Conventional Commits, semantic versioning, release notes, tagging, publishing packages. Use for commits, versions, "prepare a release" or "publish to npm/PyPI".', `
# Commits and releases

- Conventional Commits: \`type(scope): summary\` with types feat, fix, docs, refactor, perf, test, build, ci, chore. \`!\` or a \`BREAKING CHANGE:\` footer for breaking changes. Summary in the imperative, ≤ 72 chars; the body says why.
- SemVer: breaking → major, feature → minor, fix → patch. Pre-1.0 anything goes but say so.
- Changelog grouped by Added / Changed / Fixed / Removed (Keep a Changelog), written for users, newest first.
- Release: update version and changelog in one commit, tag \`vX.Y.Z\`, create the GitHub release from the changelog section.
- Publishing: npm with provenance from CI (\`npm publish --provenance\`); PyPI with trusted publishing; never from a laptop with a long-lived token if CI can do it.
- Automate with release-please or changesets when the project already uses them.
`),

  // ─── Web3 ──────────────────────────────────────────────────────────────────
  skill('solidity-foundry', 'Write, test and deploy Solidity contracts with Foundry or Hardhat: project layout, forge tests and fuzzing, gas, scripts, verification, OpenZeppelin. Use for .sol files, foundry.toml or hardhat.config.', `
# Solidity with Foundry / Hardhat

- Start from OpenZeppelin Contracts (ERC20, ERC721, Ownable/AccessControl, ReentrancyGuard) instead of writing standards by hand.
- Pin the compiler: \`pragma solidity 0.8.x;\` (exact for deployable contracts). 0.8 checks overflow; \`unchecked\` only with a comment proving it can't overflow.
- Checks-effects-interactions; external calls last; \`nonReentrant\` on functions that move value.
- Custom errors (\`error NotOwner();\`) over revert strings; events for every state change that off-chain code needs.
- Foundry: \`forge init\`, contracts in src/, tests in test/*.t.sol (\`function test_…\`, \`function testFuzz_…(uint256 x)\`), \`vm.prank\`, \`vm.expectRevert\`, \`vm.deal\`. Run \`forge test -vvv\`, gas with \`forge test --gas-report\`, coverage with \`forge coverage\`.
- Hardhat: tests with viem or ethers + chai, \`npx hardhat test\`; Ignition modules for deployment.
- Deploy with scripts (\`forge script script/Deploy.s.sol --rpc-url $RPC --broadcast --verify\`); keys from env or a hardware wallet, never committed.
- Load the smart-contract-security skill before anything holds real value.
`),
  skill('dapp-viem-wagmi', 'Build a dapp front end that talks to contracts: viem, wagmi, RainbowKit or ConnectKit, reading and writing contracts, transaction states, chains. Use for web3 front ends or "connect a wallet".', `
# Dapps with viem + wagmi

- viem is the low-level client (publicClient for reads, walletClient for writes); wagmi wraps it in React hooks; RainbowKit/ConnectKit give the connect button.
- Config once: chains, transports (\`http(rpcUrl)\`), connectors; wrap the app in WagmiProvider + QueryClientProvider.
- ABIs as \`const\` (\`as const\`) for full type inference; addresses per chain in one map.
- Reads: \`useReadContract({ address, abi, functionName, args })\`. Writes: \`useWriteContract\` then \`useWaitForTransactionReceipt({ hash })\`; show pending → confirming → done/failed states.
- Always handle: wallet not connected, wrong chain (\`useSwitchChain\`), user rejected, insufficient funds, reverted (show the decoded custom error).
- Amounts are bigint in wei: \`parseEther('0.1')\`, \`formatUnits(value, decimals)\`; never JavaScript numbers for token amounts.
- Never ask users to paste private keys or seed phrases.
`),
];

const deps = (files: Record<string, string>): Set<string> => {
  const out = new Set<string>();
  for (const [path, text] of Object.entries(files)) {
    if (path.endsWith('package.json') && !path.includes('node_modules/')) {
      try {
        const pkg = JSON.parse(text);
        for (const k of Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) })) out.add(k);
      } catch {
        // not JSON yet
      }
    } else if (/(^|\/)(pyproject\.toml|requirements[\w.-]*\.txt)$/.test(path)) {
      for (const m of text.toLowerCase().matchAll(/["'\s^]([a-z][a-z0-9_.-]*)\s*(?:[<>=~!\[;"',]|$)/gm)) out.add(m[1]);
    }
  }
  return out;
};

/**
 * Which ecosystem skills fit a project, from its files: the agent sees their descriptions; the others are listed
 * by name only, so a big library doesn't crowd the prompt but every skill stays one use_skill call away.
 */
export function relevantEcosystemSkills(files: Record<string, string>): Set<string> {
  const d = deps(files);
  const paths = Object.keys(files);
  const has = (re: RegExp) => paths.some((p) => re.test(p));
  const any = (...names: string[]) => names.some((n) => d.has(n));
  const rules: Record<string, boolean> = {
    react: any('react', 'preact') || has(/\.(jsx|tsx)$/),
    nextjs: any('next'),
    vue: any('vue', 'nuxt') || has(/\.vue$/),
    svelte: any('svelte', '@sveltejs/kit') || has(/\.svelte$/),
    tailwind: any('tailwindcss', '@tailwindcss/vite', '@tailwindcss/postcss'),
    'shadcn-ui': has(/(^|\/)components\.json$/) || has(/components\/ui\//),
    vite: any('vite'),
    'typescript-strict': has(/\.tsx?$/),
    'node-api': any('hono', 'express', 'fastify', 'koa'),
    'prisma-drizzle': any('prisma', '@prisma/client', 'drizzle-orm') || has(/schema\.prisma$/),
    fastapi: any('fastapi'),
    django: any('django', 'djangorestframework') || has(/(^|\/)manage\.py$/),
    'pandas-data': any('pandas', 'polars', 'numpy', 'duckdb') || has(/\.(ipynb|csv|parquet)$/),
    pytest: any('pytest') || has(/(^|\/)(test_\w+|\w+_test)\.py$/),
    go: has(/(^|\/)go\.mod$|\.go$/),
    rust: has(/(^|\/)Cargo\.toml$|\.rs$/),
    'vitest-jest': any('vitest', 'jest'),
    'playwright-e2e': any('@playwright/test', 'playwright'),
    'github-actions': has(/^\.github\/workflows\//),
    docker: has(/(^|\/)(Dockerfile|docker-compose[\w.-]*\.ya?ml|compose\.ya?ml)$/),
    kubernetes: has(/(^|\/)(k8s|kubernetes|helm|charts)\//) || has(/Chart\.yaml$/),
    openapi: has(/(^|\/)(openapi|swagger)\.(ya?ml|json)$/) || any('@hono/zod-openapi', 'fastapi'),
    graphql: any('graphql', '@apollo/server', 'graphql-yoga', 'urql', '@apollo/client') || has(/\.(graphql|gql)$/),
    postgres: any('pg', 'postgres', 'psycopg', 'psycopg2', 'asyncpg', '@neondatabase/serverless') || has(/\.sql$/),
    redis: any('redis', 'ioredis', '@upstash/redis'),
    accessibility: has(/\.(jsx|tsx|vue|svelte|html)$/),
    'seo-web': any('next', 'astro', 'nuxt', '@sveltejs/kit') || has(/(^|\/)index\.html$/),
    i18n: any('i18next', 'react-i18next', 'next-intl', 'vue-i18n') || has(/(^|\/)(locales|messages|i18n)\//),
    'releases-conventional-commits': has(/(^|\/)CHANGELOG\.md$/) || any('release-please', '@changesets/cli', 'semantic-release'),
    'solidity-foundry': has(/\.sol$|(^|\/)foundry\.toml$|(^|\/)hardhat\.config\.\w+$/),
    'dapp-viem-wagmi': any('viem', 'wagmi', 'ethers', '@rainbow-me/rainbowkit', 'connectkit'),
  };
  return new Set(Object.entries(rules).filter(([, v]) => v).map(([k]) => k));
}

export const ECOSYSTEM_NAMES = new Set(ECOSYSTEM_SKILLS.map(([name]) => name));
