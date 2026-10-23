/**
 * A starter for each popular way to style a web app: Tailwind, daisyUI,
 * UnoCSS, Bootstrap, Bulma, Pico, Sass, Less and CSS Modules. Each is a real
 * Vite project (it runs with its own dev server and builds for production)
 * that also previews in the browser with no install: the preview compiles
 * Sass and Less, scopes CSS Modules and runs Tailwind and UnoCSS in the page.
 */

import { html, pkg, TS, tsconfig, VITE, viteScripts, type WebStarter } from './web-templates.ts';

const REACT = { react: '^19.3.1', 'react-dom': '^19.3.1' };
const REACT_DEV = { '@types/react': '^19.3.0', '@types/react-dom': '^19.3.0', '@vitejs/plugin-react': '^6.1.2', typescript: TS, vite: VITE };

const reactMain = (style: string) => `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '${style}';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
`;

/** A small app that shows off a framework: a card with a title, a counter button and a list */
const vanillaApp = (title: string, style: string, markup: (count: string) => string) => `import '${style}';

let count = 0;
const app = document.querySelector<HTMLDivElement>('#app')!;
const render = () => {
  app.innerHTML = \`${markup('${count}')}\`;
  app.querySelector('#counter')!.addEventListener('click', () => {
    count++;
    render();
  });
};
render();
console.log('${title} is ready');
`;

const FEATURES = ['Live preview as you type', 'Production build with Vite', 'Ships with CI'];

export const CSS_STARTERS: WebStarter[] = [
  {
    id: 'css-tailwind',
    name: 'Tailwind CSS (React)',
    description: 'Tailwind CSS v4 with React and Vite: utility classes, a custom theme color, dark by default',
    filename: 'src/App.tsx',
    code: `import { useState } from 'react';

const features = ${JSON.stringify(FEATURES)};

export function App() {
  const [count, setCount] = useState(0);
  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 p-8 text-slate-100">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/60 p-8 shadow-xl">
        <h1 className="text-3xl font-semibold tracking-tight">Hello from Tailwind</h1>
        <p className="mt-2 text-slate-400">
          Edit <code className="rounded bg-slate-800 px-1.5 py-0.5 text-sm">src/App.tsx</code>: classes apply as you type.
        </p>
        <ul className="mt-6 space-y-2">
          {features.map((f) => (
            <li key={f} className="flex items-center gap-2 text-sm text-slate-300">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" /> {f}
            </li>
          ))}
        </ul>
        <button onClick={() => setCount((c) => c + 1)} className="mt-6 w-full rounded-xl bg-brand px-4 py-2.5 font-medium text-slate-950 transition hover:opacity-90">
          Clicked {count} times
        </button>
      </div>
    </main>
  );
}
`,
    files: {
      'index.html': html('Tailwind app', '/src/main.tsx', '<div id="root"></div>'),
      'src/main.tsx': reactMain('./index.css'),
      'src/index.css': `@import "tailwindcss";

/* Your design tokens become utilities: bg-brand, text-brand… */
@theme {
  --color-brand: #5eead4;
}
`,
      'vite.config.ts': `import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
`,
      'tsconfig.json': tsconfig({ jsx: 'react-jsx' }),
      'package.json': pkg('tailwind-app', viteScripts, REACT, { ...REACT_DEV, tailwindcss: '^4.1.0', '@tailwindcss/vite': '^4.1.0' }),
    },
  },
  {
    id: 'css-daisyui',
    name: 'daisyUI (Tailwind components)',
    description: 'daisyUI 5 on Tailwind CSS v4: ready-made components (cards, buttons, badges) with themes',
    filename: 'src/main.ts',
    code: vanillaApp('daisyUI', './style.css', (count) => `
  <main class="grid min-h-screen place-items-center bg-base-200 p-8">
    <div class="card w-96 bg-base-100 shadow-xl">
      <div class="card-body">
        <h1 class="card-title text-2xl">Hello from daisyUI <span class="badge badge-secondary">new</span></h1>
        <p>Edit <code>src/main.ts</code>: components restyle as you type.</p>
        <div class="card-actions justify-end">
          <button id="counter" class="btn btn-primary">Clicked ${count} times</button>
        </div>
      </div>
    </div>
  </main>`),
    files: {
      'index.html': html('daisyUI app', '/src/main.ts').replace('<html lang="en">', '<html lang="en" data-theme="dark">'),
      'src/style.css': `@import "tailwindcss";
@plugin "daisyui";
`,
      'vite.config.ts': `import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss()],
});
`,
      'tsconfig.json': tsconfig(),
      'package.json': pkg('daisyui-app', viteScripts, {}, { daisyui: '^5.0.0', tailwindcss: '^4.1.0', '@tailwindcss/vite': '^4.1.0', typescript: TS, vite: VITE }),
    },
  },
  {
    id: 'css-unocss',
    name: 'UnoCSS',
    description: 'UnoCSS: instant on-demand atomic CSS with Tailwind-compatible utilities and attributify mode',
    filename: 'src/main.ts',
    code: vanillaApp('UnoCSS', 'virtual:uno.css', (count) => `
  <main class="min-h-screen grid place-items-center bg-zinc-950 text-zinc-100 p-8 font-sans">
    <div class="max-w-md rounded-2xl border border-zinc-800 p-8">
      <h1 class="text-3xl font-bold m-0">Hello from UnoCSS</h1>
      <p class="text-zinc-400 mt-2">Edit <code>src/main.ts</code>: utilities are generated on demand.</p>
      <button id="counter" class="mt-6 w-full rounded-xl bg-amber-400 text-zinc-950 py-2.5 font-medium border-none cursor-pointer hover:bg-amber-300">Clicked ${count} times</button>
    </div>
  </main>`),
    files: {
      'index.html': html('UnoCSS app', '/src/main.ts'),
      'uno.config.ts': `import { defineConfig, presetWind3 } from 'unocss';

export default defineConfig({
  presets: [presetWind3()],
});
`,
      'vite.config.ts': `import UnoCSS from 'unocss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [UnoCSS()],
});
`,
      'tsconfig.json': tsconfig(),
      'package.json': pkg('unocss-app', viteScripts, {}, { unocss: '^66.0.0', typescript: TS, vite: VITE }),
    },
  },
  {
    id: 'css-bootstrap',
    name: 'Bootstrap',
    description: 'Bootstrap 5: the grid, components and utilities, with its dark color mode',
    filename: 'src/main.ts',
    code: vanillaApp('Bootstrap', 'bootstrap/dist/css/bootstrap.min.css', (count) => `
  <main class="container py-5">
    <div class="row justify-content-center">
      <div class="col-md-6">
        <div class="card shadow">
          <div class="card-body p-4">
            <h1 class="h3 card-title">Hello from Bootstrap <span class="badge text-bg-primary">5</span></h1>
            <p class="text-body-secondary">Edit <code>src/main.ts</code> and the preview updates as you type.</p>
            <ul class="list-group mb-3">${FEATURES.map((f) => `<li class="list-group-item">${f}</li>`).join('')}</ul>
            <button id="counter" class="btn btn-primary w-100">Clicked ${count} times</button>
          </div>
        </div>
      </div>
    </div>
  </main>`),
    files: {
      'index.html': html('Bootstrap app', '/src/main.ts').replace('<html lang="en">', '<html lang="en" data-bs-theme="dark">'),
      'tsconfig.json': tsconfig(),
      'package.json': pkg('bootstrap-app', viteScripts, { bootstrap: '^5.3.3' }, { typescript: TS, vite: VITE }),
    },
  },
  {
    id: 'css-bulma',
    name: 'Bulma',
    description: 'Bulma 1: a modern, class-based CSS framework with no JavaScript, in dark mode',
    filename: 'src/main.ts',
    code: vanillaApp('Bulma', 'bulma/css/bulma.min.css', (count) => `
  <section class="section">
    <div class="container" style="max-width: 32rem">
      <div class="box">
        <h1 class="title">Hello from Bulma</h1>
        <p class="subtitle is-6">Edit <code>src/main.ts</code> and the preview updates as you type.</p>
        <div class="tags">${FEATURES.map((f) => `<span class="tag is-info is-light">${f}</span>`).join('')}</div>
        <button id="counter" class="button is-primary is-fullwidth">Clicked ${count} times</button>
      </div>
    </div>
  </section>`),
    files: {
      'index.html': html('Bulma app', '/src/main.ts').replace('<html lang="en">', '<html lang="en" data-theme="dark">'),
      'tsconfig.json': tsconfig(),
      'package.json': pkg('bulma-app', viteScripts, { bulma: '^1.0.2' }, { typescript: TS, vite: VITE }),
    },
  },
  {
    id: 'css-pico',
    name: 'Pico CSS',
    description: 'Pico CSS: classless, semantic HTML that looks good with no classes at all',
    filename: 'src/main.ts',
    code: vanillaApp('Pico', '@picocss/pico/css/pico.min.css', (count) => `
  <main class="container">
    <article>
      <header><h1>Hello from Pico</h1></header>
      <p>Plain HTML, styled: edit <code>src/main.ts</code> and the preview updates as you type.</p>
      <ul>${FEATURES.map((f) => `<li>${f}</li>`).join('')}</ul>
      <footer><button id="counter">Clicked ${count} times</button></footer>
    </article>
  </main>`),
    files: {
      'index.html': html('Pico app', '/src/main.ts').replace('<html lang="en">', '<html lang="en" data-theme="dark">'),
      'tsconfig.json': tsconfig(),
      'package.json': pkg('pico-app', viteScripts, { '@picocss/pico': '^2.0.6' }, { typescript: TS, vite: VITE }),
    },
  },
  {
    id: 'css-sass',
    name: 'Sass (SCSS)',
    description: 'Sass with variables, mixins, nesting and partials (@use), compiled as you type',
    filename: 'src/style.scss',
    code: `@use 'tokens' as t;

@mixin card {
  background: t.$surface;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: t.$radius;
  padding: 2rem;
}

body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: t.$background;
  color: t.$text;
  font-family: ui-sans-serif, system-ui, sans-serif;
}

main {
  @include card;
  max-width: 28rem;

  h1 {
    margin: 0 0 0.5rem;
    color: t.$accent;
  }

  button {
    margin-top: 1.5rem;
    width: 100%;
    padding: 0.7rem;
    border: 0;
    border-radius: t.$radius * 0.5;
    background: t.$accent;
    font: inherit;
    cursor: pointer;

    &:hover {
      filter: brightness(1.1);
    }
  }
}
`,
    files: {
      'index.html': html('Sass app', '/src/main.ts'),
      'src/_tokens.scss': `// Design tokens: change one and every rule that uses it follows
$background: #0f1117;
$surface: #171a23;
$text: #e6e8ee;
$accent: #f472b6;
$radius: 1rem;
`,
      'src/main.ts': vanillaApp('Sass', './style.scss', (count) => `
  <main>
    <h1>Hello from Sass</h1>
    <p>Edit <code>src/style.scss</code> or <code>src/_tokens.scss</code>: the styles recompile as you type.</p>
    <button id="counter">Clicked ${count} times</button>
  </main>`),
      'tsconfig.json': tsconfig(),
      'package.json': pkg('sass-app', viteScripts, {}, { sass: '^1.80.0', typescript: TS, vite: VITE }),
    },
  },
  {
    id: 'css-less',
    name: 'Less',
    description: 'Less with variables, mixins and nesting, compiled as you type',
    filename: 'src/style.less',
    code: `@background: #0e1116;
@surface: #161b22;
@accent: #7dd3fc;
@radius: 14px;

.card() {
  background: @surface;
  border-radius: @radius;
  padding: 2rem;
  border: 1px solid fade(#fff, 8%);
}

body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: @background;
  color: #e6edf3;
  font-family: ui-sans-serif, system-ui, sans-serif;
}

main {
  .card();
  max-width: 28rem;
  h1 { margin: 0 0 0.5rem; color: @accent; }
  button {
    margin-top: 1.5rem; width: 100%; padding: 0.7rem; border: 0; cursor: pointer; font: inherit;
    border-radius: (@radius / 2);
    background: @accent;
    &:hover { background: lighten(@accent, 8%); }
  }
}
`,
    files: {
      'index.html': html('Less app', '/src/main.ts'),
      'src/main.ts': vanillaApp('Less', './style.less', (count) => `
  <main>
    <h1>Hello from Less</h1>
    <p>Edit <code>src/style.less</code>: the styles recompile as you type.</p>
    <button id="counter">Clicked ${count} times</button>
  </main>`),
      'tsconfig.json': tsconfig(),
      'package.json': pkg('less-app', viteScripts, {}, { less: '^4.2.0', typescript: TS, vite: VITE }),
    },
  },
  {
    id: 'css-modules',
    name: 'CSS Modules (React)',
    description: 'CSS Modules with React: class names scoped to their component, no clashes',
    filename: 'src/Counter.module.css',
    code: `/* These classes belong to Counter.tsx only: the same name elsewhere won't clash */
.card {
  max-width: 26rem;
  padding: 2rem;
  border-radius: 1rem;
  background: #161922;
  border: 1px solid #262b38;
}

.title {
  margin: 0 0 0.5rem;
  color: #a5b4fc;
}

.button {
  margin-top: 1.5rem;
  width: 100%;
  padding: 0.7rem;
  border: 0;
  border-radius: 0.6rem;
  background: #a5b4fc;
  color: #0b0d12;
  font: inherit;
  cursor: pointer;
}
`,
    files: {
      'index.html': html('CSS Modules app', '/src/main.tsx', '<div id="root"></div>'),
      'src/main.tsx': reactMain('./global.css'),
      'src/global.css': `body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0d12; color: #e8eaf0; font-family: ui-sans-serif, system-ui, sans-serif; }
`,
      'src/App.tsx': `import { Counter } from './Counter';

export function App() {
  return <Counter />;
}
`,
      'src/Counter.tsx': `import { useState } from 'react';
import styles from './Counter.module.css';

export function Counter() {
  const [count, setCount] = useState(0);
  return (
    <main className={styles.card}>
      <h1 className={styles.title}>Hello from CSS Modules</h1>
      <p>
        Edit <code>src/Counter.module.css</code>: its classes only apply here.
      </p>
      <button className={styles.button} onClick={() => setCount((c) => c + 1)}>
        Clicked {count} times
      </button>
    </main>
  );
}
`,
      'vite.config.ts': `import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
});
`,
      'tsconfig.json': tsconfig({ jsx: 'react-jsx' }),
      'package.json': pkg('css-modules-app', viteScripts, REACT, REACT_DEV),
    },
  },
];
