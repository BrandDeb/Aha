/**
 * The stack builder's catalogue: every choice you can make for a new project
 * (framework, styling, UI kit, libraries, testing, code quality, backend), each
 * with what it is, when to pick it, the packages it adds and what it needs or
 * rules out. Web projects install with npm; Python projects list their
 * packages in pyproject.toml the way `uv add` does. Pure data and rules,
 * tested directly; stack/web.ts and stack/python.ts turn a choice into files.
 */

export type StackKind = 'web' | 'python';
export type Framework = 'react' | 'vue' | 'svelte' | 'solid' | 'preact' | 'vanilla';
export type Styling = 'css' | 'tailwind' | 'css-modules' | 'sass' | 'bootstrap' | 'bulma' | 'pico' | 'unocss';
export type PyFramework = 'fastapi' | 'flask' | 'typer' | 'script';

export type Category = 'ui' | 'data' | 'routing' | 'state' | 'forms' | 'utils' | 'testing' | 'quality' | 'backend' | 'py-web' | 'py-data' | 'py-ai' | 'py-cli' | 'py-dev';

export const CATEGORY_LABEL: Record<Category, string> = {
  ui: 'Components',
  data: 'Data fetching',
  routing: 'Routing',
  state: 'State',
  forms: 'Forms and validation',
  utils: 'Utilities',
  testing: 'Testing',
  quality: 'Lint and format',
  backend: 'API and database',
  'py-web': 'Web and APIs',
  'py-data': 'Data',
  'py-ai': 'AI',
  'py-cli': 'Command line and output',
  'py-dev': 'Testing and quality',
};

export interface Choice<Id extends string = string> {
  id: Id;
  name: string;
  /** What it is, in a line */
  blurb: string;
  /** When it is the right pick */
  why: string;
}

export const FRAMEWORKS: (Choice<Framework> & { deps: Record<string, string>; dev: Record<string, string> })[] = [
  { id: 'react', name: 'React', blurb: 'Components and hooks; the largest ecosystem.', why: 'The safe default: every library, UI kit and hiring pool supports it.', deps: { react: '^19.3.1', 'react-dom': '^19.3.1' }, dev: { '@types/react': '^19.3.0', '@types/react-dom': '^19.3.0', '@vitejs/plugin-react': '^6.1.2' } },
  { id: 'vue', name: 'Vue', blurb: 'Single-file components with templates and reactivity built in.', why: 'Gentle to learn, batteries included (router, store), great for teams coming from HTML.', deps: { vue: '^3.5.44' }, dev: { '@vitejs/plugin-vue': '^6.0.10', 'vue-tsc': '^3.3.13' } },
  { id: 'svelte', name: 'Svelte', blurb: 'A compiler: components become small, fast JavaScript.', why: 'The least code for interactive UI and the smallest bundles.', deps: {}, dev: { svelte: '^5.57.2', '@sveltejs/vite-plugin-svelte': '^7.3.1', 'svelte-check': '^4.7.7' } },
  { id: 'solid', name: 'Solid', blurb: 'JSX with fine-grained signals and no virtual DOM.', why: 'React-like code with top-tier runtime speed.', deps: { 'solid-js': '^1.9.17' }, dev: { 'vite-plugin-solid': '^2.11.14' } },
  { id: 'preact', name: 'Preact', blurb: 'React’s API in 4 kB.', why: 'When page weight matters (widgets, embedded UI) but you want React habits.', deps: { preact: '^11.0.1' }, dev: { '@preact/preset-vite': '^2.10.6' } },
  { id: 'vanilla', name: 'No framework', blurb: 'Plain TypeScript and the DOM.', why: 'Small pages, learning, or when you want no dependencies at all.', deps: {}, dev: {} },
];

export const STYLINGS: (Choice<Styling> & { deps: Record<string, string>; dev: Record<string, string> })[] = [
  { id: 'tailwind', name: 'Tailwind CSS', blurb: 'Utility classes, v4 with the Vite plugin.', why: 'Fastest way to a consistent design; what most UI kits (shadcn/ui, daisyUI) build on.', deps: {}, dev: { tailwindcss: '^4.3.3', '@tailwindcss/vite': '^4.3.3' } },
  { id: 'css', name: 'Plain CSS', blurb: 'One stylesheet with custom properties.', why: 'No tooling to learn; modern CSS (nesting, variables, grid) covers a lot.', deps: {}, dev: {} },
  { id: 'css-modules', name: 'CSS Modules', blurb: 'Plain CSS, scoped to the component that imports it.', why: 'Plain CSS without class-name collisions in bigger apps.', deps: {}, dev: {} },
  { id: 'sass', name: 'Sass', blurb: 'CSS with variables, mixins and partials (SCSS).', why: 'Existing Sass skills or design systems; powerful reuse in stylesheets.', deps: {}, dev: { sass: '^1.106.1' } },
  { id: 'bootstrap', name: 'Bootstrap', blurb: 'The classic component CSS: grid, cards, forms, buttons.', why: 'Admin screens and internal tools that should look fine with no design work.', deps: { bootstrap: '^5.3.8' }, dev: {} },
  { id: 'bulma', name: 'Bulma', blurb: 'Readable, class-based CSS components with no JavaScript.', why: 'Bootstrap-like results with friendlier class names.', deps: { bulma: '^1.0.4' }, dev: {} },
  { id: 'pico', name: 'Pico CSS', blurb: 'Styles plain HTML elements; almost no classes.', why: 'Prototypes and docs-like pages that look good from semantic HTML alone.', deps: { '@picocss/pico': '^2.1.1' }, dev: {} },
  { id: 'unocss', name: 'UnoCSS', blurb: 'On-demand atomic CSS, Tailwind-compatible utilities.', why: 'Tailwind’s style with faster builds and full configurability.', deps: {}, dev: { unocss: '^66.11.0' } },
];

export interface Library extends Choice {
  category: Category;
  kind: StackKind;
  /** Frameworks it works with (web); all when absent */
  frameworks?: Framework[];
  /** Styling it needs (one of) */
  stylings?: Styling[];
  /** Other choices it needs; added with it */
  requires?: string[];
  /** Choices it can't be combined with */
  conflicts?: string[];
  /** Python: frameworks it applies to */
  py?: PyFramework[];
  deps?: Record<string, string>;
  dev?: Record<string, string>;
  /** Picked by default for a new stack */
  recommended?: boolean;
}

export const LIBRARIES: Library[] = [
  // UI kits
  { id: 'shadcn', kind: 'web', category: 'ui', name: 'shadcn/ui', blurb: 'Copy-in React components (Button, Card, Input) built on Radix and Tailwind.', why: 'Beautiful, accessible components you own and can edit; the default for new React apps.', frameworks: ['react'], stylings: ['tailwind'], deps: { 'radix-ui': '^1.8.1', 'class-variance-authority': '^0.7.1', clsx: '^2.1.1', 'tailwind-merge': '^3.7.0', 'lucide-react': '^1.61.0' }, dev: { 'tw-animate-css': '^1.4.0', '@types/node': '^24' }, conflicts: ['daisyui', 'mantine'] },
  { id: 'daisyui', kind: 'web', category: 'ui', name: 'daisyUI', blurb: 'Component classes (btn, card, badge) and themes on top of Tailwind.', why: 'Tailwind with ready-made components in any framework, no JavaScript.', stylings: ['tailwind'], dev: { daisyui: '^5.7.50' }, conflicts: ['shadcn', 'mantine'] },
  { id: 'mantine', kind: 'web', category: 'ui', name: 'Mantine', blurb: 'A full React component library with its own styles and hooks.', why: 'Dashboards and data-heavy apps: 100+ components, dates, notifications, forms.', frameworks: ['react'], stylings: ['css', 'css-modules'], deps: { '@mantine/core': '^9.7.3', '@mantine/hooks': '^9.7.3' }, dev: { postcss: '^8.5.31' }, conflicts: ['shadcn', 'daisyui'] },
  { id: 'lucide', kind: 'web', category: 'ui', name: 'Lucide icons', blurb: '1,500+ consistent stroke icons as components.', why: 'Icons that match shadcn/ui and most modern designs.', frameworks: ['react'], deps: { 'lucide-react': '^1.61.0' } },
  { id: 'motion', kind: 'web', category: 'ui', name: 'Motion', blurb: 'Animations and gestures (formerly Framer Motion).', why: 'Polished transitions with a few props.', frameworks: ['react'], deps: { motion: '^14.6.0' } },
  { id: 'sonner', kind: 'web', category: 'ui', name: 'Sonner', blurb: 'Toast notifications in one line.', why: 'Feedback for saves, errors and background work.', frameworks: ['react'], deps: { sonner: '^2.0.8' } },
  { id: 'recharts', kind: 'web', category: 'ui', name: 'Recharts', blurb: 'Composable SVG charts.', why: 'Dashboards: line, bar and area charts from plain arrays.', frameworks: ['react'], deps: { recharts: '^3.10.1' } },
  // Data fetching
  { id: 'tanstack-query', kind: 'web', category: 'data', name: 'TanStack Query', blurb: 'Server state: fetching, caching, retries and refetching.', why: 'Any app that talks to an API: no hand-written loading/error/caching code.', frameworks: ['react', 'vue', 'solid'], recommended: true },
  { id: 'swr', kind: 'web', category: 'data', name: 'SWR', blurb: 'Stale-while-revalidate data fetching hook.', why: 'A lighter alternative to TanStack Query for simple reads.', frameworks: ['react'], deps: { swr: '^2.5.1' }, conflicts: ['tanstack-query'] },
  { id: 'axios', kind: 'web', category: 'data', name: 'Axios', blurb: 'HTTP client with interceptors and JSON by default.', why: 'APIs with auth headers, base URLs and shared error handling.', deps: { axios: '^1.20.0' } },
  // Routing
  { id: 'tanstack-router', kind: 'web', category: 'routing', name: 'TanStack Router', blurb: 'Fully type-safe routes, params and search params.', why: 'Multi-page React apps where links and params are checked by TypeScript.', frameworks: ['react'], deps: { '@tanstack/react-router': '^1.170.46' }, conflicts: ['react-router'] },
  { id: 'react-router', kind: 'web', category: 'routing', name: 'React Router', blurb: 'The most used React router.', why: 'Familiar, well documented routing for React.', frameworks: ['react'], deps: { 'react-router': '^8.5.0' }, conflicts: ['tanstack-router'] },
  { id: 'vue-router', kind: 'web', category: 'routing', name: 'Vue Router', blurb: 'Vue’s official router.', why: 'Any Vue app with more than one page.', frameworks: ['vue'], deps: { 'vue-router': '^5.4.0' } },
  { id: 'solid-router', kind: 'web', category: 'routing', name: 'Solid Router', blurb: 'Solid’s official router.', why: 'Multi-page Solid apps.', frameworks: ['solid'], deps: { '@solidjs/router': '^1.0.0' } },
  // State
  { id: 'zustand', kind: 'web', category: 'state', name: 'Zustand', blurb: 'Tiny global store with hooks.', why: 'Shared client state without boilerplate.', frameworks: ['react'], deps: { zustand: '^5.0.16' }, conflicts: ['jotai', 'redux'] },
  { id: 'jotai', kind: 'web', category: 'state', name: 'Jotai', blurb: 'Atomic state: small pieces composed together.', why: 'Lots of independent bits of state (editors, settings).', frameworks: ['react'], deps: { jotai: '^3.0.1' }, conflicts: ['zustand', 'redux'] },
  { id: 'redux', kind: 'web', category: 'state', name: 'Redux Toolkit', blurb: 'Predictable global state with slices and devtools.', why: 'Large teams and apps that want strict, traceable state changes.', frameworks: ['react'], deps: { '@reduxjs/toolkit': '^2.13.0', 'react-redux': '^9.3.0' }, conflicts: ['zustand', 'jotai'] },
  { id: 'pinia', kind: 'web', category: 'state', name: 'Pinia', blurb: 'Vue’s official store.', why: 'Shared state across Vue components with devtools support.', frameworks: ['vue'], deps: { pinia: '^4.1.0' } },
  { id: 'vueuse', kind: 'web', category: 'utils', name: 'VueUse', blurb: '200+ composition utilities (mouse, storage, fetch…).', why: 'Saves writing common composables by hand.', frameworks: ['vue'], deps: { '@vueuse/core': '^15.0.0' } },
  // Forms and validation
  { id: 'zod', kind: 'web', category: 'forms', name: 'Zod', blurb: 'Schemas that validate data and give you its type.', why: 'Validate forms, API responses and env vars with one definition.', deps: { zod: '^4.6.7' }, recommended: true },
  { id: 'react-hook-form', kind: 'web', category: 'forms', name: 'React Hook Form', blurb: 'Performant forms with minimal re-renders.', why: 'Forms of any size; pairs with Zod for validation.', frameworks: ['react'], deps: { 'react-hook-form': '^7.90.0' }, conflicts: ['tanstack-form'] },
  { id: 'tanstack-form', kind: 'web', category: 'forms', name: 'TanStack Form', blurb: 'Type-safe form state and validation.', why: 'Complex forms where every field is fully typed.', frameworks: ['react'], deps: { '@tanstack/react-form': '^1.33.5' }, conflicts: ['react-hook-form'] },
  { id: 'tanstack-table', kind: 'web', category: 'utils', name: 'TanStack Table', blurb: 'Headless tables: sorting, filtering, pagination.', why: 'Admin screens and data grids with your own markup.', frameworks: ['react', 'vue'] },
  // Utilities
  { id: 'date-fns', kind: 'web', category: 'utils', name: 'date-fns', blurb: 'Modular date formatting and arithmetic.', why: 'Anything with dates: format, compare, add days, time ago.', deps: { 'date-fns': '^4.4.0' } },
  { id: 'i18n', kind: 'web', category: 'utils', name: 'i18next', blurb: 'Translations and plurals.', why: 'Apps that ship in more than one language.', frameworks: ['react'], deps: { i18next: '^26.5.6', 'react-i18next': '^17.1.4' } },
  // Testing
  { id: 'vitest', kind: 'web', category: 'testing', name: 'Vitest + Testing Library', blurb: 'Unit and component tests that run with Vite.', why: 'Fast tests that share your Vite config; components tested like a user uses them.', dev: { vitest: '^5.0.5', jsdom: '^30.1.3' }, recommended: true },
  { id: 'playwright', kind: 'web', category: 'testing', name: 'Playwright', blurb: 'End-to-end tests in real browsers.', why: 'Prove whole user flows work (sign up, checkout) before you ship.', dev: { '@playwright/test': '^1.64.1' } },
  // Quality
  { id: 'eslint', kind: 'web', category: 'quality', name: 'ESLint', blurb: 'Finds bugs and bad patterns in your code.', why: 'Catches mistakes early, with React hooks rules for React.', dev: { eslint: '^10.13.0', '@eslint/js': '^10.0.1', 'typescript-eslint': '^8.72.0', globals: '^17.13.0' }, conflicts: ['biome'], recommended: true },
  { id: 'prettier', kind: 'web', category: 'quality', name: 'Prettier', blurb: 'Formats code the same way every time.', why: 'No style debates in reviews.', dev: { prettier: '^3.9.10' }, conflicts: ['biome'] },
  { id: 'biome', kind: 'web', category: 'quality', name: 'Biome', blurb: 'Linter and formatter in one fast tool.', why: 'ESLint and Prettier in one, about 20× faster.', dev: { '@biomejs/biome': '^2.6.2' }, conflicts: ['eslint', 'prettier'] },
  // Backend
  { id: 'hono', kind: 'web', category: 'backend', name: 'Hono API', blurb: 'An API under /api, served by the same dev server as the page.', why: 'A real backend (JSON endpoints, auth, secrets) without a second project.', deps: { hono: '^4.13.13', '@hono/node-server': '^2.1.5' }, dev: { '@hono/vite-dev-server': '^0.26.1', '@types/node': '^24' } },
  { id: 'drizzle', kind: 'web', category: 'backend', name: 'Drizzle + SQLite', blurb: 'A typed SQL database in a file, queried from the API.', why: 'Persistent data with zero setup; move to Postgres later with the same code.', requires: ['hono'], deps: { 'drizzle-orm': '^0.45.4', 'better-sqlite3': '^13.0.3' }, dev: { 'drizzle-kit': '^0.31.11', '@types/better-sqlite3': '^9.6.0' } },

  // Python (pyproject dependencies, added the way `uv add` does)
  { id: 'pydantic', kind: 'python', category: 'py-web', name: 'Pydantic', blurb: 'Data validation with type hints.', why: 'Validate input and settings; FastAPI already uses it.', deps: { pydantic: '>=2.14' }, recommended: true },
  { id: 'pydantic-settings', kind: 'python', category: 'py-web', name: 'pydantic-settings', blurb: 'Typed settings from environment variables and .env.', why: 'Config and secrets without os.environ scattered everywhere.', deps: { 'pydantic-settings': '>=2.16' } },
  { id: 'httpx', kind: 'python', category: 'py-web', name: 'HTTPX', blurb: 'Modern HTTP client, sync and async.', why: 'Call other APIs; also FastAPI’s test client.', deps: { httpx: '>=0.28' } },
  { id: 'sqlmodel', kind: 'python', category: 'py-web', name: 'SQLModel + SQLite', blurb: 'SQL tables as Pydantic models.', why: 'A database for FastAPI with one model per table.', deps: { sqlmodel: '>=0.0.48' }, py: ['fastapi', 'flask', 'typer', 'script'] },
  { id: 'jinja2', kind: 'python', category: 'py-web', name: 'Jinja2', blurb: 'HTML templates.', why: 'Server-rendered pages from FastAPI.', deps: { jinja2: '>=3.1' }, py: ['fastapi'] },
  { id: 'pandas', kind: 'python', category: 'py-data', name: 'pandas', blurb: 'DataFrames for tables, CSV and Excel.', why: 'The standard for data wrangling and analysis.', deps: { pandas: '>=3.1' }, conflicts: ['polars'] },
  { id: 'polars', kind: 'python', category: 'py-data', name: 'Polars', blurb: 'Very fast DataFrames with a lazy query engine.', why: 'Large data where pandas is slow.', deps: { polars: '>=2.0' }, conflicts: ['pandas'] },
  { id: 'numpy', kind: 'python', category: 'py-data', name: 'NumPy', blurb: 'Arrays and numeric computing.', why: 'Maths, statistics and anything vectorised.', deps: { numpy: '>=2.5' } },
  { id: 'matplotlib', kind: 'python', category: 'py-data', name: 'Matplotlib', blurb: 'Charts saved as images.', why: 'Plots for reports and notebooks.', deps: { matplotlib: '>=3.11' } },
  { id: 'anthropic', kind: 'python', category: 'py-ai', name: 'Anthropic SDK', blurb: 'Claude models from Python.', why: 'Add an AI feature: summaries, chat, extraction, agents.', deps: { anthropic: '>=2.2' } },
  { id: 'openai', kind: 'python', category: 'py-ai', name: 'OpenAI SDK', blurb: 'OpenAI and compatible APIs from Python.', why: 'GPT models, or any OpenAI-compatible endpoint (Groq, local servers).', deps: { openai: '>=3.37' } },
  { id: 'rich', kind: 'python', category: 'py-cli', name: 'Rich', blurb: 'Colour, tables and progress bars in the terminal.', why: 'Command-line output people enjoy reading.', deps: { rich: '>=15.0' } },
  { id: 'dotenv', kind: 'python', category: 'py-cli', name: 'python-dotenv', blurb: 'Loads a .env file into the environment.', why: 'Keep keys out of code in small scripts.', deps: { 'python-dotenv': '>=1.2' } },
  { id: 'loguru', kind: 'python', category: 'py-cli', name: 'Loguru', blurb: 'Logging that works with one import.', why: 'Readable logs without configuring the logging module.', deps: { loguru: '>=0.7' } },
  { id: 'pytest', kind: 'python', category: 'py-dev', name: 'pytest', blurb: 'The standard test runner.', why: 'Plain assert-based tests with great output.', dev: { pytest: '>=9.1' }, recommended: true },
  { id: 'ruff', kind: 'python', category: 'py-dev', name: 'Ruff', blurb: 'Linter and formatter, extremely fast.', why: 'Replaces flake8, isort and black in one tool.', dev: { ruff: '>=0.17' }, recommended: true },
  { id: 'mypy', kind: 'python', category: 'py-dev', name: 'mypy', blurb: 'Static type checking.', why: 'Catch type errors before running.', dev: { mypy: '>=2.4' } },
];

export const PY_FRAMEWORKS: (Choice<PyFramework> & { deps: Record<string, string> })[] = [
  { id: 'fastapi', name: 'FastAPI', blurb: 'Typed async web APIs with automatic docs at /docs.', why: 'APIs and backends: validation, docs and speed out of the box.', deps: { fastapi: '>=0.161', uvicorn: '>=0.54' } },
  { id: 'flask', name: 'Flask', blurb: 'The minimal web framework: routes and templates.', why: 'Small sites and APIs where you want to choose every piece.', deps: { flask: '>=3.1' } },
  { id: 'typer', name: 'Typer CLI', blurb: 'Command-line apps from type-hinted functions.', why: 'Tools you run in a terminal, with --help for free.', deps: { typer: '>=0.27' } },
  { id: 'script', name: 'Script', blurb: 'A plain Python program.', why: 'Automation, data jobs and experiments.', deps: {} },
];

export interface StackChoice {
  kind: StackKind;
  name: string;
  framework: Framework;
  styling: Styling;
  pyFramework: PyFramework;
  libraries: string[];
}

export const DEFAULT_STACK: StackChoice = { kind: 'web', name: 'my-app', framework: 'react', styling: 'tailwind', pyFramework: 'fastapi', libraries: ['shadcn', 'tanstack-query', 'zod', 'vitest', 'eslint'] };

export const getLibrary = (id: string) => LIBRARIES.find((l) => l.id === id);

/** Why a library can't be picked with the rest of the choice, or null when it can */
export function unavailable(lib: Library, choice: Pick<StackChoice, 'kind' | 'framework' | 'styling' | 'pyFramework'>): string | null {
  if (lib.kind !== choice.kind) return 'Not for this kind of project';
  if (lib.kind === 'web') {
    if (lib.frameworks && !lib.frameworks.includes(choice.framework)) return `Needs ${lib.frameworks.map((f) => FRAMEWORKS.find((x) => x.id === f)!.name).join(' or ')}`;
    if (lib.stylings && !lib.stylings.includes(choice.styling)) return `Needs ${lib.stylings.map((s) => STYLINGS.find((x) => x.id === s)!.name).join(' or ')}`;
  } else if (lib.py && !lib.py.includes(choice.pyFramework)) return `For ${lib.py.map((f) => PY_FRAMEWORKS.find((x) => x.id === f)!.name).join(' or ')}`;
  return null;
}

/**
 * A consistent choice: libraries that don't fit the framework or styling are dropped, what they
 * require is added, and of two that conflict the one picked later wins. Returns what changed, in words.
 */
export function resolveStack(choice: StackChoice): { choice: StackChoice; notes: string[] } {
  const notes: string[] = [];
  const picked: string[] = [];
  const queue = [...new Set(choice.libraries)];
  while (queue.length) {
    const id = queue.shift()!;
    const lib = getLibrary(id);
    if (!lib || picked.includes(id)) continue;
    const why = unavailable(lib, choice);
    if (why) {
      notes.push(`${lib.name} left out: ${why.toLowerCase()}.`);
      continue;
    }
    for (const other of lib.conflicts ?? []) {
      const at = picked.indexOf(other);
      if (at >= 0) {
        picked.splice(at, 1);
        notes.push(`${getLibrary(other)!.name} replaced by ${lib.name}.`);
      }
    }
    picked.push(id);
    for (const req of lib.requires ?? []) {
      if (!picked.includes(req) && !queue.includes(req)) {
        queue.push(req);
        notes.push(`${getLibrary(req)!.name} added: ${lib.name} needs it.`);
      }
    }
  }
  // Libraries whose requirement was dropped (by a conflict or because it doesn't fit) go too
  for (const id of [...picked]) {
    const missing = (getLibrary(id)!.requires ?? []).find((r) => !picked.includes(r));
    if (missing) {
      picked.splice(picked.indexOf(id), 1);
      notes.push(`${getLibrary(id)!.name} left out: needs ${getLibrary(missing)!.name}.`);
    }
  }
  const name = choice.name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'my-app';
  return { choice: { ...choice, name, libraries: picked }, notes };
}

/** Libraries offered for a kind of project, by category, in catalogue order */
export function librariesByCategory(kind: StackKind): { category: Category; libraries: Library[] }[] {
  const out: { category: Category; libraries: Library[] }[] = [];
  for (const lib of LIBRARIES.filter((l) => l.kind === kind)) {
    const group = out.find((g) => g.category === lib.category);
    if (group) group.libraries.push(lib);
    else out.push({ category: lib.category, libraries: [lib] });
  }
  return out;
}
