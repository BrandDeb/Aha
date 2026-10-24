/**
 * Starters for web frameworks. Each is the smallest real project its
 * framework accepts: a page with a heading, a counter (so hot reload keeping
 * state is visible) and a line naming the file to edit. Versions are the
 * newest majors that still run on Node.js 22 LTS. All of them run with their
 * own dev server in the Preview pane.
 */

export interface WebStarter {
  id: string;
  name: string;
  description: string;
  /** The file to open first */
  filename: string;
  code: string;
  files: Record<string, string>;
}

/** What every starter's page says, so tests can check that it rendered */
export const WEB_STARTER_TEXT = 'Edit';

const CSS = `:root {
  color-scheme: dark;
  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  background: #0b0d12;
  color: #e8eaf0;
}
body { margin: 0; min-height: 100vh; display: grid; place-items: center; }
main { text-align: center; padding: 2rem; }
h1 { font-size: 2.5rem; letter-spacing: -0.02em; margin: 0 0 0.75rem; }
p { color: #9aa3b2; line-height: 1.6; }
button {
  font: inherit; padding: 0.6rem 1.2rem; border-radius: 0.6rem; cursor: pointer;
  border: 1px solid #2c3442; background: #151a23; color: inherit;
}
button:hover { border-color: #4f8cff; }
code { background: #151a23; padding: 0.15rem 0.4rem; border-radius: 0.35rem; font-size: 0.9em; }
`;

export const VITE = '^8.3.4';
export const TS = '~6.0.3';

export const pkg = (name: string, scripts: Record<string, string>, dependencies: Record<string, string>, devDependencies: Record<string, string>, extra: Record<string, unknown> = {}) =>
  `${JSON.stringify({ name, private: true, version: '0.0.0', type: 'module', scripts, ...(Object.keys(dependencies).length ? { dependencies } : {}), devDependencies, ...extra }, null, 2)}\n`;

export const viteScripts = { dev: 'vite', build: 'vite build', preview: 'vite preview' };

export const html = (title: string, script: string, root = '<div id="app"></div>') => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
  </head>
  <body>
    ${root}
    <script type="module" src="${script}"></script>
  </body>
</html>
`;

export const tsconfig = (jsx?: Record<string, string>) =>
  `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        module: 'ESNext',
        moduleResolution: 'bundler',
        types: ['vite/client'],
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        isolatedModules: true,
        ...(jsx ?? {}),
      },
      include: ['src'],
    },
    null,
    2
  )}\n`;

const REACT_APP = `import { useState } from 'react';

export function App() {
  const [count, setCount] = useState(0);
  return (
    <main>
      <h1>Hello from React</h1>
      <p>
        Edit <code>src/App.tsx</code> and the preview updates as you type.
      </p>
      <button onClick={() => setCount((c) => c + 1)}>Clicked {count} times</button>
    </main>
  );
}
`;


const DAPP_APP = `import { useEffect, useState } from 'react';
import { useConnect, useConnection, useConnectors, useDisconnect, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { counterAbi } from './abi';
import { config } from './wagmi';

const SAVED = 'counter-address';

export function App() {
  const { address, isConnected, chainId } = useConnection();
  const connectors = useConnectors();
  const { connect, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const [contract, setContract] = useState(() => localStorage.getItem(SAVED) ?? '');
  const valid = /^0x[0-9a-fA-F]{40}$/.test(contract);
  const supported = config.chains.some((c) => c.id === chainId);

  const number = useReadContract({ address: valid ? (contract as \`0x\${string}\`) : undefined, abi: counterAbi, functionName: 'number', query: { enabled: valid && supported } });
  const write = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: write.data });
  const { refetch } = number;
  // Read the new value once the transaction is mined (a single eth_call)
  useEffect(() => {
    if (receipt.isSuccess) void refetch();
  }, [receipt.isSuccess, refetch]);

  return (
    <main>
      <h1>Counter dapp</h1>
      {!isConnected ? (
        <section>
          {connectors.map((c) => (
            <button key={c.uid} onClick={() => connect({ connector: c })}>Connect {c.name}</button>
          ))}
          {connectError && <p className="error">{connectError.message}</p>}
          <p className="hint">No wallet? Use the studio's Deploy &amp; run panel: it has a chain in the page.</p>
        </section>
      ) : (
        <section>
          <p>
            {address?.slice(0, 6)}…{address?.slice(-4)} on {config.chains.find((c) => c.id === chainId)?.name ?? \`chain \${chainId}\`}{' '}
            <button onClick={() => disconnect()}>Disconnect</button>
          </p>
          {!supported && (
            <p className="error">
              Wrong network. <button onClick={() => switchChain({ chainId: config.chains[0].id })}>Switch to {config.chains[0].name}</button>
            </p>
          )}
          <label>
            Contract address
            <input
              value={contract}
              onChange={(e) => {
                setContract(e.target.value.trim());
                localStorage.setItem(SAVED, e.target.value.trim());
              }}
              placeholder="0x… (deploy contracts/Counter.sol with Deploy & run → Browser wallet)"
            />
          </label>
          {valid && (
            <>
              <p className="big">{number.isLoading ? '…' : number.error ? 'Not a Counter on this network' : String(number.data ?? '')}</p>
              <button disabled={write.isPending || receipt.isLoading} onClick={() => write.writeContract({ address: contract as \`0x\${string}\`, abi: counterAbi, functionName: 'increment' })}>
                {write.isPending ? 'Confirm in your wallet…' : receipt.isLoading ? 'Waiting for the block…' : 'Increment'}
              </button>
              {write.error && <p className="error">{write.error.message.split('\\n')[0]}</p>}
              {receipt.isSuccess && <p className="hint">Mined in block {String(receipt.data.blockNumber)}.</p>}
            </>
          )}
        </section>
      )}
    </main>
  );
}
`;

const DAPP_CONTRACT = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The contract the front end talks to. Compile and deploy it in the studio's Deploy & run panel.
contract Counter {
    uint256 public number;

    event Incremented(address indexed by, uint256 number);

    function increment() external {
        number += 1;
        emit Incremented(msg.sender, number);
    }

    function setNumber(uint256 newNumber) external {
        number = newNumber;
    }
}
`;

export const WEB_STARTERS: WebStarter[] = [
  {
    id: 'web-dapp',
    name: 'Dapp (Solidity + React + wagmi)',
    description: 'A smart contract and the React front end that talks to it through the browser wallet: wagmi and viem, connect, read, write, wait for the block',
    filename: 'src/App.tsx',
    code: DAPP_APP,
    files: {
      'contracts/Counter.sol': DAPP_CONTRACT,
      'index.html': html('Counter dapp', '/src/main.tsx', '<div id="root"></div>'),
      'src/main.tsx': `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { App } from './App';
import { config } from './wagmi';
import './style.css';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>
);
`,
      'src/wagmi.ts': `import { createConfig, http, injected } from 'wagmi';
import { foundry, sepolia } from 'wagmi/chains';

/** Sepolia for testing in public, Foundry's Anvil (chain 31337, http://127.0.0.1:8545) for local work */
export const config = createConfig({
  chains: [sepolia, foundry],
  connectors: [injected()],
  transports: { [sepolia.id]: http(), [foundry.id]: http() },
});

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}
`,
      'src/abi.ts': `/** The Counter contract's ABI (as const, so reads and writes are fully typed) */
export const counterAbi = [
  { type: 'function', name: 'number', inputs: [], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'increment', inputs: [], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'setNumber', inputs: [{ name: 'newNumber', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'event', name: 'Incremented', inputs: [{ name: 'by', type: 'address', indexed: true }, { name: 'number', type: 'uint256', indexed: false }], anonymous: false },
] as const;
`,
      'src/style.css': `${CSS}
section { display: grid; gap: 0.75rem; justify-items: center; }
label { display: grid; gap: 0.25rem; font-size: 0.85rem; width: min(30rem, 100%); }
input { padding: 0.5rem; border-radius: 0.5rem; border: 1px solid #8884; font: inherit; }
.big { font-size: 3rem; font-weight: 700; margin: 0.5rem 0; }
.error { color: #e5484d; }
.hint { opacity: 0.6; font-size: 0.85rem; }
`,
      'vite.config.ts': `import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
});
`,
      'tsconfig.json': tsconfig({ jsx: 'react-jsx' }),
      'package.json': pkg('counter-dapp', viteScripts, { react: '^19.3.1', 'react-dom': '^19.3.1', wagmi: '^3.7.9', viem: '^2.57.10', '@tanstack/react-query': '^5.104.5' }, { '@types/react': '^19.3.0', '@types/react-dom': '^19.3.0', '@vitejs/plugin-react': '^6.1.2', typescript: TS, vite: VITE }),
    },
  },

  {
    id: 'web-react',
    name: 'React (Vite)',
    description: 'React 19 with TypeScript, served by Vite with instant hot reload',
    filename: 'src/App.tsx',
    code: REACT_APP,
    files: {
      'index.html': html('React app', '/src/main.tsx', '<div id="root"></div>'),
      'src/main.tsx': `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './style.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
`,
      'src/style.css': CSS,
      'vite.config.ts': `import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
});
`,
      'tsconfig.json': tsconfig({ jsx: 'react-jsx' }),
      'package.json': pkg('react-app', viteScripts, { react: '^19.3.1', 'react-dom': '^19.3.1' }, { '@types/react': '^19.3.0', '@types/react-dom': '^19.3.0', '@vitejs/plugin-react': '^6.1.2', typescript: TS, vite: VITE }),
    },
  },
  {
    id: 'web-vue',
    name: 'Vue (Vite)',
    description: 'Vue 3 single-file components with TypeScript, served by Vite',
    filename: 'src/App.vue',
    code: `<script setup lang="ts">
import { ref } from 'vue';

const count = ref(0);
</script>

<template>
  <main>
    <h1>Hello from Vue</h1>
    <p>Edit <code>src/App.vue</code> and the preview updates as you type.</p>
    <button @click="count++">Clicked {{ count }} times</button>
  </main>
</template>
`,
    files: {
      'index.html': html('Vue app', '/src/main.ts'),
      'src/main.ts': `import { createApp } from 'vue';
import App from './App.vue';
import './style.css';

createApp(App).mount('#app');
`,
      'src/env.d.ts': `/// <reference types="vite/client" />\n`,
      'src/style.css': CSS,
      'vite.config.ts': `import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
});
`,
      'tsconfig.json': tsconfig({ jsx: 'preserve' }),
      'package.json': pkg('vue-app', viteScripts, { vue: '^3.5.44' }, { '@vitejs/plugin-vue': '^6.0.10', typescript: TS, vite: VITE }),
    },
  },
  {
    id: 'web-svelte',
    name: 'Svelte (Vite)',
    description: 'Svelte 5 with runes and TypeScript, served by Vite',
    filename: 'src/App.svelte',
    code: `<script lang="ts">
  let count = $state(0);
</script>

<main>
  <h1>Hello from Svelte</h1>
  <p>Edit <code>src/App.svelte</code> and the preview updates as you type.</p>
  <button onclick={() => count++}>Clicked {count} times</button>
</main>
`,
    files: {
      'index.html': html('Svelte app', '/src/main.ts'),
      'src/main.ts': `import { mount } from 'svelte';
import App from './App.svelte';
import './style.css';

export default mount(App, { target: document.getElementById('app')! });
`,
      'src/style.css': CSS,
      'svelte.config.js': `/** @type {import("@sveltejs/vite-plugin-svelte").SvelteConfig} */
export default {};
`,
      'vite.config.ts': `import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte()],
});
`,
      'tsconfig.json': tsconfig(),
      'package.json': pkg('svelte-app', viteScripts, {}, { '@sveltejs/vite-plugin-svelte': '^7.3.1', svelte: '^5.57.2', typescript: TS, vite: VITE }),
    },
  },
  {
    id: 'web-solid',
    name: 'Solid (Vite)',
    description: 'SolidJS fine-grained reactivity with TypeScript, served by Vite',
    filename: 'src/App.tsx',
    code: `import { createSignal } from 'solid-js';

export function App() {
  const [count, setCount] = createSignal(0);
  return (
    <main>
      <h1>Hello from Solid</h1>
      <p>
        Edit <code>src/App.tsx</code> and the preview updates as you type.
      </p>
      <button onClick={() => setCount(count() + 1)}>Clicked {count()} times</button>
    </main>
  );
}
`,
    files: {
      'index.html': html('Solid app', '/src/index.tsx'),
      'src/index.tsx': `import { render } from 'solid-js/web';
import { App } from './App';
import './style.css';

render(() => <App />, document.getElementById('app')!);
`,
      'src/style.css': CSS,
      'vite.config.ts': `import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
});
`,
      'tsconfig.json': tsconfig({ jsx: 'preserve', jsxImportSource: 'solid-js' }),
      'package.json': pkg('solid-app', viteScripts, { 'solid-js': '^1.9.17' }, { typescript: TS, vite: VITE, 'vite-plugin-solid': '^2.11.14' }),
    },
  },
  {
    id: 'web-preact',
    name: 'Preact (Vite)',
    description: 'Preact, the 4 kB React alternative, with TypeScript and Vite',
    filename: 'src/app.tsx',
    code: `import { useState } from 'preact/hooks';

export function App() {
  const [count, setCount] = useState(0);
  return (
    <main>
      <h1>Hello from Preact</h1>
      <p>
        Edit <code>src/app.tsx</code> and the preview updates as you type.
      </p>
      <button onClick={() => setCount(count + 1)}>Clicked {count} times</button>
    </main>
  );
}
`,
    files: {
      'index.html': html('Preact app', '/src/main.tsx'),
      'src/main.tsx': `import { render } from 'preact';
import { App } from './app';
import './style.css';

render(<App />, document.getElementById('app')!);
`,
      'src/style.css': CSS,
      'vite.config.ts': `import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [preact()],
});
`,
      'tsconfig.json': tsconfig({ jsx: 'react-jsx', jsxImportSource: 'preact' }),
      'package.json': pkg('preact-app', viteScripts, { preact: '^10.29.8' }, { '@preact/preset-vite': '^2.10.6', typescript: TS, vite: VITE }),
    },
  },
  {
    id: 'web-vanilla',
    name: 'Vanilla TypeScript (Vite)',
    description: 'No framework: TypeScript and the DOM, served by Vite',
    filename: 'src/main.ts',
    code: `import './style.css';

let count = 0;
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = \`
  <main>
    <h1>Hello from Vite</h1>
    <p>Edit <code>src/main.ts</code> and the preview updates as you type.</p>
    <button id="counter">Clicked 0 times</button>
  </main>
\`;

const button = app.querySelector<HTMLButtonElement>('#counter')!;
button.addEventListener('click', () => {
  count++;
  button.textContent = \`Clicked \${count} times\`;
});
`,
    files: {
      'index.html': html('Vite app', '/src/main.ts'),
      'src/style.css': CSS,
      'tsconfig.json': tsconfig(),
      'package.json': pkg('vite-app', viteScripts, {}, { typescript: TS, vite: VITE }),
    },
  },
  {
    id: 'web-next',
    name: 'Next.js',
    description: 'Next.js 16 App Router with React Server Components',
    filename: 'app/page.tsx',
    code: `import { Counter } from './counter';

export default function Home() {
  return (
    <main>
      <h1>Hello from Next.js</h1>
      <p>
        Edit <code>app/page.tsx</code> and the preview updates as you type.
      </p>
      <Counter />
    </main>
  );
}
`,
    files: {
      'app/counter.tsx': `'use client';

import { useState } from 'react';

export function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount((c) => c + 1)}>Clicked {count} times</button>;
}
`,
      'app/layout.tsx': `import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Next.js app' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
      'app/globals.css': CSS,
      'next.config.ts': `import type { NextConfig } from 'next';

const nextConfig: NextConfig = {};

export default nextConfig;
`,
      'tsconfig.json': `${JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2017',
            lib: ['dom', 'dom.iterable', 'esnext'],
            allowJs: true,
            skipLibCheck: true,
            strict: true,
            noEmit: true,
            esModuleInterop: true,
            module: 'esnext',
            moduleResolution: 'bundler',
            resolveJsonModule: true,
            isolatedModules: true,
            jsx: 'react-jsx',
            incremental: true,
            plugins: [{ name: 'next' }],
            paths: { '@/*': ['./*'] },
          },
          include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts', '.next/dev/types/**/*.ts'],
          exclude: ['node_modules'],
        },
        null,
        2
      )}\n`,
      'package.json': pkg('next-app', { dev: 'next dev', build: 'next build', start: 'next start' }, { next: '16.4.2', react: '19.3.0', 'react-dom': '19.3.0' }, { '@types/node': '^22', '@types/react': '^19', '@types/react-dom': '^19', typescript: '^5' }),
    },
  },
  {
    id: 'web-nuxt',
    name: 'Nuxt',
    description: 'Nuxt 4: Vue with file-based routing and server rendering',
    filename: 'app/app.vue',
    code: `<script setup lang="ts">
const count = ref(0);
</script>

<template>
  <main>
    <h1>Hello from Nuxt</h1>
    <p>Edit <code>app/app.vue</code> and the preview updates as you type.</p>
    <button @click="count++">Clicked {{ count }} times</button>
  </main>
</template>

<style>
${CSS}</style>
`,
    files: {
      'nuxt.config.ts': `// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
});
`,
      'tsconfig.json': `${JSON.stringify({ files: [], references: [{ path: './.nuxt/tsconfig.app.json' }, { path: './.nuxt/tsconfig.server.json' }, { path: './.nuxt/tsconfig.shared.json' }, { path: './.nuxt/tsconfig.node.json' }] }, null, 2)}\n`,
      'package.json': pkg('nuxt-app', { dev: 'nuxt dev', build: 'nuxt build', preview: 'nuxt preview', postinstall: 'nuxt prepare' }, { nuxt: '~4.5.2', vue: '^3.5.44', 'vue-router': '^5.4.0' }, {}),
    },
  },
  {
    id: 'web-sveltekit',
    name: 'SvelteKit',
    description: 'SvelteKit: Svelte with routing, server rendering and form actions',
    filename: 'src/routes/+page.svelte',
    code: `<script lang="ts">
  let count = $state(0);
</script>

<main>
  <h1>Hello from SvelteKit</h1>
  <p>Edit <code>src/routes/+page.svelte</code> and the preview updates as you type.</p>
  <button onclick={() => count++}>Clicked {count} times</button>
</main>
`,
    files: {
      'src/routes/+layout.svelte': `<script lang="ts">
  import '../app.css';

  let { children } = $props();
</script>

{@render children()}
`,
      'src/app.css': CSS,
      'src/app.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    %sveltekit.head%
  </head>
  <body data-sveltekit-preload-data="hover">
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
`,
      'src/app.d.ts': `// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {}
}

export {};
`,
      'vite.config.ts': `import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit({ adapter: adapter() })],
});
`,
      'tsconfig.json': `${JSON.stringify({ extends: '$app/tsconfig', compilerOptions: { strict: true }, include: ['src', 'vite.config.ts'] }, null, 2)}\n`,
      'package.json': pkg(
        'sveltekit-app',
        { dev: 'vite dev', build: 'vite build', preview: 'vite preview', prepare: "svelte-kit sync || echo ''" },
        {},
        { '@sveltejs/adapter-auto': '^8.0.0', '@sveltejs/kit': '^3.0.0', '@sveltejs/vite-plugin-svelte': '^7.2.0', svelte: '^5.57.1', typescript: TS, vite: VITE }
      ),
    },
  },
  {
    id: 'web-astro',
    name: 'Astro',
    description: 'Astro: content-first sites that ship zero JavaScript by default',
    filename: 'src/pages/index.astro',
    code: `---
import '../styles/global.css';
const title = 'Hello from Astro';
---

<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width" />
    <title>{title}</title>
  </head>
  <body>
    <main>
      <h1>{title}</h1>
      <p>Edit <code>src/pages/index.astro</code> and the preview updates as you type.</p>
      <button id="counter">Clicked 0 times</button>
    </main>
    <script>
      let count = 0;
      const button = document.getElementById('counter')!;
      button.addEventListener('click', () => {
        count++;
        button.textContent = \`Clicked \${count} times\`;
      });
    </script>
  </body>
</html>
`,
    files: {
      'src/styles/global.css': CSS,
      'astro.config.mjs': `// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({});
`,
      'tsconfig.json': `${JSON.stringify({ extends: 'astro/tsconfigs/strict', include: ['.astro/types.d.ts', '**/*'], exclude: ['dist'] }, null, 2)}\n`,
      'package.json': pkg('astro-app', { dev: 'astro dev', build: 'astro build', preview: 'astro preview' }, { astro: '^6.4.8' }, {}),
    },
  },
  {
    id: 'web-react-router',
    name: 'React Router (framework)',
    description: 'React Router 8 in framework mode: routes, loaders and server rendering',
    filename: 'app/routes/home.tsx',
    code: `import { useState } from 'react';

export function meta() {
  return [{ title: 'React Router app' }];
}

export default function Home() {
  const [count, setCount] = useState(0);
  return (
    <main>
      <h1>Hello from React Router</h1>
      <p>
        Edit <code>app/routes/home.tsx</code> and the preview updates as you type.
      </p>
      <button onClick={() => setCount((c) => c + 1)}>Clicked {count} times</button>
    </main>
  );
}
`,
    files: {
      'app/root.tsx': `import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import './app.css';

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}
`,
      'app/routes.ts': `import { type RouteConfig, index } from '@react-router/dev/routes';

export default [index('routes/home.tsx')] satisfies RouteConfig;
`,
      'app/app.css': CSS,
      'react-router.config.ts': `import type { Config } from '@react-router/dev/config';

export default {
  ssr: true,
} satisfies Config;
`,
      'vite.config.ts': `import { reactRouter } from '@react-router/dev/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [reactRouter()],
});
`,
      'tsconfig.json': `${JSON.stringify(
        {
          include: ['**/*', '**/.server/**/*', '**/.client/**/*', '.react-router/types/**/*'],
          compilerOptions: { lib: ['DOM', 'DOM.Iterable', 'ES2022'], types: ['node', 'vite/client'], target: 'ES2022', module: 'ES2022', moduleResolution: 'bundler', jsx: 'react-jsx', rootDirs: ['.', './.react-router/types'], esModuleInterop: true, verbatimModuleSyntax: true, noEmit: true, resolveJsonModule: true, skipLibCheck: true, strict: true },
        },
        null,
        2
      )}\n`,
      'package.json': pkg(
        'react-router-app',
        { dev: 'react-router dev', build: 'react-router build', start: 'react-router-serve ./build/server/index.js' },
        { '@react-router/node': '^8.5.0', '@react-router/serve': '^8.5.0', isbot: '^5.1.36', react: '^19.3.1', 'react-dom': '^19.3.1', 'react-router': '^8.5.0' },
        { '@react-router/dev': '^8.5.0', '@types/node': '^22', '@types/react': '^19.3.0', '@types/react-dom': '^19.3.0', typescript: '^5.9.3', vite: VITE }
      ),
    },
  },
  {
    id: 'web-angular',
    name: 'Angular',
    description: 'Angular 21 standalone components with signals',
    filename: 'src/app/app.ts',
    code: `import { Component, signal } from '@angular/core';

@Component({
  selector: 'app-root',
  template: \`
    <main>
      <h1>Hello from Angular</h1>
      <p>Edit <code>src/app/app.ts</code> and the preview updates as you type.</p>
      <button (click)="count.set(count() + 1)">Clicked {{ count() }} times</button>
    </main>
  \`,
})
export class App {
  protected readonly count = signal(0);
}
`,
    files: {
      'src/main.ts': `import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
`,
      'src/app/app.config.ts': `import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';

export const appConfig: ApplicationConfig = {
  providers: [provideBrowserGlobalErrorListeners()],
};
`,
      'src/index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Angular app</title>
    <base href="/" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <app-root></app-root>
  </body>
</html>
`,
      'src/styles.css': CSS,
      // npm 10 crashes resolving @angular/build's optional peers (vitest, jsdom…) without this; npm 11 does not need it
      '.npmrc': '# npm 10 cannot resolve the optional peer dependencies of @angular/build without this\nlegacy-peer-deps=true\n',
      'angular.json': `${JSON.stringify(
        {
          $schema: './node_modules/@angular/cli/lib/config/schema.json',
          version: 1,
          cli: { packageManager: 'npm', analytics: false },
          newProjectRoot: 'projects',
          projects: {
            app: {
              projectType: 'application',
              root: '',
              sourceRoot: 'src',
              prefix: 'app',
              architect: {
                build: {
                  builder: '@angular/build:application',
                  options: { browser: 'src/main.ts', tsConfig: 'tsconfig.app.json', styles: ['src/styles.css'] },
                  configurations: { production: { outputHashing: 'all' }, development: { optimization: false, extractLicenses: false, sourceMap: true } },
                  defaultConfiguration: 'production',
                },
                serve: {
                  builder: '@angular/build:dev-server',
                  configurations: { production: { buildTarget: 'app:build:production' }, development: { buildTarget: 'app:build:development' } },
                  defaultConfiguration: 'development',
                },
              },
            },
          },
        },
        null,
        2
      )}\n`,
      'tsconfig.json': `${JSON.stringify(
        {
          compileOnSave: false,
          compilerOptions: { strict: true, noImplicitOverride: true, noImplicitReturns: true, skipLibCheck: true, isolatedModules: true, experimentalDecorators: true, importHelpers: true, target: 'ES2022', module: 'preserve' },
          angularCompilerOptions: { strictInjectionParameters: true, strictInputAccessModifiers: true, strictTemplates: true },
          files: [],
          references: [{ path: './tsconfig.app.json' }],
        },
        null,
        2
      )}\n`,
      'tsconfig.app.json': `${JSON.stringify({ extends: './tsconfig.json', compilerOptions: { outDir: './out-tsc/app', types: [] }, include: ['src/**/*.ts'] }, null, 2)}\n`,
      'package.json': pkg(
        'angular-app',
        { ng: 'ng', start: 'ng serve', build: 'ng build' },
        { '@angular/common': '^21.2.0', '@angular/compiler': '^21.2.0', '@angular/core': '^21.2.0', '@angular/forms': '^21.2.0', '@angular/platform-browser': '^21.2.0', '@angular/router': '^21.2.0', rxjs: '~7.8.0', tslib: '^2.3.0' },
        { '@angular/build': '^21.2.27', '@angular/cli': '^21.2.27', '@angular/compiler-cli': '^21.2.0', typescript: '~5.9.2' }
      ),
    },
  },
];
