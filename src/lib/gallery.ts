/**
 * The app gallery: things people build, each with the stack that suits it
 * and why — a landing page on Astro because it ships no JavaScript, a data
 * report in Python because pandas is there, a dashboard on React with
 * TanStack Table and Recharts. Picking one creates the starter (a template or
 * a stack from the builder) and hands the agent a brief to build the rest.
 * Apps that are good in many languages offer them all.
 */

import { DEFAULT_STACK, type StackChoice } from './stack/catalog.ts';

export type GalleryCategory = 'Productivity' | 'Business' | 'Content' | 'Data and AI' | 'APIs and services' | 'Fun' | 'Tools';

export type GallerySource = { template: string } | { stack: StackChoice };

export interface GalleryApp {
  id: string;
  name: string;
  /** One line: what it is */
  pitch: string;
  category: GalleryCategory;
  /** Why this stack fits this app */
  why: string;
  source: GallerySource;
  /** The same app in other languages or stacks */
  variants?: { label: string; source: GallerySource }[];
  /** What the agent is asked to build on top of the starter */
  brief: string;
  /** Card artwork: two colours and a glyph */
  art: { from: string; to: string; glyph: string };
}

const web = (name: string, framework: StackChoice['framework'], styling: StackChoice['styling'], libraries: string[]): GallerySource => ({ stack: { ...DEFAULT_STACK, kind: 'web', name, framework, styling, libraries } });
const py = (name: string, pyFramework: StackChoice['pyFramework'], libraries: string[]): GallerySource => ({ stack: { ...DEFAULT_STACK, kind: 'python', name, pyFramework, libraries } });

const TODO_LANGS: [string, string][] = [
  ['Python · FastAPI', 'app-fastapi'],
  ['Python · Flask', 'app-flask'],
  ['Go', 'app-go'],
  ['Rust · axum', 'app-rust'],
  ['Node.js · Express', 'app-express'],
  ['Bun', 'app-bun'],
  ['Deno', 'app-deno'],
  ['Ruby · Sinatra', 'app-sinatra'],
  ['PHP', 'app-php'],
  ['Java', 'app-java'],
  ['C# · ASP.NET Core', 'app-aspnet'],
  ['Elixir · Plug', 'app-elixir'],
];

export const GALLERY: GalleryApp[] = [
  {
    id: 'todo',
    name: 'Todo app',
    pitch: 'Add, complete and delete tasks: a page and a JSON API, in the language you want.',
    category: 'Productivity',
    why: 'The classic full app, ready in 12 languages: each one serves the page and the API itself, so you can compare them or start in the one your team uses.',
    source: { template: 'app-fastapi' },
    variants: TODO_LANGS.map(([label, template]) => ({ label, source: { template } })),
    brief: 'Extend the todo app: add due dates, a filter for active/completed tasks, and keep the tasks when the server restarts (save them to a file or SQLite). Keep the API and the page in step and add tests for the API.',
    art: { from: '#22c55e', to: '#0ea5e9', glyph: '✓' },
  },
  {
    id: 'kanban',
    name: 'Kanban board',
    pitch: 'Columns of cards you drag between To do, Doing and Done.',
    category: 'Productivity',
    why: 'Lots of interactive state on one screen: React with Zustand keeps it simple, shadcn/ui gives polished cards and buttons, and the board is saved in the browser.',
    source: web('kanban', 'react', 'tailwind', ['shadcn', 'zustand', 'lucide', 'motion', 'vitest', 'eslint']),
    brief: 'Build a Kanban board on the home page: three columns (To do, Doing, Done), cards with a title and optional description, add and delete cards, move cards between columns by drag and drop (native HTML drag events) and with buttons for keyboard users. Keep the board in the Zustand store and persist it to localStorage. Replace the demo cards. Add tests for the store.',
    art: { from: '#6366f1', to: '#a855f7', glyph: '▤' },
  },
  {
    id: 'notes',
    name: 'Markdown notes',
    pitch: 'Write notes in Markdown with a live preview and search.',
    category: 'Productivity',
    why: 'Vue’s two-way binding makes an editor with live preview a few lines; Pinia holds the notes and VueUse saves them to localStorage.',
    source: web('notes', 'vue', 'tailwind', ['pinia', 'vueuse', 'vue-router', 'date-fns', 'vitest', 'eslint']),
    brief: 'Build a Markdown notes app: a list of notes with search on the left, an editor and a live preview on the right (write a small Markdown renderer for headings, bold, italics, lists, links and code, escaping HTML). Create, rename and delete notes; store them in the Pinia store persisted with VueUse useLocalStorage; show when each note was edited with date-fns. Add tests for the renderer.',
    art: { from: '#10b981', to: '#14b8a6', glyph: '✎' },
  },
  {
    id: 'habits',
    name: 'Habit tracker',
    pitch: 'Tick off habits each day and watch your streaks grow.',
    category: 'Productivity',
    why: 'Small and fast: Svelte compiles to tiny JavaScript, date-fns does the streak maths.',
    source: web('habits', 'svelte', 'tailwind', ['date-fns', 'zod', 'vitest', 'eslint']),
    brief: 'Build a habit tracker: add habits, tick each habit for today, show the last 14 days as a row of squares per habit and the current streak (date-fns for the dates). Save to localStorage, validating the stored data with Zod. Put the streak logic in its own module with tests.',
    art: { from: '#f59e0b', to: '#ef4444', glyph: '◉' },
  },
  {
    id: 'dashboard',
    name: 'Admin dashboard',
    pitch: 'KPIs, a chart and a sortable table of orders.',
    category: 'Business',
    why: 'Dashboards are tables and charts: TanStack Table sorts and filters, Recharts draws, TanStack Query loads from the Hono API, shadcn/ui makes it look finished.',
    source: web('dashboard', 'react', 'tailwind', ['shadcn', 'tanstack-query', 'tanstack-table', 'recharts', 'tanstack-router', 'hono', 'zod', 'date-fns', 'vitest', 'eslint']),
    brief: 'Build an admin dashboard: an API route /api/orders in server/index.ts returning 50 generated orders (customer, amount, status, date); on the home page show four KPI cards (revenue, orders, average order, refunds), a revenue-per-day line chart, and a sortable, filterable orders table with status badges. Load data with TanStack Query and validate it with Zod. Add tests for the KPI calculations.',
    art: { from: '#0ea5e9', to: '#6366f1', glyph: '▦' },
  },
  {
    id: 'expenses',
    name: 'Expense tracker',
    pitch: 'Log spending by category, with totals and a chart, saved in a database.',
    category: 'Business',
    why: 'Real data deserves a real database: Drizzle with SQLite behind a Hono API, forms validated by React Hook Form and Zod, Recharts for the breakdown.',
    source: web('expenses', 'react', 'tailwind', ['shadcn', 'tanstack-query', 'react-hook-form', 'zod', 'recharts', 'hono', 'drizzle', 'date-fns', 'sonner', 'vitest', 'eslint']),
    brief: 'Build an expense tracker: an expenses table in server/db.ts (amount, category, note, date) with GET/POST/DELETE routes; a form (React Hook Form + Zod) to add an expense; a list grouped by month; totals per category and a pie or bar chart; a toast when saved. Use TanStack Query mutations so the list refreshes. Replace the notes demo. Add tests for the totals.',
    art: { from: '#14b8a6', to: '#22c55e', glyph: '$' },
  },
  {
    id: 'invoices',
    name: 'Invoice generator',
    pitch: 'Fill in line items, see totals with tax, print a clean invoice.',
    category: 'Business',
    why: 'A form-heavy business tool: Mantine has every input you need, React Hook Form and Zod keep the numbers valid.',
    source: web('invoices', 'react', 'css', ['mantine', 'react-hook-form', 'zod', 'date-fns', 'vitest', 'eslint']),
    brief: 'Build an invoice generator: a form for the client, invoice number, date and due date, and line items (description, quantity, unit price) you can add and remove; tax rate; live subtotal, tax and total; a print-friendly invoice view (print CSS) with a Print button. Validate with Zod. Put the money maths in a module with tests (use integer cents).',
    art: { from: '#64748b', to: '#0ea5e9', glyph: '§' },
  },
  {
    id: 'landing',
    name: 'Landing page',
    pitch: 'A fast marketing page: hero, features, pricing and a sign-up.',
    category: 'Content',
    why: 'Astro ships zero JavaScript by default, so the page loads instantly and ranks well; perfect for content that doesn’t need an app.',
    source: { template: 'web-astro' },
    variants: [
      { label: 'Astro', source: { template: 'web-astro' } },
      { label: 'Next.js', source: { template: 'web-next' } },
      { label: 'Plain HTML · Tailwind', source: web('landing', 'vanilla', 'tailwind', []) },
    ],
    brief: 'Build a landing page for a product called "Nimbus" (a calm to-do app): a hero with headline, sub-headline and call to action; three feature blocks; a pricing section with Free and Pro plans; a FAQ; an email sign-up form; a footer. Make it responsive and accessible, with good contrast and real copy (no lorem ipsum).',
    art: { from: '#ec4899', to: '#f59e0b', glyph: '★' },
  },
  {
    id: 'blog',
    name: 'Blog',
    pitch: 'Posts written in Markdown, an index and an RSS-friendly layout.',
    category: 'Content',
    why: 'Static sites are the right tool for writing: Astro turns Markdown into pages with no server to run.',
    source: { template: 'web-astro' },
    variants: [
      { label: 'Astro', source: { template: 'web-astro' } },
      { label: 'Next.js', source: { template: 'web-next' } },
      { label: 'SvelteKit', source: { template: 'web-sveltekit' } },
      { label: 'Nuxt', source: { template: 'web-nuxt' } },
    ],
    brief: 'Turn this into a blog: three sample posts in Markdown with a title, date and description; a home page listing posts newest first; a page per post with readable typography; an About page. Keep it fast and accessible.',
    art: { from: '#8b5cf6', to: '#ec4899', glyph: '¶' },
  },
  {
    id: 'portfolio',
    name: 'Portfolio',
    pitch: 'A personal site with projects, an about section and contact links.',
    category: 'Content',
    why: 'Pico CSS styles plain HTML beautifully, so the whole site is semantic markup you can edit by hand.',
    source: web('portfolio', 'vanilla', 'pico', []),
    brief: 'Build a one-page portfolio: a hero with name and role, a projects grid (six projects with title, description, tags and links), an about section, skills, and contact links. Use semantic HTML, keep it responsive, and add a light/dark toggle.',
    art: { from: '#334155', to: '#64748b', glyph: '◐' },
  },
  {
    id: 'ai-chat',
    name: 'AI chat',
    pitch: 'A chat page that talks to Claude, streaming answers.',
    category: 'Data and AI',
    why: 'Python has the best AI SDKs; FastAPI serves the page and keeps your API key on the server, never in the browser.',
    source: py('ai-chat', 'fastapi', ['pydantic', 'anthropic', 'dotenv', 'pytest', 'ruff']),
    brief: 'Build an AI chat: a chat page (message list and input) served by FastAPI; POST /api/chat sends the conversation to Claude with the Anthropic SDK and streams the answer back (StreamingResponse), shown token by token. Read ANTHROPIC_API_KEY from .env; when it is missing, say so in the chat. Keep the history in the page. Add tests that mock the SDK.',
    art: { from: '#f97316', to: '#ec4899', glyph: '✦' },
  },
  {
    id: 'agent',
    name: 'Agent with tools',
    pitch: 'An LLM agent that calls your Python functions as tools.',
    category: 'Data and AI',
    why: 'The agent loop and tools are plain Python, run by uv with nothing else to install.',
    source: { template: 'py-llm-agent' },
    brief: 'Add two more tools to the agent (for example a unit converter and a file reader limited to this folder), describe them well, and add tests that run the tools directly.',
    art: { from: '#a855f7', to: '#6366f1', glyph: '⚙' },
  },
  {
    id: 'data-report',
    name: 'Data report',
    pitch: 'Load a CSV, summarise it, chart it and print a table in the terminal.',
    category: 'Data and AI',
    why: 'pandas reads and groups the data, Matplotlib charts it and Rich prints it; Typer makes it a command you can run on any file.',
    source: py('data-report', 'typer', ['pandas', 'matplotlib', 'rich', 'pydantic', 'pytest', 'ruff']),
    brief: 'Build a data report command: `report FILE.csv` loads the CSV with pandas, prints the row count, column types and a summary table with Rich, groups by a --by column if given, and saves a bar chart with Matplotlib. Include a sample sales.csv. Add tests using a small CSV.',
    art: { from: '#0284c7', to: '#22c55e', glyph: '▥' },
  },
  {
    id: 'rest-api',
    name: 'REST API with a database',
    pitch: 'CRUD endpoints with validation, a database and interactive docs.',
    category: 'APIs and services',
    why: 'FastAPI validates every request with Pydantic and writes the docs for you; SQLModel stores the data in SQLite with one model per table.',
    source: py('rest-api', 'fastapi', ['pydantic', 'pydantic-settings', 'sqlmodel', 'httpx', 'loguru', 'pytest', 'ruff', 'mypy']),
    variants: [
      { label: 'Python · FastAPI', source: py('rest-api', 'fastapi', ['pydantic', 'pydantic-settings', 'sqlmodel', 'httpx', 'loguru', 'pytest', 'ruff', 'mypy']) },
      { label: 'TypeScript · Hono + Drizzle', source: web('rest-api', 'vanilla', 'css', ['hono', 'drizzle', 'zod', 'vitest', 'eslint']) },
      { label: 'Go', source: { template: 'app-go' } },
      { label: 'Rust · axum', source: { template: 'app-rust' } },
      { label: 'C# · ASP.NET Core', source: { template: 'app-aspnet' } },
      { label: 'Java', source: { template: 'app-java' } },
    ],
    brief: 'Build a REST API for a book library: books (title, author, year, isbn, available) with list (paginated, searchable), get, create, update and delete endpoints; validation with clear 400 errors; 404 for missing books; data in the database. Add tests for every endpoint.',
    art: { from: '#0f766e', to: '#0ea5e9', glyph: '{}' },
  },
  {
    id: 'shortener',
    name: 'URL shortener',
    pitch: 'Turn long links into short codes and count the clicks.',
    category: 'APIs and services',
    why: 'A small, fast service is Go’s sweet spot: the standard library serves it, and it builds to one binary you can deploy anywhere.',
    source: { template: 'app-go' },
    variants: [
      { label: 'Go', source: { template: 'app-go' } },
      { label: 'Rust · axum', source: { template: 'app-rust' } },
      { label: 'Bun', source: { template: 'app-bun' } },
    ],
    brief: 'Turn this app into a URL shortener: POST /api/links with a URL returns a short code; GET /{code} redirects and counts the click; the page lets you shorten a link, copy the short URL and see click counts. Validate URLs, avoid code collisions, and keep the links when the server restarts. Add tests.',
    art: { from: '#06b6d4', to: '#3b82f6', glyph: '↗' },
  },
  {
    id: 'realtime',
    name: 'Live chat room',
    pitch: 'Messages appear for everyone instantly.',
    category: 'APIs and services',
    why: 'Elixir runs on the BEAM, built for many concurrent connections; Bun has fast built-in WebSockets if you prefer TypeScript.',
    source: { template: 'app-elixir' },
    variants: [
      { label: 'Elixir', source: { template: 'app-elixir' } },
      { label: 'Bun', source: { template: 'app-bun' } },
      { label: 'Node.js · Express', source: { template: 'app-express' } },
    ],
    brief: 'Turn this app into a live chat room: users pick a name, messages are sent to the server and pushed to every connected browser instantly (WebSockets or server-sent events), with the last 50 messages shown on join. Escape message text. Add tests for the message store.',
    art: { from: '#7c3aed', to: '#db2777', glyph: '❝' },
  },
  {
    id: 'cli',
    name: 'Command-line tool',
    pitch: 'A real CLI with arguments, help and tests that builds to one binary.',
    category: 'Tools',
    why: 'scriptc compiles TypeScript to a small native executable, so you write TypeScript and ship a binary with no runtime; Rust and Go do the same in their own languages.',
    source: { template: 'modular-cli' },
    variants: [
      { label: 'TypeScript · native binary', source: { template: 'modular-cli' } },
      { label: 'Rust', source: { template: 'proj-rust-wordstats' } },
      { label: 'Go', source: { template: 'proj-go-wordstats' } },
      { label: 'Python · Typer', source: py('cli', 'typer', ['rich', 'pytest', 'ruff']) },
      { label: 'Zig', source: { template: 'proj-zig-wordstats' } },
      { label: 'C#', source: { template: 'proj-csharp-wordstats' } },
    ],
    brief: 'Make this a tool that renames files in a folder by a pattern: --dry-run shows what would change, --pattern and --replace take a regular expression and replacement, and it refuses to overwrite existing files. Clear --help, helpful errors, and tests for the renaming logic.',
    art: { from: '#334155', to: '#22c55e', glyph: '>_' },
  },
  {
    id: 'scraper',
    name: 'Web scraper',
    pitch: 'Fetch pages, pull out the data and save it as CSV.',
    category: 'Tools',
    why: 'Python with HTTPX fetches politely and Rich shows progress; a script is all it takes.',
    source: py('scraper', 'script', ['httpx', 'rich', 'pydantic', 'pytest', 'ruff']),
    brief: 'Build a scraper for https://quotes.toscrape.com: fetch the first five pages with HTTPX (with a delay and a User-Agent), parse each quote, author and tags with the standard library HTML parser, validate rows with Pydantic, show progress with Rich and save quotes.csv. Add tests that parse a saved HTML sample.',
    art: { from: '#78716c', to: '#0ea5e9', glyph: '⌕' },
  },
  {
    id: 'weather',
    name: 'Weather widget',
    pitch: 'Current weather and a 5-day forecast for any city.',
    category: 'Fun',
    why: 'A widget should be light: Preact is React in 4 kB, Bulma styles it with no JavaScript, Axios talks to the free Open-Meteo API.',
    source: web('weather', 'preact', 'bulma', ['axios', 'zod', 'date-fns', 'vitest', 'eslint']),
    brief: 'Build a weather widget using the free Open-Meteo APIs (no key): search a city with the geocoding API, show the current temperature and conditions and a 5-day forecast with icons. Validate responses with Zod, format days with date-fns, remember the last city. Add tests for the weather-code-to-description mapping.',
    art: { from: '#38bdf8', to: '#f59e0b', glyph: '☀' },
  },
  {
    id: 'pomodoro',
    name: 'Pomodoro timer',
    pitch: 'Focus for 25 minutes, rest for 5, with sounds and a session log.',
    category: 'Fun',
    why: 'Timers update every second: Solid’s fine-grained signals redraw only the digits, UnoCSS keeps the styling tiny.',
    source: web('pomodoro', 'solid', 'unocss', ['date-fns', 'vitest']),
    brief: 'Build a Pomodoro timer: 25-minute focus and 5-minute break sessions (configurable), start/pause/reset, a big countdown, a short beep with the Web Audio API when a session ends, and today’s completed sessions. Put the timer state machine in a module with tests.',
    art: { from: '#ef4444', to: '#f97316', glyph: '◷' },
  },
  {
    id: 'quiz',
    name: 'Quiz game',
    pitch: 'Multiple-choice questions, a timer and a high score.',
    category: 'Fun',
    why: 'Svelte’s transitions and tiny bundles make playful UI easy.',
    source: web('quiz', 'svelte', 'tailwind', ['daisyui', 'zod', 'vitest', 'eslint']),
    brief: 'Build a quiz game: 10 multiple-choice questions loaded from a JSON file (validated with Zod), 15 seconds per question, instant feedback, a score screen and a high score saved in localStorage. Shuffle questions and answers. Add tests for scoring and shuffling.',
    art: { from: '#22c55e', to: '#eab308', glyph: '?' },
  },
  {
    id: 'snake',
    name: 'Snake',
    pitch: 'The classic game on a canvas, with keyboard and touch controls.',
    category: 'Fun',
    why: 'Games draw on a canvas every frame, so no framework is needed: plain TypeScript is fastest and simplest.',
    source: web('snake', 'vanilla', 'css', ['vitest']),
    brief: 'Build Snake on a <canvas>: arrow keys and swipe controls, food that grows the snake, speed that increases, walls and self-collision end the game, score and high score (localStorage), pause with Space. Keep the game logic (movement, collisions) in a pure module with tests, separate from drawing.',
    art: { from: '#16a34a', to: '#4d7c0f', glyph: '∿' },
  },
  {
    id: 'recipes',
    name: 'Recipe book',
    pitch: 'Browse recipes, scale servings and build a shopping list.',
    category: 'Productivity',
    why: 'A classic multi-page app: Vue Router for pages, Pinia for the shopping list, Bootstrap for a familiar look.',
    source: web('recipes', 'vue', 'bootstrap', ['vue-router', 'pinia', 'vueuse', 'zod', 'vitest', 'eslint']),
    brief: 'Build a recipe book: a list of six recipes with search and tag filters, a recipe page with ingredients scaled by a servings control and the steps, and a shopping list that combines ingredients from chosen recipes (Pinia, saved to localStorage). Add tests for scaling and combining quantities.',
    art: { from: '#ea580c', to: '#facc15', glyph: '♨' },
  },
  {
    id: 'token',
    name: 'Token smart contract',
    pitch: 'An ERC-20 token with tests and fuzzing.',
    category: 'Tools',
    why: 'Foundry is the fastest Solidity toolchain: tests in Solidity, fuzzing built in.',
    source: { template: 'lang-solidity' },
    brief: 'Turn this into an ERC-20 token with a capped supply, an owner who can mint up to the cap, and burn. Write tests for transfers, allowances, the cap and access control, plus a fuzz test that the total supply never exceeds the cap.',
    art: { from: '#6366f1', to: '#0ea5e9', glyph: '◆' },
  },
];

export const GALLERY_CATEGORIES: GalleryCategory[] = ['Productivity', 'Business', 'Content', 'Data and AI', 'APIs and services', 'Tools', 'Fun'];
