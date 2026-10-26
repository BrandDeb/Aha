/**
 * Turns a web stack choice into a project: Vite with the chosen framework and
 * styling, and every chosen library installed *and wired in* — each one has a
 * small working demo on the home page (a query that fetches, a form that
 * validates, a store that counts), so you start from code that uses it rather
 * than an empty package.json. Styling is applied through one `ui` class map
 * (src/ui.ts), so the same components look right in Tailwind, Bootstrap,
 * Bulma, Pico, CSS Modules or plain CSS. Pure; npm run verify:stacks installs,
 * typechecks, tests and builds a matrix of these for real.
 */

import { FRAMEWORKS, getLibrary, STYLINGS, type StackChoice } from './catalog.ts';
import { TS, VITE } from '../web-templates.ts';

type Files = Record<string, string>;
type Ui = Record<'page' | 'hero' | 'title' | 'lead' | 'grid' | 'card' | 'cardTitle' | 'button' | 'input' | 'muted' | 'error' | 'nav' | 'list' | 'row' | 'code', string>;

const KEYS: (keyof Ui)[] = ['page', 'hero', 'title', 'lead', 'grid', 'card', 'cardTitle', 'button', 'input', 'muted', 'error', 'nav', 'list', 'row', 'code'];

const TW: Ui = {
  page: 'mx-auto max-w-5xl px-6 py-14',
  hero: 'mb-10 space-y-4',
  title: 'text-4xl font-bold tracking-tight',
  lead: 'text-lg text-slate-400',
  grid: 'grid gap-4 sm:grid-cols-2',
  card: 'space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-5',
  cardTitle: 'font-semibold',
  button: 'inline-flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50',
  input: 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm',
  muted: 'text-sm text-slate-400',
  error: 'text-sm text-rose-400',
  nav: 'flex gap-4 border-b border-slate-800 px-6 py-3 text-sm',
  list: 'space-y-1 text-sm',
  row: 'flex flex-wrap items-center gap-2',
  code: 'rounded bg-slate-800 px-1.5 py-0.5 text-sm',
};

const SHADCN: Ui = {
  ...TW,
  lead: 'text-lg text-muted-foreground',
  card: 'space-y-3 rounded-xl border bg-card p-5 text-card-foreground shadow-sm',
  button: 'inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50',
  input: 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm',
  muted: 'text-sm text-muted-foreground',
  error: 'text-sm text-destructive',
  nav: 'flex gap-4 border-b px-6 py-3 text-sm',
  code: 'rounded bg-muted px-1.5 py-0.5 text-sm',
};

const DAISY: Ui = {
  ...TW,
  lead: 'text-lg opacity-80',
  card: 'card card-body gap-3 bg-base-200',
  cardTitle: 'card-title text-base',
  button: 'btn btn-primary btn-sm',
  input: 'input input-bordered w-full',
  muted: 'text-sm opacity-70',
  error: 'text-sm text-error',
  nav: 'navbar gap-4 bg-base-200 px-6',
  code: 'kbd kbd-sm',
};

/** Semantic class names, defined by the generated stylesheet (plain CSS, Sass, CSS Modules) */
const SEMANTIC = Object.fromEntries(KEYS.map((k) => [k, k])) as Ui;

const BOOTSTRAP: Ui = {
  page: 'container py-5',
  hero: 'mb-5',
  title: 'display-5 fw-bold',
  lead: 'lead text-body-secondary',
  grid: 'ui-grid',
  card: 'card card-body gap-2',
  cardTitle: 'h5 mb-0',
  button: 'btn btn-primary',
  input: 'form-control',
  muted: 'small text-body-secondary mb-0',
  error: 'small text-danger mb-0',
  nav: 'nav gap-3 border-bottom px-4 py-2',
  list: 'list-unstyled small mb-0',
  row: 'd-flex flex-wrap align-items-center gap-2',
  code: '',
};

const BULMA: Ui = {
  page: 'container section',
  hero: 'block mb-6',
  title: 'title is-2',
  lead: 'subtitle',
  grid: 'ui-grid',
  card: 'box mb-0',
  cardTitle: 'title is-5 mb-3',
  button: 'button is-primary',
  input: 'input',
  muted: 'is-size-7 has-text-grey',
  error: 'help is-danger',
  nav: 'tabs px-4',
  list: 'is-size-7',
  row: 'buttons',
  code: '',
};

const PICO: Ui = { page: 'container', hero: '', title: '', lead: '', grid: 'ui-grid', card: 'ui-card', cardTitle: '', button: '', input: '', muted: 'ui-muted', error: 'ui-error', nav: 'container', list: '', row: 'ui-row', code: '' };

const has = (c: StackChoice, id: string) => c.libraries.includes(id);
const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
const sortObj = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

function uiFor(c: StackChoice): Ui {
  if (has(c, 'shadcn')) return SHADCN;
  if (has(c, 'daisyui')) return DAISY;
  switch (c.styling) {
    case 'tailwind':
    case 'unocss':
      return TW;
    case 'bootstrap':
      return BOOTSTRAP;
    case 'bulma':
      return BULMA;
    case 'pico':
      return PICO;
    default:
      return SEMANTIC;
  }
}

/** The semantic stylesheet for plain CSS, Sass and CSS Modules */
const SEMANTIC_CSS = `.page { max-width: 64rem; margin: 0 auto; padding: 3.5rem 1.5rem; }
.hero { margin-bottom: 2.5rem; display: grid; gap: 1rem; }
.title { font-size: 2.5rem; line-height: 1.1; letter-spacing: -0.02em; margin: 0; }
.lead { font-size: 1.125rem; color: var(--muted); margin: 0; }
.grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr)); }
.card { display: grid; gap: 0.75rem; align-content: start; padding: 1.25rem; border: 1px solid var(--line); border-radius: 0.875rem; background: var(--surface); }
.cardTitle { font-size: 1rem; margin: 0; }
.button { display: inline-flex; align-items: center; gap: 0.5rem; justify-self: start; padding: 0.55rem 1rem; border: 0; border-radius: 0.6rem; background: var(--accent); color: white; font: inherit; font-weight: 600; cursor: pointer; }
.button:hover { filter: brightness(1.1); }
.button:disabled { opacity: 0.5; cursor: default; }
.input { width: 100%; box-sizing: border-box; padding: 0.55rem 0.75rem; border: 1px solid var(--line); border-radius: 0.6rem; background: var(--bg); color: inherit; font: inherit; }
.muted { color: var(--muted); font-size: 0.875rem; margin: 0; }
.error { color: #fb7185; font-size: 0.875rem; margin: 0; }
.nav { display: flex; gap: 1rem; padding: 0.75rem 1.5rem; border-bottom: 1px solid var(--line); }
.nav a { color: inherit; }
.list { margin: 0; padding-left: 1.1rem; font-size: 0.875rem; }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.code { padding: 0.1rem 0.4rem; border-radius: 0.35rem; background: var(--surface); font-size: 0.9em; }
`;

const ROOT_CSS = `:root {
  color-scheme: dark;
  --bg: #0b0d12;
  --surface: #131722;
  --line: #262c3a;
  --muted: #9aa3b2;
  --accent: #6366f1;
  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  background: var(--bg);
  color: #e8eaf0;
}
body { margin: 0; min-height: 100vh; }
`;

const GRID_CSS = `.ui-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr)); }
`;

const SHADCN_CSS = `@import 'tailwindcss';
@import 'tw-animate-css';

@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
}

@theme inline {
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply min-h-screen bg-background text-foreground;
  }
}
`;

const SHADCN_FILES: Files = {
  'components.json': json({
    $schema: 'https://ui.shadcn.com/schema.json',
    style: 'new-york',
    rsc: false,
    tsx: true,
    tailwind: { config: '', css: 'src/styles.css', baseColor: 'neutral', cssVariables: true, prefix: '' },
    aliases: { components: '@/components', utils: '@/lib/utils', ui: '@/components/ui', lib: '@/lib', hooks: '@/hooks' },
    iconLibrary: 'lucide',
  }),
  'src/lib/utils.ts': `import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`,
  'src/components/ui/button.tsx': `import * as React from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        destructive: 'bg-destructive text-white shadow-xs hover:bg-destructive/90',
        outline: 'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
        secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

function Button({ className, variant, size, asChild = false, ...props }: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

// eslint-disable-next-line react-refresh/only-export-components
export { Button, buttonVariants };
`,
  'src/components/ui/card.tsx': `import * as React from 'react';
import { cn } from '@/lib/utils';

function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card" className={cn('flex flex-col gap-4 rounded-xl border bg-card py-5 text-card-foreground shadow-sm', className)} {...props} />;
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-header" className={cn('grid gap-1.5 px-5', className)} {...props} />;
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-title" className={cn('leading-none font-semibold', className)} {...props} />;
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-description" className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('px-5', className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent };
`,
};

const fwName = (c: StackChoice) => FRAMEWORKS.find((f) => f.id === c.framework)!.name;
const stylingName = (c: StackChoice) => STYLINGS.find((s) => s.id === c.styling)!.name;

/** Human summary of the stack: "React · Tailwind CSS · shadcn/ui · TanStack Query" */
export function stackSummary(c: StackChoice): string {
  return [fwName(c), stylingName(c), ...c.libraries.map((id) => getLibrary(id)!.name)].join(' · ');
}

/** Everything npm installs for the choice, split like package.json */
export function webDependencies(c: StackChoice): { dependencies: Record<string, string>; devDependencies: Record<string, string> } {
  const fw = FRAMEWORKS.find((f) => f.id === c.framework)!;
  const st = STYLINGS.find((s) => s.id === c.styling)!;
  const deps: Record<string, string> = { ...fw.deps, ...st.deps };
  const dev: Record<string, string> = { typescript: TS, vite: VITE, ...fw.dev, ...st.dev };
  for (const id of c.libraries) {
    const lib = getLibrary(id)!;
    Object.assign(deps, lib.deps);
    Object.assign(dev, lib.dev);
  }
  // Framework adapters and pairings
  if (has(c, 'tanstack-query')) deps[{ react: '@tanstack/react-query', vue: '@tanstack/vue-query', solid: '@tanstack/solid-query' }[c.framework as 'react' | 'vue' | 'solid']] = '^5.104.5';
  if (has(c, 'tanstack-table')) deps[c.framework === 'vue' ? '@tanstack/vue-table' : '@tanstack/react-table'] = '^9.3.1';
  if (has(c, 'react-hook-form') && has(c, 'zod')) deps['@hookform/resolvers'] = '^5.2.2';
  if (has(c, 'vitest')) {
    if (c.framework === 'react') Object.assign(dev, { '@testing-library/react': '^16.3.3', '@testing-library/dom': '^10.4.2' });
    if (c.framework === 'vue') Object.assign(dev, { '@testing-library/vue': '^8.1.0' });
  }
  if (has(c, 'eslint') && (c.framework === 'react' || c.framework === 'preact')) Object.assign(dev, { 'eslint-plugin-react-hooks': '^7.1.1', 'eslint-plugin-react-refresh': '^0.5.7' });
  if (has(c, 'hono') || has(c, 'shadcn')) dev['@types/node'] = '^24';
  return { dependencies: sortObj(deps), devDependencies: sortObj(dev) };
}

/** What `npm install` would be typed as, for the summary: "npm install react … && npm install -D vite …" */
export function installCommands(c: StackChoice): string[] {
  const { dependencies, devDependencies } = webDependencies(c);
  const out: string[] = [];
  if (Object.keys(dependencies).length) out.push(`npm install ${Object.keys(dependencies).join(' ')}`);
  out.push(`npm install -D ${Object.keys(devDependencies).join(' ')}`);
  return out;
}

// ─── Shared pieces ──────────────────────────────────────────────────────────

function uiModule(c: StackChoice): Files {
  const ui = uiFor(c);
  if (c.styling === 'css-modules' && !has(c, 'shadcn') && !has(c, 'daisyui')) {
    return {
      'src/ui.ts': `import styles from './ui.module.css';

/** Class names for the app's building blocks: scoped by CSS Modules, defined in ui.module.css */
export const ui = {
${KEYS.map((k) => `  ${k}: styles.${k},`).join('\n')}
};
`,
      'src/ui.module.css': SEMANTIC_CSS,
    };
  }
  return {
    'src/ui.ts': `/** Class names for the app's building blocks, in one place: restyle the whole app from here */
export const ui = {
${KEYS.map((k) => `  ${k}: ${JSON.stringify(ui[k])},`).join('\n')}
};
`,
  };
}

/** Stylesheets, and the imports the entry file needs for them (in order) */
function styles(c: StackChoice): { files: Files; imports: string[] } {
  const files: Files = {};
  const imports: string[] = [];
  if (has(c, 'mantine')) imports.push('@mantine/core/styles.css');
  switch (c.styling) {
    case 'tailwind':
      files['src/styles.css'] = has(c, 'shadcn') ? SHADCN_CSS : `@import 'tailwindcss';${has(c, 'daisyui') ? `\n@plugin 'daisyui';` : ''}\n\nbody {\n  @apply min-h-screen ${has(c, 'daisyui') ? '' : 'bg-slate-950 text-slate-100 '}antialiased;\n}\n`;
      imports.push('./styles.css');
      break;
    case 'unocss':
      files['uno.config.ts'] = `import { defineConfig, presetWind3 } from 'unocss';\n\nexport default defineConfig({\n  presets: [presetWind3()],\n});\n`;
      files['src/styles.css'] = `body {\n  margin: 0;\n  min-height: 100vh;\n  background: #020617;\n  color: #f1f5f9;\n  font-family: ui-sans-serif, system-ui, sans-serif;\n}\n`;
      imports.push('virtual:uno.css', './styles.css');
      break;
    case 'sass':
      files['src/styles/_tokens.scss'] = `$bg: #0b0d12;\n$surface: #131722;\n$line: #262c3a;\n$muted: #9aa3b2;\n$accent: #6366f1;\n$radius: 0.875rem;\n\n@mixin surface {\n  border: 1px solid $line;\n  border-radius: $radius;\n  background: $surface;\n}\n`;
      files['src/styles/main.scss'] = `@use 'tokens' as *;

:root {
  color-scheme: dark;
  --bg: #{$bg};
  --surface: #{$surface};
  --line: #{$line};
  --muted: #{$muted};
  --accent: #{$accent};
  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  background: $bg;
  color: #e8eaf0;
}

body {
  margin: 0;
  min-height: 100vh;
}

.card {
  @include surface;
  display: grid;
  gap: 0.75rem;
  align-content: start;
  padding: 1.25rem;

  &:hover {
    border-color: lighten($line, 10%);
  }
}

${SEMANTIC_CSS.split('\n')
  .filter((l) => !l.startsWith('.card '))
  .join('\n')}`;
      imports.push('./styles/main.scss');
      break;
    case 'css-modules':
      files['src/styles.css'] = ROOT_CSS;
      imports.push('./styles.css');
      break;
    case 'bootstrap':
      imports.push('bootstrap/dist/css/bootstrap.min.css');
      files['src/styles.css'] = GRID_CSS;
      imports.push('./styles.css');
      break;
    case 'bulma':
      imports.push('bulma/css/bulma.min.css');
      files['src/styles.css'] = GRID_CSS;
      imports.push('./styles.css');
      break;
    case 'pico':
      imports.push('@picocss/pico/css/pico.min.css');
      files['src/styles.css'] = `${GRID_CSS}.ui-card {\n  padding: 1.25rem;\n  border-radius: var(--pico-border-radius);\n  background: var(--pico-card-background-color);\n  box-shadow: var(--pico-card-box-shadow);\n}\n.ui-muted {\n  color: var(--pico-muted-color);\n  font-size: 0.875rem;\n}\n.ui-error {\n  color: var(--pico-del-color);\n  font-size: 0.875rem;\n}\n.ui-row {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 0.5rem;\n  align-items: center;\n}\n`;
      imports.push('./styles.css');
      break;
    default:
      files['src/styles.css'] = ROOT_CSS + '\n' + SEMANTIC_CSS;
      imports.push('./styles.css');
  }
  return { files, imports };
}

/** Results of the framework-independent libraries (Zod, date-fns, Axios), shown in a card by every framework */
function factsModule(c: StackChoice): Files {
  const parts: string[] = [];
  const imports: string[] = [];
  if (has(c, 'zod')) {
    imports.push(`import { z } from 'zod';`);
    parts.push(`  const Email = z.email();
  const check = (value: string) => (Email.safeParse(value).success ? 'valid' : 'not an email');
  out.push({ library: 'Zod', result: \`"ada@example.com" is \${check('ada@example.com')}; "ada@" is \${check('ada@')}\` });`);
  }
  if (has(c, 'date-fns')) {
    imports.push(`import { addDays, format, formatDistanceStrict } from 'date-fns';`);
    parts.push(`  out.push({ library: 'date-fns', result: \`Today is \${format(now, 'EEEE d MMMM')}; a week from now is \${formatDistanceStrict(addDays(now, 7), now)} away\` });`);
  }
  if (has(c, 'axios')) {
    imports.push(`import { http } from './http';`);
    parts.push(`  out.push({ library: 'Axios', result: \`A client for \${http.defaults.baseURL} with a \${http.defaults.timeout} ms timeout\` });`);
  }
  if (!parts.length) return {};
  return {
    'src/facts.ts': `${imports.join('\n')}

export interface Fact {
  library: string;
  result: string;
}

/** One line from each utility library, computed when the page loads */
export function facts(${has(c, 'date-fns') ? 'now = new Date()' : ''}): Fact[] {
  const out: Fact[] = [];
${parts.join('\n')}
  return out;
}
`,
  };
}

/** The data layer: the hello endpoint (real with an API, simulated without), through Axios and Zod when chosen */
function apiModule(c: StackChoice): Files {
  const files: Files = {};
  if (has(c, 'axios')) files['src/http.ts'] = `import axios from 'axios';\n\n/** Shared HTTP client: base URL, timeout and headers in one place */\nexport const http = axios.create({ baseURL: '/api', timeout: 10_000 });\n`;
  const zod = has(c, 'zod');
  const lines: string[] = [];
  if (zod) lines.push(`import { z } from 'zod';`);
  if (has(c, 'axios') && has(c, 'hono')) lines.push(`import { http } from './http';`);
  lines.push('');
  if (zod) lines.push(`/** What the API returns, checked at run time */\nexport const Hello = z.object({ message: z.string(), at: z.string() });\nexport type Hello = z.infer<typeof Hello>;\n`);
  else lines.push(`export interface Hello {\n  message: string;\n  at: string;\n}\n`);
  const parse = (v: string) => (zod ? `Hello.parse(${v})` : `${v} as Hello`);
  if (has(c, 'hono')) {
    lines.push(
      has(c, 'axios')
        ? `export async function getHello(): Promise<Hello> {\n  const { data } = await http.get('/hello');\n  return ${parse('data')};\n}\n`
        : `export async function getHello(): Promise<Hello> {\n  const res = await fetch('/api/hello');\n  if (!res.ok) throw new Error(\`The API answered \${res.status}\`);\n  return ${parse('await res.json()')};\n}\n`,
    );
  } else {
    lines.push(`/** A stand-in for a real API call: swap the body for fetch('/your/api') */\nexport async function getHello(): Promise<Hello> {\n  await new Promise((resolve) => setTimeout(resolve, 400));\n  return ${parse(`{ message: 'Hello from a simulated API', at: new Date().toISOString() }`)};\n}\n`);
  }
  files['src/api.ts'] = lines.join('\n');
  return files;
}

const counterModule: Files = {
  'src/counter.ts': `/** The counter's label: the bit of logic the tests check */
export function counterLabel(count: number): string {
  return count === 0 ? 'Click me' : \`Clicked \${count} time\${count === 1 ? '' : 's'}\`;
}
`,
};

function serverFiles(c: StackChoice): Files {
  if (!has(c, 'hono')) return {};
  const db = has(c, 'drizzle');
  const files: Files = {
    'server/index.ts': `import { Hono } from 'hono';
${db ? `import { desc } from 'drizzle-orm';\nimport { db, notes } from './db.ts';\n` : ''}
/** The API: every route under /api. In development the Vite dev server runs it; npm start serves it with the built page. */
const app = new Hono();

app.get('/api/hello', (c) => c.json({ message: 'Hello from Hono', at: new Date().toISOString() }));
${
  db
    ? `
app.get('/api/notes', (c) => c.json(db.select().from(notes).orderBy(desc(notes.id)).limit(20).all()));

app.post('/api/notes', async (c) => {
  const body = await c.req.json<{ text?: unknown }>().catch(() => ({}) as { text?: unknown });
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return c.json({ error: 'text is required' }, 400);
  const [row] = db.insert(notes).values({ text }).returning().all();
  return c.json(row, 201);
});
`
    : ''
}
export default app;
`,
    'server/serve.ts': `import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import app from './index.ts';

// Production: the API plus the built page from dist/ (npm run build first)
app.use('/*', serveStatic({ root: './dist' }));

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => console.log(\`Listening on http://localhost:\${port}\`));
`,
  };
  if (db) {
    files['server/db.ts'] = `import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** The schema: one table, typed end to end */
export const notes = sqliteTable('notes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  text: text('text').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

const sqlite = new Database(process.env.DATABASE_FILE ?? 'data.db');
// Create the table on first run; for real schema changes use drizzle-kit (npm run db:generate)
sqlite.exec('CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, created_at INTEGER NOT NULL)');

export const db = drizzle(sqlite);
`;
    files['drizzle.config.ts'] = `import { defineConfig } from 'drizzle-kit';\n\nexport default defineConfig({\n  dialect: 'sqlite',\n  schema: './server/db.ts',\n  out: './drizzle',\n  dbCredentials: { url: process.env.DATABASE_FILE ?? 'data.db' },\n});\n`;
  }
  return files;
}

// ─── React (and the shared JSX demos) ───────────────────────────────────────

function reactFiles(c: StackChoice, styleImports: string[]): { files: Files; entry: string } {
  const files: Files = {};
  const shadcn = has(c, 'shadcn');
  const mantine = has(c, 'mantine');
  const at = shadcn ? '@/' : './';
  const demos: { name: string; file: string; code: string }[] = [];
  const add = (name: string, code: string) => demos.push({ name, file: `src/demos/${name}.tsx`, code });

  if (has(c, 'tanstack-query'))
    add(
      'QueryDemo',
      `import { useQuery } from '@tanstack/react-query';
import { getHello } from '../api';
import { ui } from '../ui';

export function QueryDemo() {
  const query = useQuery({ queryKey: ['hello'], queryFn: getHello });
  return (
    <section className={ui.card}>
      <h2 className={ui.cardTitle}>TanStack Query</h2>
      {query.isPending ? (
        <p className={ui.muted}>Loading…</p>
      ) : query.isError ? (
        <p className={ui.error}>{query.error.message}</p>
      ) : (
        <p>
          {query.data.message} <span className={ui.muted}>at {new Date(query.data.at).toLocaleTimeString()}</span>
        </p>
      )}
      <button type="button" className={ui.button} onClick={() => void query.refetch()} disabled={query.isFetching}>
        {query.isFetching ? 'Refreshing…' : 'Refetch'}
      </button>
    </section>
  );
}
`,
    );
  else if (has(c, 'swr'))
    add(
      'SwrDemo',
      `import useSWR from 'swr';
import { getHello } from '../api';
import { ui } from '../ui';

export function SwrDemo() {
  const { data, error, isLoading, isValidating, mutate } = useSWR('hello', getHello);
  return (
    <section className={ui.card}>
      <h2 className={ui.cardTitle}>SWR</h2>
      {isLoading ? <p className={ui.muted}>Loading…</p> : error ? <p className={ui.error}>{String(error)}</p> : <p>{data?.message}</p>}
      <button type="button" className={ui.button} onClick={() => void mutate()} disabled={isValidating}>
        Revalidate
      </button>
    </section>
  );
}
`,
    );
  else if (has(c, 'hono') || has(c, 'axios'))
    add(
      'ApiDemo',
      `import { useEffect, useState } from 'react';
import { getHello, type Hello } from '../api';
import { ui } from '../ui';

export function ApiDemo() {
  const [hello, setHello] = useState<Hello | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    getHello().then(setHello, (e: Error) => setError(e.message));
  }, []);
  return (
    <section className={ui.card}>
      <h2 className={ui.cardTitle}>API</h2>
      {error ? <p className={ui.error}>{error}</p> : <p>{hello ? hello.message : 'Loading…'}</p>}
    </section>
  );
}
`,
    );

  if (has(c, 'drizzle'))
    add(
      'NotesDemo',
      `import { useEffect, useState, type FormEvent } from 'react';
import { ui } from '../ui';

interface Note {
  id: number;
  text: string;
}

/** Notes saved in SQLite through the API (server/index.ts) */
export function NotesDemo() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const load = () =>
    fetch('/api/notes')
      .then((r) => r.json() as Promise<Note[]>)
      .then(setNotes, (e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    if (!res.ok) return setError((await res.json()).error ?? 'Could not save');
    setText('');
    setError('');
    await load();
  };
  return (
    <section className={ui.card}>
      <h2 className={ui.cardTitle}>Notes · Drizzle + SQLite</h2>
      <form onSubmit={add} className={ui.row}>
        <input className={ui.input} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a note" aria-label="Note" />
        <button type="submit" className={ui.button}>Save</button>
      </form>
      {error && <p className={ui.error}>{error}</p>}
      <ul className={ui.list}>
        {notes.map((n) => (
          <li key={n.id}>{n.text}</li>
        ))}
      </ul>
    </section>
  );
}
`,
    );

  if (has(c, 'zustand')) {
    files['src/store.ts'] = `import { create } from 'zustand';

interface CartState {
  items: number;
  add: () => void;
  clear: () => void;
}

/** App-wide state: any component can read it or change it */
export const useCart = create<CartState>()((set) => ({
  items: 0,
  add: () => set((s) => ({ items: s.items + 1 })),
  clear: () => set({ items: 0 }),
}));
`;
    add(
      'StoreDemo',
      `import { useCart } from '../store';
import { ui } from '../ui';

export function StoreDemo() {
  const { items, add, clear } = useCart();
  return (
    <section className={ui.card}>
      <h2 className={ui.cardTitle}>Zustand</h2>
      <p>{items} item(s) in the cart</p>
      <div className={ui.row}>
        <button type="button" className={ui.button} onClick={add}>
          Add
        </button>
        <button type="button" className={ui.button} onClick={clear}>
          Clear
        </button>
      </div>
    </section>
  );
}
`,
    );
  }
  if (has(c, 'jotai')) {
    files['src/atoms.ts'] = `import { atom } from 'jotai';\n\nexport const itemsAtom = atom(0);\n/** Derived state: recomputed when itemsAtom changes */\nexport const totalAtom = atom((get) => get(itemsAtom) * 12.5);\n`;
    add(
      'StoreDemo',
      `import { useAtom, useAtomValue } from 'jotai';
import { itemsAtom, totalAtom } from '../atoms';
import { ui } from '../ui';

export function StoreDemo() {
  const [items, setItems] = useAtom(itemsAtom);
  const total = useAtomValue(totalAtom);
  return (
    <section className={ui.card}>
      <h2 className={ui.cardTitle}>Jotai</h2>
      <p>
        {items} item(s), {total.toFixed(2)} total
      </p>
      <button type="button" className={ui.button} onClick={() => setItems((n) => n + 1)}>
        Add
      </button>
    </section>
  );
}
`,
    );
  }
  if (has(c, 'redux')) {
    files['src/store.ts'] = `import { configureStore, createSlice } from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';

const cart = createSlice({
  name: 'cart',
  initialState: { items: 0 },
  reducers: {
    add: (state) => {
      state.items += 1;
    },
    clear: (state) => {
      state.items = 0;
    },
  },
});

export const { add, clear } = cart.actions;
export const store = configureStore({ reducer: { cart: cart.reducer } });

export type RootState = ReturnType<typeof store.getState>;
export const useAppSelector = useSelector.withTypes<RootState>();
export const useAppDispatch = useDispatch.withTypes<typeof store.dispatch>();
`;
    add(
      'StoreDemo',
      `import { add, clear, useAppDispatch, useAppSelector } from '../store';
import { ui } from '../ui';

export function StoreDemo() {
  const items = useAppSelector((s) => s.cart.items);
  const dispatch = useAppDispatch();
  return (
    <section className={ui.card}>
      <h2 className={ui.cardTitle}>Redux Toolkit</h2>
      <p>{items} item(s) in the cart</p>
      <div className={ui.row}>
        <button type="button" className={ui.button} onClick={() => dispatch(add())}>
          Add
        </button>
        <button type="button" className={ui.button} onClick={() => dispatch(clear())}>
          Clear
        </button>
      </div>
    </section>
  );
}
`,
    );
  }

  if (has(c, 'react-hook-form')) {
    const zod = has(c, 'zod');
    add(
      'FormDemo',
      `import { useForm } from 'react-hook-form';
${zod ? `import { zodResolver } from '@hookform/resolvers/zod';\nimport { z } from 'zod';\n` : ''}import { ui } from '../ui';
${
  zod
    ? `
const Signup = z.object({
  name: z.string().min(2, 'At least 2 characters'),
  email: z.email('Enter a valid email'),
});
type Signup = z.infer<typeof Signup>;
`
    : `
interface Signup {
  name: string;
  email: string;
}
`
}
export function FormDemo() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitSuccessful },
  } = useForm<Signup>(${zod ? '{ resolver: zodResolver(Signup) }' : ''});
  return (
    <section className={ui.card}>
      <h2 className={ui.cardTitle}>React Hook Form${zod ? ' + Zod' : ''}</h2>
      <form onSubmit={handleSubmit(() => undefined)} className={ui.list}>
        <input className={ui.input} placeholder="Name" aria-label="Name" {...register('name'${zod ? '' : `, { minLength: { value: 2, message: 'At least 2 characters' }, required: 'Required' }`})} />
        {errors.name && <p className={ui.error}>{errors.name.message}</p>}
        <input className={ui.input} placeholder="Email" aria-label="Email" {...register('email'${zod ? '' : `, { pattern: { value: /\\S+@\\S+\\.\\S+/, message: 'Enter a valid email' }, required: 'Required' }`})} />
        {errors.email && <p className={ui.error}>{errors.email.message}</p>}
        <button type="submit" className={ui.button}>Sign up</button>
        {isSubmitSuccessful && <p className={ui.muted}>Valid: ready to send.</p>}
      </form>
    </section>
  );
}
`,
    );
  } else if (has(c, 'tanstack-form')) {
    add(
      'FormDemo',
      `import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { ui } from '../ui';

export function FormDemo() {
  const [sent, setSent] = useState('');
  const form = useForm({ defaultValues: { email: '' }, onSubmit: ({ value }) => setSent(value.email) });
  return (
    <section className={ui.card}>
      <h2 className={ui.cardTitle}>TanStack Form</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        className={ui.list}
      >
        <form.Field name="email" validators={{ onChange: ({ value }) => (/\\S+@\\S+\\.\\S+/.test(value) ? undefined : 'Enter a valid email') }}>
          {(field) => (
            <>
              <input className={ui.input} placeholder="Email" aria-label="Email" value={field.state.value} onBlur={field.handleBlur} onChange={(e) => field.handleChange(e.target.value)} />
              {field.state.meta.errors.length > 0 && <p className={ui.error}>{field.state.meta.errors.join(', ')}</p>}
            </>
          )}
        </form.Field>
        <button type="submit" className={ui.button}>Subscribe</button>
        {sent && <p className={ui.muted}>Subscribed {sent}</p>}
      </form>
    </section>
  );
}
`,
    );
  }

  if (has(c, 'tanstack-table'))
    add(
      'TableDemo',
      `import { createColumnHelper, createSortedRowModel, rowSortingFeature, sortFn_alphanumeric, tableFeatures, useTable } from '@tanstack/react-table';
import { ui } from '../ui';

interface Person {
  name: string;
  role: string;
  age: number;
}

const DATA: Person[] = [
  { name: 'Ada', role: 'Engineer', age: 36 },
  { name: 'Grace', role: 'Admiral', age: 45 },
  { name: 'Linus', role: 'Maintainer', age: 29 },
];

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel(), sortFns: { alphanumeric: sortFn_alphanumeric } });
const helper = createColumnHelper<typeof features, Person>();
const columns = helper.columns([helper.accessor('name', { header: 'Name' }), helper.accessor('role', { header: 'Role' }), helper.accessor('age', { header: 'Age' })]);

export function TableDemo() {
  const table = useTable({ features, columns, data: DATA });
  return (
    <section className={ui.card}>
      <h2 className={ui.cardTitle}>TanStack Table</h2>
      <p className={ui.muted}>Click a header to sort.</p>
      <table>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th key={header.id} onClick={header.column.getToggleSortingHandler()} style={{ cursor: 'pointer', textAlign: 'left' }}>
                  <table.FlexRender header={header} />
                  {{ asc: ' ↑', desc: ' ↓' }[header.column.getIsSorted() as string] ?? ''}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getAllCells().map((cell) => (
                <td key={cell.id}>
                  <table.FlexRender cell={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
`,
    );

  if (has(c, 'recharts'))
    add(
      'ChartDemo',
      `import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ui } from '../ui';

const VISITS = [
  { day: 'Mon', visits: 120 },
  { day: 'Tue', visits: 180 },
  { day: 'Wed', visits: 150 },
  { day: 'Thu', visits: 240 },
  { day: 'Fri', visits: 310 },
];

export function ChartDemo() {
  return (
    <section className={ui.card}>
      <h2 className={ui.cardTitle}>Recharts</h2>
      <div style={{ height: 160 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={VISITS}>
            <XAxis dataKey="day" stroke="currentColor" fontSize={12} />
            <YAxis stroke="currentColor" fontSize={12} width={32} />
            <Tooltip />
            <Line type="monotone" dataKey="visits" stroke="#6366f1" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
`,
    );
  if (has(c, 'motion'))
    add(
      'MotionDemo',
      `import { useState } from 'react';
import { motion } from 'motion/react';
import { ui } from '../ui';

export function MotionDemo() {
  const [open, setOpen] = useState(false);
  return (
    <section className={ui.card}>
      <h2 className={ui.cardTitle}>Motion</h2>
      <button type="button" className={ui.button} onClick={() => setOpen((o) => !o)}>
        {open ? 'Shrink' : 'Grow'}
      </button>
      <motion.div animate={{ width: open ? '100%' : '30%', rotate: open ? 0 : 3 }} transition={{ type: 'spring', bounce: 0.4 }} style={{ height: 12, borderRadius: 999, background: '#6366f1' }} />
    </section>
  );
}
`,
    );
  if (has(c, 'sonner'))
    add(
      'ToastDemo',
      `import { toast } from 'sonner';
import { ui } from '../ui';

export function ToastDemo() {
  return (
    <section className={ui.card}>
      <h2 className={ui.cardTitle}>Sonner</h2>
      <div className={ui.row}>
        <button type="button" className={ui.button} onClick={() => toast.success('Saved')}>
          Success
        </button>
        <button type="button" className={ui.button} onClick={() => toast.error('Something went wrong')}>
          Error
        </button>
      </div>
    </section>
  );
}
`,
    );
  if (has(c, 'i18n')) {
    files['src/i18n.ts'] = `import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

/** Translations: add a language by adding a block here */
void i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  resources: {
    en: { translation: { greeting: 'Good to see you', items_one: '{{count}} item', items_other: '{{count}} items' } },
    es: { translation: { greeting: 'Qué bueno verte', items_one: '{{count}} artículo', items_other: '{{count}} artículos' } },
  },
});

export default i18n;
`;
    add(
      'I18nDemo',
      `import { useTranslation } from 'react-i18next';
import { ui } from '../ui';

export function I18nDemo() {
  const { t, i18n } = useTranslation();
  return (
    <section className={ui.card}>
      <h2 className={ui.cardTitle}>i18next</h2>
      <p>
        {t('greeting')} · {t('items', { count: 3 })}
      </p>
      <button type="button" className={ui.button} onClick={() => void i18n.changeLanguage(i18n.language === 'en' ? 'es' : 'en')}>
        {i18n.language === 'en' ? 'Español' : 'English'}
      </button>
    </section>
  );
}
`,
    );
  }
  if (Object.keys(factsModule(c)).length)
    add(
      'Facts',
      `import { facts } from '../facts';
import { ui } from '../ui';

export function Facts() {
  return (
    <section className={ui.card}>
      <h2 className={ui.cardTitle}>Libraries</h2>
      <ul className={ui.list}>
        {facts().map((f) => (
          <li key={f.library}>
            <strong>{f.library}:</strong> {f.result}
          </li>
        ))}
      </ul>
    </section>
  );
}
`,
    );

  for (const d of demos) files[d.file] = d.code;

  // The counter in the hero, in the chosen UI kit
  const icon = has(c, 'lucide') || shadcn;
  files['src/Counter.tsx'] = shadcn
    ? `import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { counterLabel } from '@/counter';

export function Counter() {
  const [count, setCount] = useState(0);
  return (
    <Button type="button" onClick={() => setCount((n) => n + 1)}>
      <Sparkles /> {counterLabel(count)}
    </Button>
  );
}
`
    : mantine
      ? `import { useState } from 'react';
import { Button } from '@mantine/core';
import { counterLabel } from './counter';

export function Counter() {
  const [count, setCount] = useState(0);
  return <Button type="button" onClick={() => setCount((n) => n + 1)}>{counterLabel(count)}</Button>;
}
`
      : `import { useState } from 'react';
${icon ? `import { Sparkles } from 'lucide-react';\n` : ''}import { counterLabel } from './counter';
import { ui } from './ui';

export function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button type="button" className={ui.button} onClick={() => setCount((n) => n + 1)}>
      ${icon ? '<Sparkles size={16} /> ' : ''}{counterLabel(count)}
    </button>
  );
}
`;

  files['src/Home.tsx'] = `import { Counter } from '${at}Counter';
${demos.map((d) => `import { ${d.name} } from '${at}demos/${d.name}';`).join('\n')}
import { ui } from '${at}ui';

export function Home() {
  return (
    <main className={ui.page}>
      <header className={ui.hero}>
        <h1 className={ui.title}>${c.name}</h1>
        <p className={ui.lead}>
          ${stackSummary(c)}. Edit <code className={ui.code}>src/Home.tsx</code> and the preview updates as you type.
        </p>
        <div>
          <Counter />
        </div>
      </header>
${
  demos.length
    ? `      <div className={ui.grid}>
${demos.map((d) => `        <${d.name} />`).join('\n')}
      </div>
`
    : ''
}    </main>
  );
}
`;
  if (has(c, 'tanstack-router') || has(c, 'react-router'))
    files['src/About.tsx'] = `import { ui } from '${at}ui';

export function About() {
  return (
    <main className={ui.page}>
      <h1 className={ui.title}>About</h1>
      <p className={ui.lead}>A second page, to show routing. Add pages in src/router.tsx.</p>
    </main>
  );
}
`;

  const nav = `<nav className={ui.nav}>
        <Link to="/">Home</Link>
        <Link to="/about">About</Link>
      </nav>`;
  if (has(c, 'tanstack-router')) {
    files['src/router.tsx'] = `import { createRootRoute, createRoute, createRouter, Link, Outlet } from '@tanstack/react-router';
import { About } from './About';
import { Home } from './Home';
import { ui } from './ui';

const root = createRootRoute({
  component: () => (
    <>
      ${nav}
      <Outlet />
    </>
  ),
});

const routeTree = root.addChildren([createRoute({ getParentRoute: () => root, path: '/', component: Home }), createRoute({ getParentRoute: () => root, path: '/about', component: About })]);

export const router = createRouter({ routeTree });

// Links and params are type-checked against these routes
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
`;
    files['src/App.tsx'] = `import { RouterProvider } from '@tanstack/react-router';\nimport { router } from './router';\n\nexport function App() {\n  return <RouterProvider router={router} />;\n}\n`;
  } else if (has(c, 'react-router')) {
    files['src/router.tsx'] = `import { createBrowserRouter, Link, Outlet } from 'react-router';
import { About } from './About';
import { Home } from './Home';
import { ui } from './ui';

function Layout() {
  return (
    <>
      ${nav}
      <Outlet />
    </>
  );
}

export const router = createBrowserRouter([
  {
    path: '/',
    Component: Layout,
    children: [
      { index: true, Component: Home },
      { path: 'about', Component: About },
    ],
  },
]);
`;
    files['src/App.tsx'] = `import { RouterProvider } from 'react-router';\nimport { router } from './router';\n\nexport function App() {\n  return <RouterProvider router={router} />;\n}\n`;
  } else {
    files['src/App.tsx'] = `import { Home } from './Home';\n\nexport function App() {\n  return <Home />;\n}\n`;
  }

  // Providers around the app, outermost first
  const wrap: { open: string; close: string; imports: string[] }[] = [];
  const pre: string[] = [];
  if (mantine) wrap.push({ open: `<MantineProvider defaultColorScheme="dark">`, close: '</MantineProvider>', imports: [`import { MantineProvider } from '@mantine/core';`] });
  if (has(c, 'redux')) wrap.push({ open: '<Provider store={store}>', close: '</Provider>', imports: [`import { Provider } from 'react-redux';`, `import { store } from './store';`] });
  if (has(c, 'tanstack-query')) {
    wrap.push({ open: '<QueryClientProvider client={queryClient}>', close: '</QueryClientProvider>', imports: [`import { QueryClient, QueryClientProvider } from '@tanstack/react-query';`] });
    pre.push('const queryClient = new QueryClient();');
  }
  const extraImports = [...(has(c, 'sonner') ? [`import { Toaster } from 'sonner';`] : []), ...(has(c, 'i18n') ? [`import './i18n';`] : [])];
  let tree = `<App />${has(c, 'sonner') ? `\n<Toaster theme="dark" richColors />` : ''}`;
  if (has(c, 'sonner')) tree = `<>\n${tree}\n</>`;
  for (const w of [...wrap].reverse()) tree = `${w.open}\n${tree}\n${w.close}`;
  const indent = (s: string, n: number) =>
    s
      .split('\n')
      .map((l) => ' '.repeat(n) + l)
      .join('\n');
  files['src/main.tsx'] = `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
${[...wrap.flatMap((w) => w.imports), ...extraImports].join('\n')}${wrap.length || extraImports.length ? '\n' : ''}import { App } from './App';
${styleImports.map((s) => `import '${s}';`).join('\n')}
${pre.length ? `\n${pre.join('\n')}\n` : ''}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
${indent(nestIndent(tree), 4)}
  </StrictMode>,
);
`;

  if (has(c, 'vitest'))
    files['src/Counter.test.tsx'] = `import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Counter } from './Counter';

describe('Counter', () => {
  it('counts clicks', () => {
    render(${mantine ? `<MantineProvider><Counter /></MantineProvider>` : '<Counter />'});
    const button = screen.getByRole('button');
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button.textContent).toContain('Clicked 2 times');
  });
});
`.replace(`import { Counter } from './Counter';`, `import { Counter } from './Counter';${mantine ? `\nimport { MantineProvider } from '@mantine/core';` : ''}`);

  return { files, entry: 'src/Home.tsx' };
}

/** Indent nested JSX produced by wrapping, two spaces per level */
function nestIndent(tree: string): string {
  let depth = 0;
  return tree
    .split('\n')
    .map((line) => {
      const closing = line.startsWith('</');
      if (closing) depth--;
      const out = '  '.repeat(Math.max(0, depth)) + line;
      if (!closing && /^<[A-Za-z>]/.test(line) && !line.endsWith('/>') && !line.includes('</')) depth++;
      return out;
    })
    .join('\n');
}

// ─── Vue ─────────────────────────────────────────────────────────────────────

function vueFiles(c: StackChoice, styleImports: string[]): { files: Files; entry: string } {
  const files: Files = {};
  const demos: string[] = [];
  if (has(c, 'tanstack-query')) {
    demos.push('QueryDemo');
    files['src/demos/QueryDemo.vue'] = `<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query';
import { getHello } from '../api';
import { ui } from '../ui';

const { data, error, isPending, isError, isFetching, refetch } = useQuery({ queryKey: ['hello'], queryFn: getHello });
</script>

<template>
  <section :class="ui.card">
    <h2 :class="ui.cardTitle">TanStack Query</h2>
    <p v-if="isPending" :class="ui.muted">Loading…</p>
    <p v-else-if="isError" :class="ui.error">{{ error?.message }}</p>
    <p v-else>{{ data?.message }}</p>
    <button type="button" :class="ui.button" :disabled="isFetching" @click="refetch()">{{ isFetching ? 'Refreshing…' : 'Refetch' }}</button>
  </section>
</template>
`;
  } else if (has(c, 'hono') || has(c, 'axios')) {
    demos.push('ApiDemo');
    files['src/demos/ApiDemo.vue'] = `<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { getHello, type Hello } from '../api';
import { ui } from '../ui';

const hello = ref<Hello | null>(null);
const error = ref('');
onMounted(() => getHello().then((h) => (hello.value = h), (e: Error) => (error.value = e.message)));
</script>

<template>
  <section :class="ui.card">
    <h2 :class="ui.cardTitle">API</h2>
    <p v-if="error" :class="ui.error">{{ error }}</p>
    <p v-else>{{ hello ? hello.message : 'Loading…' }}</p>
  </section>
</template>
`;
  }
  if (has(c, 'pinia')) {
    demos.push('StoreDemo');
    files['src/stores/cart.ts'] = `import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

/** App-wide state: any component can use it */
export const useCart = defineStore('cart', () => {
  const items = ref(0);
  const total = computed(() => items.value * 12.5);
  const add = () => items.value++;
  const clear = () => (items.value = 0);
  return { items, total, add, clear };
});
`;
    files['src/demos/StoreDemo.vue'] = `<script setup lang="ts">
import { useCart } from '../stores/cart';
import { ui } from '../ui';

const cart = useCart();
</script>

<template>
  <section :class="ui.card">
    <h2 :class="ui.cardTitle">Pinia</h2>
    <p>{{ cart.items }} item(s), {{ cart.total.toFixed(2) }} total</p>
    <div :class="ui.row">
      <button type="button" :class="ui.button" @click="cart.add()">Add</button>
      <button type="button" :class="ui.button" @click="cart.clear()">Clear</button>
    </div>
  </section>
</template>
`;
  }
  if (has(c, 'vueuse')) {
    demos.push('MouseDemo');
    files['src/demos/MouseDemo.vue'] = `<script setup lang="ts">
import { useMouse, useLocalStorage } from '@vueuse/core';
import { ui } from '../ui';

const { x, y } = useMouse();
const visits = useLocalStorage('visits', 0);
visits.value++;
</script>

<template>
  <section :class="ui.card">
    <h2 :class="ui.cardTitle">VueUse</h2>
    <p>Mouse at {{ x }}, {{ y }}</p>
    <p :class="ui.muted">Visit number {{ visits }} (kept in localStorage)</p>
  </section>
</template>
`;
  }
  if (has(c, 'tanstack-table')) {
    demos.push('TableDemo');
    files['src/demos/TableDemo.vue'] = `<script setup lang="ts">
import { createColumnHelper, createSortedRowModel, FlexRender, rowSortingFeature, sortFn_alphanumeric, tableFeatures, useTable } from '@tanstack/vue-table';
import { ui } from '../ui';

interface Person {
  name: string;
  role: string;
  age: number;
}

const data: Person[] = [
  { name: 'Ada', role: 'Engineer', age: 36 },
  { name: 'Grace', role: 'Admiral', age: 45 },
  { name: 'Linus', role: 'Maintainer', age: 29 },
];
const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel(), sortFns: { alphanumeric: sortFn_alphanumeric } });
const helper = createColumnHelper<typeof features, Person>();
const columns = helper.columns([helper.accessor('name', { header: 'Name' }), helper.accessor('role', { header: 'Role' }), helper.accessor('age', { header: 'Age' })]);
const table = useTable({ features, columns, data });
</script>

<template>
  <section :class="ui.card">
    <h2 :class="ui.cardTitle">TanStack Table</h2>
    <table>
      <thead>
        <tr v-for="group in table.getHeaderGroups()" :key="group.id">
          <th v-for="header in group.headers" :key="header.id" style="cursor: pointer; text-align: left" @click="header.column.getToggleSortingHandler()?.($event)">
            <FlexRender :header="header" />
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in table.getRowModel().rows" :key="row.id">
          <td v-for="cell in row.getAllCells()" :key="cell.id"><FlexRender :cell="cell" /></td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
`;
  }
  const facts = Object.keys(factsModule(c)).length > 0;
  files['src/components/Counter.vue'] = `<script setup lang="ts">
import { ref } from 'vue';
import { counterLabel } from '../counter';
import { ui } from '../ui';

const count = ref(0);
</script>

<template>
  <button type="button" :class="ui.button" @click="count++">{{ counterLabel(count) }}</button>
</template>
`;
  const router = has(c, 'vue-router');
  const home = `<script setup lang="ts">
import Counter from '${router ? '../components' : './components'}/Counter.vue';
${demos.map((d) => `import ${d} from '${router ? '..' : '.'}/demos/${d}.vue';`).join('\n')}
${facts ? `import { facts } from '${router ? '..' : '.'}/facts';\n` : ''}import { ui } from '${router ? '..' : '.'}/ui';
</script>

<template>
  <main :class="ui.page">
    <header :class="ui.hero">
      <h1 :class="ui.title">${c.name}</h1>
      <p :class="ui.lead">${stackSummary(c)}. Edit <code :class="ui.code">${router ? 'src/views/Home.vue' : 'src/App.vue'}</code> and the preview updates as you type.</p>
      <div><Counter /></div>
    </header>
    <div :class="ui.grid">
${demos.map((d) => `      <${d} />`).join('\n')}
${
  facts
    ? `      <section :class="ui.card">
        <h2 :class="ui.cardTitle">Libraries</h2>
        <ul :class="ui.list">
          <li v-for="f in facts()" :key="f.library"><strong>{{ f.library }}:</strong> {{ f.result }}</li>
        </ul>
      </section>
`
    : ''
}    </div>
  </main>
</template>
`;
  if (router) {
    files['src/views/Home.vue'] = home;
    files['src/views/About.vue'] = `<script setup lang="ts">
import { ui } from '../ui';
</script>

<template>
  <main :class="ui.page">
    <h1 :class="ui.title">About</h1>
    <p :class="ui.lead">A second page, to show routing. Add pages in src/router.ts.</p>
  </main>
</template>
`;
    files['src/router.ts'] = `import { createRouter, createWebHistory } from 'vue-router';
import About from './views/About.vue';
import Home from './views/Home.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Home },
    { path: '/about', component: About },
  ],
});
`;
    files['src/App.vue'] = `<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';
import { ui } from './ui';
</script>

<template>
  <nav :class="ui.nav">
    <RouterLink to="/">Home</RouterLink>
    <RouterLink to="/about">About</RouterLink>
  </nav>
  <RouterView />
</template>
`;
  } else files['src/App.vue'] = home;

  const uses = [...(has(c, 'pinia') ? ['createPinia()'] : []), ...(router ? ['router'] : []), ...(has(c, 'tanstack-query') ? ['VueQueryPlugin'] : [])];
  files['src/main.ts'] = `import { createApp } from 'vue';
${has(c, 'pinia') ? `import { createPinia } from 'pinia';\n` : ''}${has(c, 'tanstack-query') ? `import { VueQueryPlugin } from '@tanstack/vue-query';\n` : ''}import App from './App.vue';
${router ? `import { router } from './router';\n` : ''}${styleImports.map((s) => `import '${s}';`).join('\n')}

createApp(App)${uses.map((u) => `\n  .use(${u})`).join('')}
  .mount('#app');
`;
  files['src/env.d.ts'] = `/// <reference types="vite/client" />\n`;
  if (has(c, 'vitest'))
    files['src/Counter.test.ts'] = `import { fireEvent, render, screen } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import Counter from './components/Counter.vue';

describe('Counter', () => {
  it('counts clicks', async () => {
    render(Counter);
    const button = screen.getByRole('button');
    await fireEvent.click(button);
    await fireEvent.click(button);
    expect(button.textContent).toContain('Clicked 2 times');
  });
});
`;
  return { files, entry: router ? 'src/views/Home.vue' : 'src/App.vue' };
}

// ─── Svelte, Solid, Preact, vanilla ──────────────────────────────────────────

function svelteFiles(c: StackChoice, styleImports: string[]): { files: Files; entry: string } {
  const facts = Object.keys(factsModule(c)).length > 0;
  const api = has(c, 'hono') || has(c, 'axios');
  return {
    entry: 'src/App.svelte',
    files: {
      'src/main.ts': `import { mount } from 'svelte';
import App from './App.svelte';
${styleImports.map((s) => `import '${s}';`).join('\n')}

export default mount(App, { target: document.getElementById('app')! });
`,
      'svelte.config.js': `import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';\n\nexport default {\n  preprocess: vitePreprocess(),\n};\n`,
      'src/App.svelte': `<script lang="ts">
  import { counterLabel } from './counter';
${facts ? `  import { facts } from './facts';\n` : ''}${api ? `  import { getHello } from './api';\n` : ''}  import { ui } from './ui';

  let count = $state(0);
${api ? `  const hello = getHello();\n` : ''}</script>

<main class={ui.page}>
  <header class={ui.hero}>
    <h1 class={ui.title}>${c.name}</h1>
    <p class={ui.lead}>${stackSummary(c)}. Edit <code class={ui.code}>src/App.svelte</code> and the preview updates as you type.</p>
    <div><button type="button" class={ui.button} onclick={() => count++}>{counterLabel(count)}</button></div>
  </header>
  <div class={ui.grid}>
${
  api
    ? `    <section class={ui.card}>
      <h2 class={ui.cardTitle}>API</h2>
      {#await hello}
        <p class={ui.muted}>Loading…</p>
      {:then h}
        <p>{h.message}</p>
      {:catch e}
        <p class={ui.error}>{e.message}</p>
      {/await}
    </section>
`
    : ''
}${
        facts
          ? `    <section class={ui.card}>
      <h2 class={ui.cardTitle}>Libraries</h2>
      <ul class={ui.list}>
        {#each facts() as f (f.library)}
          <li><strong>{f.library}:</strong> {f.result}</li>
        {/each}
      </ul>
    </section>
`
          : ''
      }  </div>
</main>
`,
    },
  };
}

function solidFiles(c: StackChoice, styleImports: string[]): { files: Files; entry: string } {
  const files: Files = {};
  const facts = Object.keys(factsModule(c)).length > 0;
  const query = has(c, 'tanstack-query');
  const api = !query && (has(c, 'hono') || has(c, 'axios'));
  files['src/Home.tsx'] = `import { createSignal${api ? ', createResource' : ''}${facts ? ', For' : ''} } from 'solid-js';
${query ? `import { useQuery } from '@tanstack/solid-query';\n` : ''}${query || api ? `import { getHello } from './api';\n` : ''}import { counterLabel } from './counter';
${facts ? `import { facts } from './facts';\n` : ''}import { ui } from './ui';

export function Home() {
  const [count, setCount] = createSignal(0);
${query ? `  const hello = useQuery(() => ({ queryKey: ['hello'], queryFn: getHello }));\n` : ''}${api ? `  const [hello] = createResource(getHello);\n` : ''}  return (
    <main class={ui.page}>
      <header class={ui.hero}>
        <h1 class={ui.title}>${c.name}</h1>
        <p class={ui.lead}>
          ${stackSummary(c)}. Edit <code class={ui.code}>src/Home.tsx</code> and the preview updates as you type.
        </p>
        <div>
          <button type="button" class={ui.button} onClick={() => setCount((n) => n + 1)}>
            {counterLabel(count())}
          </button>
        </div>
      </header>
      <div class={ui.grid}>
${
  query
    ? `        <section class={ui.card}>
          <h2 class={ui.cardTitle}>TanStack Query</h2>
          <p>{hello.isPending ? 'Loading…' : hello.isError ? hello.error.message : hello.data?.message}</p>
          <button type="button" class={ui.button} onClick={() => void hello.refetch()}>
            Refetch
          </button>
        </section>
`
    : ''
}${
    api
      ? `        <section class={ui.card}>
          <h2 class={ui.cardTitle}>API</h2>
          <p>{hello.error ? String(hello.error) : (hello()?.message ?? 'Loading…')}</p>
        </section>
`
      : ''
  }${
    facts
      ? `        <section class={ui.card}>
          <h2 class={ui.cardTitle}>Libraries</h2>
          <ul class={ui.list}>
            <For each={facts()}>
              {(f) => (
                <li>
                  <strong>{f.library}:</strong> {f.result}
                </li>
              )}
            </For>
          </ul>
        </section>
`
      : ''
  }      </div>
    </main>
  );
}
`;
  const router = has(c, 'solid-router');
  if (router) {
    files['src/About.tsx'] = `import { ui } from './ui';\n\nexport function About() {\n  return (\n    <main class={ui.page}>\n      <h1 class={ui.title}>About</h1>\n      <p class={ui.lead}>A second page, to show routing. Add pages in src/index.tsx.</p>\n    </main>\n  );\n}\n`;
    files['src/Layout.tsx'] = `import type { ParentProps } from 'solid-js';\nimport { A } from '@solidjs/router';\nimport { ui } from './ui';\n\nexport function Layout(props: ParentProps) {\n  return (\n    <>\n      <nav class={ui.nav}>\n        <A href="/">Home</A>\n        <A href="/about">About</A>\n      </nav>\n      {props.children}\n    </>\n  );\n}\n`;
  }
  const app = router
    ? `<Router root={Layout}>\n      <Route path="/" component={Home} />\n      <Route path="/about" component={About} />\n    </Router>`
    : '<Home />';
  files['src/index.tsx'] = `import { render } from 'solid-js/web';
${query ? `import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';\n` : ''}${router ? `import { Route, Router } from '@solidjs/router';\nimport { About } from './About';\nimport { Layout } from './Layout';\n` : ''}import { Home } from './Home';
${styleImports.map((s) => `import '${s}';`).join('\n')}
${query ? `\nconst queryClient = new QueryClient();\n` : ''}
render(
  () => ${query ? `(\n    <QueryClientProvider client={queryClient}>\n      ${app.replace(/\n {4}/g, '\n      ')}\n    </QueryClientProvider>\n  )` : router ? `(\n    ${app}\n  )` : app},
  document.getElementById('root')!,
);
`;
  return { files, entry: 'src/Home.tsx' };
}

function preactFiles(c: StackChoice, styleImports: string[]): { files: Files; entry: string } {
  const facts = Object.keys(factsModule(c)).length > 0;
  const api = has(c, 'hono') || has(c, 'axios');
  return {
    entry: 'src/App.tsx',
    files: {
      'src/main.tsx': `import { render } from 'preact';
import { App } from './App';
${styleImports.map((s) => `import '${s}';`).join('\n')}

render(<App />, document.getElementById('app')!);
`,
      'src/App.tsx': `import { useState${api ? ', useEffect' : ''} } from 'preact/hooks';
${api ? `import { getHello, type Hello } from './api';\n` : ''}import { counterLabel } from './counter';
${facts ? `import { facts } from './facts';\n` : ''}import { ui } from './ui';

export function App() {
  const [count, setCount] = useState(0);
${api ? `  const [hello, setHello] = useState<Hello | null>(null);\n  const [error, setError] = useState('');\n  useEffect(() => {\n    getHello().then(setHello, (e: Error) => setError(e.message));\n  }, []);\n` : ''}  return (
    <main class={ui.page}>
      <header class={ui.hero}>
        <h1 class={ui.title}>${c.name}</h1>
        <p class={ui.lead}>
          ${stackSummary(c)}. Edit <code class={ui.code}>src/App.tsx</code> and the preview updates as you type.
        </p>
        <div>
          <button type="button" class={ui.button} onClick={() => setCount((n) => n + 1)}>
            {counterLabel(count)}
          </button>
        </div>
      </header>
      <div class={ui.grid}>
${api ? `        <section class={ui.card}>\n          <h2 class={ui.cardTitle}>API</h2>\n          {error ? <p class={ui.error}>{error}</p> : <p>{hello ? hello.message : 'Loading…'}</p>}\n        </section>\n` : ''}${
        facts
          ? `        <section class={ui.card}>
          <h2 class={ui.cardTitle}>Libraries</h2>
          <ul class={ui.list}>
            {facts().map((f) => (
              <li key={f.library}>
                <strong>{f.library}:</strong> {f.result}
              </li>
            ))}
          </ul>
        </section>
`
          : ''
      }      </div>
    </main>
  );
}
`,
    },
  };
}

function vanillaFiles(c: StackChoice, styleImports: string[]): { files: Files; entry: string } {
  const facts = Object.keys(factsModule(c)).length > 0;
  const api = has(c, 'hono') || has(c, 'axios');
  return {
    entry: 'src/main.ts',
    files: {
      'src/main.ts': `import { counterLabel } from './counter';
${api ? `import { getHello } from './api';\n` : ''}${facts ? `import { facts } from './facts';\n` : ''}import { ui } from './ui';
${styleImports.map((s) => `import '${s}';`).join('\n')}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

document.querySelector<HTMLDivElement>('#app')!.innerHTML = \`
  <main class="\${ui.page}">
    <header class="\${ui.hero}">
      <h1 class="\${ui.title}">${c.name}</h1>
      <p class="\${ui.lead}">${stackSummary(c)}. Edit <code class="\${ui.code}">src/main.ts</code> and the preview updates as you type.</p>
      <div><button type="button" id="counter" class="\${ui.button}">\${counterLabel(0)}</button></div>
    </header>
    <div class="\${ui.grid}">
${api ? `      <section class="\${ui.card}"><h2 class="\${ui.cardTitle}">API</h2><p id="hello" class="\${ui.muted}">Loading…</p></section>\n` : ''}${facts ? `      <section class="\${ui.card}"><h2 class="\${ui.cardTitle}">Libraries</h2><ul class="\${ui.list}">\${facts()\n        .map((f) => \`<li><strong>\${esc(f.library)}:</strong> \${esc(f.result)}</li>\`)\n        .join('')}</ul></section>\n` : ''}    </div>
  </main>
\`;

let count = 0;
const button = document.querySelector<HTMLButtonElement>('#counter')!;
button.addEventListener('click', () => {
  count++;
  button.textContent = counterLabel(count);
});
${
  api
    ? `
getHello().then(
  (h) => (document.querySelector('#hello')!.textContent = h.message),
  (e: Error) => (document.querySelector('#hello')!.textContent = e.message),
);
`
    : ''
}`,
    },
  };
}

// ─── Config files ────────────────────────────────────────────────────────────

function viteConfig(c: StackChoice): string {
  const imports: string[] = [];
  const plugins: string[] = [];
  const fw: Record<string, [string, string]> = {
    react: [`import react from '@vitejs/plugin-react';`, 'react()'],
    vue: [`import vue from '@vitejs/plugin-vue';`, 'vue()'],
    svelte: [`import { svelte } from '@sveltejs/vite-plugin-svelte';`, 'svelte()'],
    solid: [`import solid from 'vite-plugin-solid';`, 'solid()'],
    preact: [`import preact from '@preact/preset-vite';`, 'preact()'],
  };
  if (fw[c.framework]) {
    imports.push(fw[c.framework][0]);
    plugins.push(fw[c.framework][1]);
  }
  if (c.styling === 'tailwind') {
    imports.push(`import tailwindcss from '@tailwindcss/vite';`);
    plugins.push('tailwindcss()');
  }
  if (c.styling === 'unocss') {
    imports.push(`import UnoCSS from 'unocss/vite';`);
    plugins.push('UnoCSS()');
  }
  if (has(c, 'hono')) {
    imports.push(`import devServer from '@hono/vite-dev-server';`);
    plugins.push(`// The API (server/index.ts) answers /api/*; everything else is the page\n    devServer({ entry: 'server/index.ts', exclude: [/^(?!\\/api(\\/|$)).*/] })`);
  }
  const alias = has(c, 'shadcn');
  if (alias) imports.push(`import { fileURLToPath, URL } from 'node:url';`);
  const test = has(c, 'vitest');
  const head = test ? `/// <reference types="vitest/config" />\n` : '';
  return `${head}${imports.sort().join('\n')}
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [${plugins.length ? `\n    ${plugins.join(',\n    ')},\n  ` : ''}],${alias ? `\n  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },` : ''}${
    test ? `\n  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}']${has(c, 'mantine') ? `, setupFiles: ['src/test-setup.ts']` : ''}${c.framework === 'svelte' ? `, server: { deps: { inline: ['svelte'] } }` : ''} },` : ''
  }
});
`;
}

function tsconfigFor(c: StackChoice): string {
  const jsx: Record<Framework2, Record<string, string> | undefined> = {
    react: { jsx: 'react-jsx' },
    preact: { jsx: 'react-jsx', jsxImportSource: 'preact' },
    solid: { jsx: 'preserve', jsxImportSource: 'solid-js' },
    vue: { jsx: 'preserve' },
    svelte: undefined,
    vanilla: undefined,
  };
  const types = ['vite/client', ...(has(c, 'hono') || has(c, 'shadcn') ? ['node'] : [])];
  return json({
    compilerOptions: {
      target: 'ES2022',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      moduleResolution: 'bundler',
      types,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      isolatedModules: true,
      ...(c.framework === 'svelte' ? { verbatimModuleSyntax: true } : {}),
      ...(has(c, 'hono') ? { allowImportingTsExtensions: true } : {}),
      ...(jsx[c.framework] ?? {}),
      ...(has(c, 'shadcn') ? { paths: { '@/*': ['./src/*'] } } : {}),
    },
    include: ['src', ...(has(c, 'hono') ? ['server'] : [])],
  });
}
type Framework2 = StackChoice['framework'];

function eslintConfig(c: StackChoice): string {
  const react = c.framework === 'react' || c.framework === 'preact';
  return `import js from '@eslint/js';
import globals from 'globals';
${react ? `import reactHooks from 'eslint-plugin-react-hooks';\nimport reactRefresh from 'eslint-plugin-react-refresh';\n` : ''}import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'${c.framework === 'vue' ? `, '**/*.vue'` : ''}${c.framework === 'svelte' ? `, '**/*.svelte'` : ''}] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended${react ? `, reactHooks.configs.flat.recommended, reactRefresh.configs.vite` : ''}],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
);
`;
}

function readme(c: StackChoice): string {
  const fw = FRAMEWORKS.find((f) => f.id === c.framework)!;
  const st = STYLINGS.find((s) => s.id === c.styling)!;
  const libs = c.libraries.map((id) => getLibrary(id)!);
  const { dependencies, devDependencies } = webDependencies(c);
  return `# ${c.name}

${stackSummary(c)}

Press **Run** in the studio for a live preview, or run \`npm install\` and \`npm run dev\`.

## The stack, and why

- **${fw.name}**: ${fw.blurb} ${fw.why}
- **${st.name}**: ${st.blurb} ${st.why}
${libs.map((l) => `- **${l.name}**: ${l.blurb} ${l.why}`).join('\n')}

## Scripts

${Object.entries(scripts(c))
  .map(([k, v]) => `- \`npm run ${k}\`: \`${v}\``)
  .join('\n')}

## Dependencies

${Object.entries(dependencies)
  .map(([k, v]) => `- \`${k}\` ${v}`)
  .join('\n')}

Development: ${Object.keys(devDependencies)
    .map((k) => `\`${k}\``)
    .join(', ')}
`;
}

function scripts(c: StackChoice): Record<string, string> {
  const s: Record<string, string> = { dev: 'vite', build: 'vite build', preview: 'vite preview' };
  s.typecheck = c.framework === 'vue' ? 'vue-tsc --noEmit' : c.framework === 'svelte' ? 'svelte-check --tsconfig ./tsconfig.json' : 'tsc --noEmit';
  if (has(c, 'vitest')) s.test = 'vitest run';
  if (has(c, 'playwright')) s['test:e2e'] = 'playwright test';
  if (has(c, 'eslint')) s.lint = 'eslint .';
  if (has(c, 'biome')) {
    s.lint = 'biome lint .';
    s.format = 'biome format --write .';
  }
  if (has(c, 'prettier')) s.format = 'prettier --write .';
  if (has(c, 'hono')) s.start = 'vite build && node --experimental-strip-types server/serve.ts';
  if (has(c, 'drizzle')) s['db:generate'] = 'drizzle-kit generate';
  return s;
}

/** The whole web project for a (resolved) stack choice */
export function webProject(c: StackChoice): { files: Files; entry: string } {
  const st = styles(c);
  const out =
    c.framework === 'react'
      ? reactFiles(c, st.imports)
      : c.framework === 'vue'
        ? vueFiles(c, st.imports)
        : c.framework === 'svelte'
          ? svelteFiles(c, st.imports)
          : c.framework === 'solid'
            ? solidFiles(c, st.imports)
            : c.framework === 'preact'
              ? preactFiles(c, st.imports)
              : vanillaFiles(c, st.imports);
  const rootId = c.framework === 'react' || c.framework === 'solid' ? 'root' : 'app';
  const htmlAttrs = has(c, 'shadcn') ? ' class="dark"' : has(c, 'daisyui') ? ' data-theme="dark"' : c.styling === 'bootstrap' ? ' data-bs-theme="dark"' : c.styling === 'bulma' || c.styling === 'pico' ? ' data-theme="dark"' : '';
  const entryScript = { react: '/src/main.tsx', vue: '/src/main.ts', svelte: '/src/main.ts', solid: '/src/index.tsx', preact: '/src/main.tsx', vanilla: '/src/main.ts' }[c.framework];
  const { dependencies, devDependencies } = webDependencies(c);
  const files: Files = {
    'index.html': `<!doctype html>
<html lang="en"${htmlAttrs}>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${c.name}</title>
  </head>
  <body>
    <div id="${rootId}"></div>
    <script type="module" src="${entryScript}"></script>
  </body>
</html>
`,
    'package.json': json({ name: c.name, private: true, version: '0.0.0', type: 'module', scripts: scripts(c), ...(Object.keys(dependencies).length ? { dependencies } : {}), devDependencies }),
    'vite.config.ts': viteConfig(c),
    'tsconfig.json': tsconfigFor(c),
    '.gitignore': `node_modules\ndist\n${has(c, 'drizzle') ? 'data.db\n' : ''}${has(c, 'playwright') ? 'test-results\nplaywright-report\n' : ''}`,
    'README.md': readme(c),
    ...st.files,
    ...uiModule(c),
    ...counterModule,
    ...apiModuleIfUsed(c),
    ...factsModule(c),
    ...serverFiles(c),
    ...(has(c, 'shadcn') ? SHADCN_FILES : {}),
    ...out.files,
  };
  if (has(c, 'vitest')) {
    if (has(c, 'mantine'))
      files['src/test-setup.ts'] = `// jsdom has no matchMedia; Mantine reads it for the colour scheme
window.matchMedia ??= (query: string) =>
  ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as MediaQueryList;
`;
    files['src/counter-label.test.ts'] = `import { describe, expect, it } from 'vitest';
import { counterLabel } from './counter';

describe('counterLabel', () => {
  it('invites the first click, then counts', () => {
    expect(counterLabel(0)).toBe('Click me');
    expect(counterLabel(1)).toBe('Clicked 1 time');
    expect(counterLabel(3)).toBe('Clicked 3 times');
  });
});
`;
    if (files['src/facts.ts'])
      files['src/facts.test.ts'] = `import { describe, expect, it } from 'vitest';
import { facts } from './facts';

describe('facts', () => {
  it('has a line from each library', () => {
    const lines = facts(${has(c, 'date-fns') ? 'new Date(2026, 0, 5)' : ''});
    expect(lines.map((f) => f.library)).toEqual(${JSON.stringify([...(has(c, 'zod') ? ['Zod'] : []), ...(has(c, 'date-fns') ? ['date-fns'] : []), ...(has(c, 'axios') ? ['Axios'] : [])])});
${has(c, 'zod') ? `    expect(lines[0].result).toContain('is valid');\n` : ''}  });
});
`;
  }
  if (has(c, 'playwright')) {
    files['playwright.config.ts'] = `import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: 'http://localhost:5173' },
  webServer: { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true },
});
`;
    files['e2e/home.spec.ts'] = `import { expect, test } from '@playwright/test';

test('the home page counts clicks', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('${c.name}');
  const counter = page.getByRole('button', { name: 'Click me' });
  await counter.click();
  await expect(page.getByRole('button', { name: 'Clicked 1 time' })).toBeVisible();
});
`;
  }
  if (has(c, 'eslint')) files['eslint.config.js'] = eslintConfig(c);
  if (has(c, 'prettier')) {
    files['.prettierrc'] = json({ singleQuote: true, printWidth: 120 });
    files['.prettierignore'] = 'dist\nnode_modules\n';
  }
  if (has(c, 'biome')) files['biome.json'] = json({ $schema: 'https://biomejs.dev/schemas/2.6.2/schema.json', files: { includes: ['**', '!dist', '!node_modules'] }, formatter: { indentStyle: 'space', lineWidth: 120 }, javascript: { formatter: { quoteStyle: 'single' } }, linter: { rules: { recommended: true, style: { noNonNullAssertion: 'off' } } } });
  return { files, entry: out.entry };
}

function apiModuleIfUsed(c: StackChoice): Files {
  const needs = has(c, 'tanstack-query') || has(c, 'swr') || has(c, 'hono') || has(c, 'axios');
  if (!needs) return {};
  const files = apiModule(c);
  // Without an API or a fetching library, src/api.ts would be unused; Axios alone still gets its client
  return files;
}
