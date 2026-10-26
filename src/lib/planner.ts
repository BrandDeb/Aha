/**
 * Describe-to-app: from a sentence ("an expense tracker that saves to a
 * database, with charts") to a plan — which language and stack to use, why,
 * and the brief the agent builds from. The choice is made by readable rules,
 * not a model, so it is instant, free, works offline and always explains
 * itself; you can change any part of it in the stack builder before creating.
 * A language or framework you name always wins.
 */

import { GALLERY, type GalleryApp, type GallerySource } from './gallery.ts';
import { DEFAULT_STACK, getLibrary, type Framework, type PyFramework, type StackChoice, type Styling } from './stack/catalog.ts';

export interface AppPlan {
  /** A project name made from the description */
  name: string;
  /** What the starter is: a stack to build or a template */
  source: GallerySource;
  /** The stack in a few words ("React · Tailwind CSS · shadcn/ui …" or "Go app") */
  label: string;
  /** Why each part was chosen */
  reasons: string[];
  /** The closest app in the gallery, when the description matches one */
  similar?: GalleryApp;
  /** What the agent is asked to do */
  brief: string;
}

const words = (text: string) => ` ${text.toLowerCase().replace(/[^a-z0-9#+.\s-]/g, ' ').replace(/\s+/g, ' ')} `;
const any = (text: string, ...terms: string[]) => terms.some((t) => text.includes(` ${t} `) || text.includes(` ${t}s `) || (t.includes(' ') && text.includes(t)));

/** Languages and stacks you can name, with the starter each one uses for an app */
const NAMED: { terms: string[]; label: string; source: (kind: 'app' | 'cli' | 'api') => GallerySource | null; framework?: Framework; py?: true }[] = [
  { terms: ['react'], label: 'React', framework: 'react', source: () => null },
  { terms: ['vue', 'vuejs'], label: 'Vue', framework: 'vue', source: () => null },
  { terms: ['svelte'], label: 'Svelte', framework: 'svelte', source: () => null },
  { terms: ['solid', 'solidjs'], label: 'Solid', framework: 'solid', source: () => null },
  { terms: ['preact'], label: 'Preact', framework: 'preact', source: () => null },
  { terms: ['next', 'nextjs', 'next.js'], label: 'Next.js', source: () => ({ template: 'web-next' }) },
  { terms: ['nuxt'], label: 'Nuxt', source: () => ({ template: 'web-nuxt' }) },
  { terms: ['sveltekit'], label: 'SvelteKit', source: () => ({ template: 'web-sveltekit' }) },
  { terms: ['astro'], label: 'Astro', source: () => ({ template: 'web-astro' }) },
  { terms: ['angular'], label: 'Angular', source: () => ({ template: 'web-angular' }) },
  { terms: ['fastapi'], label: 'FastAPI', py: true, source: () => null },
  { terms: ['flask'], label: 'Flask', py: true, source: () => null },
  { terms: ['django'], label: 'Python', py: true, source: () => null },
  { terms: ['python', 'py'], label: 'Python', py: true, source: () => null },
  { terms: ['go', 'golang'], label: 'Go', source: (k) => ({ template: k === 'cli' ? 'proj-go-wordstats' : 'app-go' }) },
  { terms: ['rust', 'axum'], label: 'Rust', source: (k) => ({ template: k === 'cli' ? 'proj-rust-wordstats' : 'app-rust' }) },
  { terms: ['elixir', 'phoenix'], label: 'Elixir', source: (k) => ({ template: k === 'cli' ? 'proj-elixir-wordstats' : 'app-elixir' }) },
  { terms: ['java', 'spring'], label: 'Java', source: (k) => ({ template: k === 'cli' ? 'proj-java-wordstats' : 'app-java' }) },
  { terms: ['kotlin'], label: 'Kotlin', source: () => ({ template: 'proj-kotlin-wordstats' }) },
  { terms: ['c#', 'csharp', '.net', 'dotnet', 'asp.net'], label: 'C#', source: (k) => ({ template: k === 'cli' ? 'proj-csharp-wordstats' : 'app-aspnet' }) },
  { terms: ['php', 'laravel'], label: 'PHP', source: (k) => ({ template: k === 'cli' ? 'proj-php-wordstats' : 'app-php' }) },
  { terms: ['ruby', 'sinatra', 'rails'], label: 'Ruby', source: (k) => ({ template: k === 'cli' ? 'proj-ruby-wordstats' : 'app-sinatra' }) },
  { terms: ['bun'], label: 'Bun', source: (k) => ({ template: k === 'cli' ? 'proj-bun-wordstats' : 'app-bun' }) },
  { terms: ['deno'], label: 'Deno', source: (k) => ({ template: k === 'cli' ? 'proj-deno-wordstats' : 'app-deno' }) },
  { terms: ['express', 'node', 'nodejs', 'node.js'], label: 'Node.js', source: (k) => ({ template: k === 'cli' ? 'proj-node-wordstats' : 'app-express' }) },
  { terms: ['swift'], label: 'Swift', source: () => ({ template: 'proj-swift-wordstats' }) },
  { terms: ['zig'], label: 'Zig', source: () => ({ template: 'proj-zig-wordstats' }) },
  { terms: ['dart'], label: 'Dart', source: () => ({ template: 'proj-dart-wordstats' }) },
  { terms: ['c++', 'cpp'], label: 'C++', source: () => ({ template: 'proj-cpp-wordstats' }) },
  { terms: ['solidity', 'smart contract', 'erc20', 'erc-20', 'nft', 'token contract'], label: 'Solidity', source: () => ({ template: 'lang-solidity' }) },
];

const STYLES: { terms: string[]; styling: Styling; library?: string }[] = [
  { terms: ['shadcn'], styling: 'tailwind', library: 'shadcn' },
  { terms: ['daisyui', 'daisy'], styling: 'tailwind', library: 'daisyui' },
  { terms: ['tailwind', 'tailwindcss'], styling: 'tailwind' },
  { terms: ['bootstrap'], styling: 'bootstrap' },
  { terms: ['bulma'], styling: 'bulma' },
  { terms: ['pico'], styling: 'pico' },
  { terms: ['sass', 'scss'], styling: 'sass' },
  { terms: ['unocss'], styling: 'unocss' },
  { terms: ['css modules'], styling: 'css-modules' },
  { terms: ['mantine'], styling: 'css', library: 'mantine' },
];

/** Libraries named outright ("with tanstack query and zod") */
const NAMED_LIBS: [string[], string][] = [
  [['tanstack query', 'react query', 'react-query'], 'tanstack-query'],
  [['tanstack router'], 'tanstack-router'],
  [['tanstack table'], 'tanstack-table'],
  [['tanstack form'], 'tanstack-form'],
  [['react router'], 'react-router'],
  [['zustand'], 'zustand'],
  [['jotai'], 'jotai'],
  [['redux'], 'redux'],
  [['pinia'], 'pinia'],
  [['zod'], 'zod'],
  [['react hook form'], 'react-hook-form'],
  [['swr'], 'swr'],
  [['axios'], 'axios'],
  [['drizzle', 'sqlite'], 'drizzle'],
  [['hono'], 'hono'],
  [['recharts'], 'recharts'],
  [['framer motion', 'motion'], 'motion'],
  [['i18n', 'i18next', 'translations', 'multilingual'], 'i18n'],
  [['playwright', 'e2e', 'end to end'], 'playwright'],
  [['biome'], 'biome'],
  [['prettier'], 'prettier'],
  [['pandas'], 'pandas'],
  [['polars'], 'polars'],
  [['numpy'], 'numpy'],
  [['matplotlib'], 'matplotlib'],
  [['sqlmodel', 'sqlalchemy'], 'sqlmodel'],
  [['rich'], 'rich'],
];

/** A project name from the first meaningful words: "a habit tracker for my team" → "habit-tracker" */
export function nameFrom(description: string): string {
  const STOP = new Set(['a', 'an', 'the', 'build', 'make', 'create', 'me', 'my', 'i', 'want', 'need', 'simple', 'small', 'app', 'application', 'website', 'site', 'web', 'that', 'which', 'with', 'for', 'to', 'of', 'and', 'in', 'on', 'using', 'please', 'new', 'some', 'nice', 'beautiful', 'modern']);
  const picked = description
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w) && !NAMED.some((n) => n.terms.includes(w)))
    .slice(0, 3);
  return picked.join('-').slice(0, 40) || 'my-app';
}

/** The gallery app a description is closest to, by the words they share */
function similarApp(text: string): GalleryApp | undefined {
  const KEYS: Record<string, string[]> = {
    todo: ['todo', 'to-do', 'task list', 'tasks'],
    kanban: ['kanban', 'trello', 'board'],
    notes: ['note', 'notes', 'markdown', 'journal', 'diary'],
    habits: ['habit', 'streak'],
    dashboard: ['dashboard', 'admin', 'analytics', 'kpi', 'metrics'],
    expenses: ['expense', 'budget', 'spending', 'finance'],
    invoices: ['invoice', 'billing', 'quote'],
    landing: ['landing', 'marketing', 'homepage', 'launch'],
    blog: ['blog', 'posts', 'articles'],
    portfolio: ['portfolio', 'resume', 'cv', 'personal site'],
    'ai-chat': ['chatbot', 'chat with', 'ai chat', 'assistant', 'llm', 'gpt', 'claude'],
    'data-report': ['csv', 'report', 'spreadsheet', 'excel'],
    'rest-api': ['rest', 'crud', 'api'],
    shortener: ['shortener', 'short link', 'short url'],
    realtime: ['chat room', 'realtime', 'real-time', 'live chat', 'websocket'],
    cli: ['cli', 'command line', 'command-line', 'terminal tool'],
    scraper: ['scrape', 'scraper', 'crawler', 'crawl'],
    weather: ['weather', 'forecast'],
    pomodoro: ['pomodoro', 'timer', 'focus'],
    quiz: ['quiz', 'trivia', 'flashcard'],
    snake: ['snake', 'arcade', 'canvas game', 'game'],
    recipes: ['recipe', 'cooking', 'meal'],
    token: ['token', 'smart contract', 'erc20', 'erc-20'],
  };
  let best: { app: GalleryApp; score: number } | undefined;
  for (const app of GALLERY) {
    const score = (KEYS[app.id] ?? []).filter((k) => any(text, k)).length;
    if (score && (!best || score > best.score)) best = { app, score };
  }
  return best?.app;
}

export function planApp(description: string): AppPlan {
  const text = words(description);
  const reasons: string[] = [];
  const similar = similarApp(text);
  const name = nameFrom(description);

  // What kind of thing it is
  const isScript = any(text, 'script', 'scraper', 'scrape', 'crawler', 'bot', 'automation', 'automate');
  const isCli = isScript || any(text, 'cli', 'command line', 'command-line', 'terminal tool');
  const isContent = any(text, 'landing', 'marketing', 'blog', 'portfolio', 'docs site', 'documentation site', 'homepage', 'brochure');
  const isData = any(text, 'csv', 'excel', 'spreadsheet', 'data analysis', 'analyse', 'analyze', 'pandas', 'machine learning', 'ml', 'model training', 'statistics');
  const isAi = any(text, 'ai', 'llm', 'gpt', 'claude', 'chatbot', 'openai', 'anthropic', 'agent', 'rag', 'embedding');
  const needsDb = any(text, 'database', 'db', 'save', 'saves', 'saved', 'persist', 'store', 'stores', 'sql', 'sqlite', 'postgres', 'records', 'crud', 'users', 'accounts');
  const apiOnly = any(text, 'api', 'rest', 'backend', 'endpoint', 'microservice', 'service') && !any(text, 'page', 'ui', 'frontend', 'website', 'app with', 'screen', 'dashboard', 'form');
  const kind: 'app' | 'cli' | 'api' = isCli ? 'cli' : apiOnly ? 'api' : 'app';

  // A language or framework named outright wins
  const named = NAMED.find((n) => n.terms.some((t) => any(text, t)));
  const style = STYLES.find((s) => s.terms.some((t) => any(text, t)));
  const namedLibs = NAMED_LIBS.filter(([terms]) => terms.some((t) => any(text, t))).map(([, id]) => id);

  const brief = (stackLabel: string) =>
    `Build this: ${description.trim()}\n\nThe project is a ${stackLabel} starter. Replace its demo content with the real app, keep the project's structure and scripts, make the main logic testable and add tests for it, and check that it builds and runs before you finish.`;

  const fromTemplate = (source: GallerySource, label: string): AppPlan => ({ name, source, label, reasons, similar, brief: brief(label) });

  if (named && !named.framework && !named.py) {
    const source = named.source(kind);
    if (source) {
      reasons.push(`You asked for ${named.label}, so the starter is ${'template' in source && source.template.startsWith('app-') ? `the ${named.label} full app (a page and an API in one server)` : `the ${named.label} project`}.`);
      return fromTemplate(source, named.label);
    }
  }

  // Python: named, or the best fit for data, AI and scripts
  const pythonFit = named?.py || (!named && (isData || (isAi && !any(text, 'react', 'vue', 'svelte')) || (isScript && !any(text, 'typescript', 'binary', 'native'))));
  if (pythonFit) {
    let pyFramework: PyFramework = 'fastapi';
    if (any(text, 'flask')) pyFramework = 'flask';
    else if (isCli || (isData && !any(text, 'api', 'web', 'page', 'dashboard'))) pyFramework = any(text, 'command', 'cli', 'terminal', 'tool') ? 'typer' : 'script';
    const libraries = ['pydantic', 'pytest', 'ruff'];
    if (needsDb) libraries.push('sqlmodel');
    if (isData) libraries.push(any(text, 'polars', 'large', 'fast', 'big data') ? 'polars' : 'pandas');
    if (any(text, 'chart', 'charts', 'plot', 'graph', 'visualise', 'visualize')) libraries.push('matplotlib');
    if (isAi) libraries.push(any(text, 'openai', 'gpt') ? 'openai' : 'anthropic', 'dotenv');
    if (any(text, 'fetch', 'scrape', 'scraper', 'crawl', 'http', 'download', 'api calls', 'webhook')) libraries.push('httpx');
    if (pyFramework !== 'fastapi' && pyFramework !== 'flask') libraries.push('rich');
    if (any(text, 'config', 'settings', 'environment')) libraries.push('pydantic-settings');
    for (const id of namedLibs) if (getLibrary(id)?.kind === 'python') libraries.push(id);
    reasons.push(
      named?.py
        ? `You asked for ${named.label}.`
        : isData
          ? 'Python, because its data libraries (pandas, Polars, Matplotlib) are the best there is.'
          : isAi
            ? 'Python, because the AI SDKs are first-class there, and your API key stays on the server.'
            : 'Python, because scripts and automation are quickest to write and change in it.',
    );
    reasons.push(
      {
        fastapi: 'FastAPI serves the page and a validated JSON API, with interactive docs at /docs.',
        flask: 'Flask: a minimal web framework where you choose every piece.',
        typer: 'Typer turns functions into a command with --help for free.',
        script: 'A plain script: nothing between you and the code.',
      }[pyFramework],
    );
    if (libraries.includes('sqlmodel')) reasons.push('SQLModel stores the data in SQLite (one file, no setup), typed like Pydantic.');
    if (libraries.includes('anthropic')) reasons.push('The Anthropic SDK calls Claude; put ANTHROPIC_API_KEY in .env.');
    reasons.push('pytest and Ruff are set up, so tests and linting work from the start; uv installs everything.');
    const stack: StackChoice = { ...DEFAULT_STACK, kind: 'python', name, pyFramework, libraries: [...new Set(libraries)] };
    return { name, source: { stack }, label: `Python · ${{ fastapi: 'FastAPI', flask: 'Flask', typer: 'Typer', script: 'script' }[pyFramework]}`, reasons, similar, brief: brief(`Python (${pyFramework})`) };
  }

  // A command-line tool in TypeScript: scriptc builds it to one native binary
  if (isCli && !named?.framework) {
    reasons.push('A TypeScript CLI that scriptc compiles to a single native binary: nothing to install for the people who run it.');
    return fromTemplate({ template: 'modular-cli' }, 'TypeScript CLI (native binary)');
  }

  // Content sites: Astro, unless a framework was named
  if (isContent && !named) {
    reasons.push('Astro, because content sites should ship no JavaScript: pages load instantly and rank well.');
    return fromTemplate({ template: 'web-astro' }, 'Astro');
  }

  // An API with no page: FastAPI is the most productive default
  if (kind === 'api' && !named) {
    reasons.push('FastAPI: request validation and interactive docs out of the box; SQLModel for the database.');
    const stack: StackChoice = { ...DEFAULT_STACK, kind: 'python', name, pyFramework: 'fastapi', libraries: ['pydantic', 'sqlmodel', 'httpx', 'pytest', 'ruff'] };
    return { name, source: { stack }, label: 'Python · FastAPI', reasons, similar, brief: brief('Python FastAPI') };
  }

  // An interactive web app
  const framework: Framework = named?.framework ?? 'react';
  const styling: Styling = style?.styling ?? 'tailwind';
  const libraries: string[] = [];
  reasons.push(named?.framework ? `You asked for ${named.label}.` : 'React, because every library and UI kit supports it and it scales from a widget to a product.');
  if (style) reasons.push(`You asked for ${style.library ? getLibrary(style.library)!.name : style.styling}.`);
  else reasons.push('Tailwind CSS for fast, consistent styling.');
  if (style?.library) libraries.push(style.library);
  else if (framework === 'react' && styling === 'tailwind') {
    libraries.push('shadcn', 'lucide');
    reasons.push('shadcn/ui for accessible, good-looking components you own.');
  } else if (styling === 'tailwind' && !any(text, 'minimal')) {
    libraries.push('daisyui');
    reasons.push('daisyUI for ready-made components on Tailwind.');
  }
  const api = needsDb || any(text, 'api', 'backend', 'server', 'login', 'auth', 'accounts');
  if (api) {
    libraries.push('hono');
    reasons.push('A Hono API under /api, run by the same dev server as the page: one project, one Run.');
  }
  if (needsDb) {
    libraries.push('drizzle');
    reasons.push('Drizzle with SQLite for the data: typed queries, a single file, no database server.');
  }
  if (framework === 'react' || framework === 'vue' || framework === 'solid') {
    if (api || any(text, 'fetch', 'load', 'external api', 'weather', 'feed', 'search')) {
      libraries.push('tanstack-query');
      reasons.push('TanStack Query for loading data: caching, retries and loading states handled.');
    }
  }
  if (framework === 'react') {
    if (any(text, 'form', 'forms', 'signup', 'sign up', 'register', 'survey', 'checkout', 'booking', 'contact')) {
      libraries.push('react-hook-form', 'zod');
      reasons.push('React Hook Form with Zod for forms that validate as you type.');
    }
    if (any(text, 'dashboard', 'chart', 'charts', 'graph', 'analytics', 'stats', 'metrics', 'report')) {
      libraries.push('recharts');
      reasons.push('Recharts for the charts.');
    }
    if (any(text, 'table', 'tables', 'list of', 'admin', 'orders', 'inventory', 'crm', 'records')) {
      libraries.push('tanstack-table');
      reasons.push('TanStack Table for sortable, filterable tables.');
    }
    if (any(text, 'pages', 'page', 'routes', 'settings', 'profile', 'multi-page', 'navigation')) {
      libraries.push('tanstack-router');
      reasons.push('TanStack Router for pages, with links checked by TypeScript.');
    }
    if (any(text, 'cart', 'state', 'board', 'kanban', 'editor', 'game', 'drag')) {
      libraries.push('zustand');
      reasons.push('Zustand for app-wide state without boilerplate.');
    }
    if (any(text, 'animation', 'animated', 'animate', 'smooth', 'delightful', 'transitions')) libraries.push('motion');
    if (any(text, 'notification', 'notifications', 'toast', 'toasts', 'alerts')) libraries.push('sonner');
  }
  if (framework === 'vue') {
    libraries.push('pinia', 'vueuse');
    reasons.push('Pinia for shared state and VueUse for everyday composables.');
    if (any(text, 'pages', 'page', 'routes', 'settings', 'navigation')) libraries.push('vue-router');
  }
  if (any(text, 'date', 'dates', 'calendar', 'schedule', 'booking', 'habit', 'deadline', 'due', 'reminder', 'events')) {
    libraries.push('date-fns');
    reasons.push('date-fns for the dates.');
  }
  if (!libraries.includes('zod') && (api || any(text, 'validate', 'validation', 'json'))) libraries.push('zod');
  for (const id of namedLibs) if (getLibrary(id)?.kind === 'web') libraries.push(id);
  libraries.push('vitest', 'eslint');
  reasons.push('Vitest and ESLint, so tests and linting work from the first minute.');
  const stack: StackChoice = { ...DEFAULT_STACK, kind: 'web', name, framework, styling, libraries: [...new Set(libraries)] };
  const label = [named?.label ?? 'React', style ? (style.library ? getLibrary(style.library)!.name : style.styling) : 'Tailwind CSS'].join(' · ');
  return { name, source: { stack }, label, reasons, similar, brief: brief(label) };
}

/** Example descriptions for the Describe box */
export const PLAN_EXAMPLES = [
  'An expense tracker that saves to a database, with charts by category',
  'A landing page for my coffee shop with a menu and opening hours',
  'A CLI that renames photos by the date they were taken',
  'Analyse a CSV of sales and chart revenue per month',
  'A Kanban board with drag and drop',
  'A chatbot that answers questions about my docs with Claude',
  'A URL shortener in Go',
  'A habit tracker in Svelte with streaks',
];
