/**
 * NanoCLI Studio - Overview
 * Numbers on this page were measured on Linux x64 with scriptc 0.2.2 and Node.js 22.
 */

import Link from 'next/link';
import { ByteField } from '@/components/ByteField';
import { SiteFooter, SiteHeader } from '@/components/SiteHeader';
import { TEMPLATES } from '@/lib/templates';

const STATS = [
  { value: '55 KB', label: 'Hello-world executable', detail: 'stripped, statically linked runtime' },
  { value: '1.2 ms', label: 'Process startup', detail: 'vs ~30 ms for the same script on Node.js' },
  { value: '0', label: 'Runtime dependencies', detail: 'no Node, no V8, no JS engine in the binary' },
  { value: '<1 s', label: 'Typical build', detail: 'cached runtime objects, incremental linking' },
];

const STEPS = [
  { title: 'Write', body: 'Start from a template or import a repository. IntelliSense resolves imports across your files.' },
  { title: 'Run', body: 'Type run in the terminal. Your program executes as WASM right here, reading and writing project files.' },
  { title: 'Ship', body: 'Press ⌘↵ for a native executable. Download one file — it runs with no runtime installed.' },
];

const FAQ = [
  {
    q: 'What is scriptc?',
    a: 'An open-source compiler from Vercel Labs that turns TypeScript and JavaScript into native executables or WASI modules via LLVM, without bundling a JavaScript engine.',
  },
  {
    q: 'Which platforms can I build for?',
    a: 'Native executables are linked for the machine the studio runs on (Linux x64 in the default Docker image). WASM output runs anywhere with a WASI runtime such as Wasmtime or Node.',
  },
  {
    q: 'Does every npm package work?',
    a: 'Not yet. scriptc compiles a growing static subset of TypeScript and Node APIs. Run “Check coverage” to see what blocks a program, or opt into its embedded dynamic engine locally with --dynamic.',
  },
  {
    q: 'Does the AI assistant cost anything?',
    a: 'Not from us. Bring a free Gemini, Groq or OpenRouter key, or run a model locally with Ollama. Keys stay in your browser.',
  },
];

function Terminal() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background font-mono text-[13px] leading-6">
      <div className="px-4 py-3">
        <div><span className="text-accent">$</span> <span className="text-gray-100">scriptc build hello.ts -o hello --strip</span></div>
        <div className="text-gray-500">compiled in 0.4 s</div>
        <div><span className="text-accent">$</span> <span className="text-gray-100">ls -lh hello</span></div>
        <div className="text-gray-400">-rwxr-xr-x  55K  hello</div>
        <div><span className="text-accent">$</span> <span className="text-gray-100">./hello Vercel</span></div>
        <div className="text-gray-50">Hello, Vercel!</div>
      </div>
    </div>
  );
}

function ProductFrame() {
  return (
    <div className="relative mx-auto mt-14 max-w-6xl">
      <div aria-hidden="true" className="absolute -inset-x-6 -top-10 bottom-10 -z-10 bg-[radial-gradient(50%_60%_at_50%_0%,var(--accent-soft),transparent)]" />
      <div className="overflow-hidden rounded-xl border border-border-strong bg-[var(--panel)] shadow-[0_40px_120px_-40px_rgb(0_0_0/0.8)]">
        <div className="flex items-center gap-2 border-b border-border bg-[var(--bar)] px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-gray-700" />
          <span className="h-2.5 w-2.5 rounded-full bg-gray-700" />
          <span className="h-2.5 w-2.5 rounded-full bg-gray-700" />
          <span className="ml-3 font-mono text-xs text-gray-500">localhost:3000</span>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- static product screenshot */}
        <img src="/workspace.png" alt="The NanoCLI Studio workspace: file explorer, editor, build panel and terminal" width={1440} height={900} className="block w-full" />
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader active="/landing">
        <Link href="/" className="btn btn-primary btn-sm">Open editor</Link>
      </SiteHeader>

      {/* Hero */}
      <section id="main" className="relative overflow-hidden">
        <div aria-hidden="true" className="absolute inset-0 [mask-image:radial-gradient(70%_80%_at_50%_0%,black,transparent)]">
          <ByteField intensity="hero" />
        </div>
        <div className="relative mx-auto max-w-6xl px-4 pt-20 pb-20 md:pt-28">
          <a href="https://scriptc.dev" className="badge mb-8 transition-colors hover:text-gray-100 animate-fade-in">
            <span className="dot text-accent" aria-hidden="true" />
            Compiled by scriptc from Vercel Labs
          </a>
          <h1 className="display max-w-4xl text-[clamp(2.75rem,7.5vw,5.75rem)] text-gray-100 animate-fade-in">
            TypeScript in.
            <br />
            <span className="text-accent">Binary out.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-gray-300">
            Write a command-line tool in your browser, run it right in the tab, and download one native
            executable that starts in about a millisecond and needs no runtime.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/" className="btn btn-primary h-11 px-6 text-[15px]">Open the workspace</Link>
            <Link href="/?template=modular-cli" className="btn btn-secondary h-11 px-6 text-[15px]">Try a multi-file CLI</Link>
          </div>
          <ProductFrame />
        </div>
      </section>

      {/* Stats */}
      <section className="mx-auto max-w-6xl px-4">
        <dl className="grid grid-cols-2 border-y border-border lg:grid-cols-4">
          {STATS.map((stat, i) => (
            <div key={stat.label} className={`px-1 py-8 lg:px-6 ${i ? 'lg:border-l lg:border-border' : ''} ${i % 2 ? 'pl-6 border-l border-border lg:pl-6' : ''}`}>
              <dd className="font-mono text-4xl tracking-tight text-gray-100">{stat.value}</dd>
              <dt className="mt-2 text-sm font-medium text-gray-200">{stat.label}</dt>
              <dd className="mt-1 text-xs text-gray-400">{stat.detail}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-gray-500">Measured on Linux x64 with scriptc 0.2.2 and Node.js 22.</p>
      </section>

      {/* Features: bento */}
      <section id="features" className="mx-auto max-w-6xl px-4 py-24">
        <div className="max-w-2xl">
          <div className="eyebrow text-accent">Features</div>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">Everything between an idea and a binary.</h2>
        </div>
        <div className="mt-12 grid gap-3 md:grid-cols-3">
          <div className="surface p-6 md:col-span-2">
            <h3 className="text-lg font-medium text-gray-100">Run it in the tab</h3>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-gray-400">
              The terminal compiles your project to WebAssembly and executes it in a worker — with your files mounted and
              output streaming live. Press Compile when you want the real native binary.
            </p>
            <div className="mt-6"><Terminal /></div>
          </div>
          <div className="surface flex flex-col p-6">
            <h3 className="text-lg font-medium text-gray-100">Free AI, any model</h3>
            <p className="mt-2 text-sm leading-relaxed text-gray-400">
              Bring a free Gemini, Groq or OpenRouter key — or run Ollama locally. The assistant reads your project and the
              compiler’s errors, then explains, fixes and writes tests you can apply in one click.
            </p>
            <div className="mt-auto flex flex-wrap gap-1.5 pt-6">
              {['Gemini', 'Groq', 'OpenRouter', 'Ollama', 'Anthropic', 'OpenAI'].map((name) => (
                <span key={name} className="badge">{name}</span>
              ))}
            </div>
          </div>
          {[
            { title: 'Real projects', body: 'A file tree with folders, relative imports between files, split editors and an import graph that flags cycles and dead files.' },
            { title: 'Git without leaving', body: 'Pull a branch, review every change as a side-by-side diff, and push multi-file commits that never overwrite a teammate.' },
            { title: 'Errors where you type', body: 'scriptc diagnostics land inline with a rewrite hint. Coverage analysis shows what compiles statically and what blocks the rest.' },
          ].map((feature) => (
            <div key={feature.title} className="surface p-6 transition-colors hover:border-border-strong">
              <h3 className="font-medium text-gray-100">{feature.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-400">{feature.body}</p>
            </div>
          ))}
          <div className="surface p-6 md:col-span-3">
            <h3 className="font-medium text-gray-100">Yours to shape</h3>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-400">
              Command palette, remappable shortcuts, Prettier on save, version history, zen mode, and light, dark and
              high-contrast themes.
            </p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 pb-24">
        <div className="eyebrow text-accent">How it works</div>
        <ol className="mt-6 grid gap-8 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="border-t border-border-strong pt-5">
              <div className="font-mono text-sm text-accent">0{i + 1}</div>
              <h3 className="mt-3 text-xl font-medium text-gray-100">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-400">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Templates */}
      <section className="mx-auto max-w-6xl px-4 pb-24">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="eyebrow text-accent">Templates</div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">Start from a working program.</h2>
          </div>
          <Link href="/" className="btn btn-ghost">Browse in the editor →</Link>
        </div>
        <div className="mt-8 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {TEMPLATES.map((template) => (
            <Link
              key={template.id}
              href={`/?template=${template.id}`}
              className="group bg-[var(--raised)] p-4 transition-colors hover:bg-[var(--smoke-strong)]"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-100 group-hover:text-accent">{template.name}</span>
                <span className="font-mono text-xs text-gray-500">{template.filename}</span>
              </div>
              <p className="mt-1.5 text-sm text-gray-400">{template.description}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-6xl px-4 pb-24">
        <div className="grid gap-10 lg:grid-cols-[1fr_2fr]">
          <div>
            <div className="eyebrow text-accent">FAQ</div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">Questions, answered.</h2>
            <Link href="/faq" className="btn btn-ghost mt-4 -ml-3">All questions →</Link>
          </div>
          <div className="divide-y divide-border border-y border-border">
            {FAQ.map((item) => (
              <details key={item.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between font-medium text-gray-100">
                  {item.q}
                  <span className="text-gray-500 transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-gray-400">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-24">
        <div className="relative overflow-hidden rounded-2xl border border-border-strong bg-[var(--raised)] px-6 py-16 text-center">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(40rem_16rem_at_50%_0%,var(--accent-soft),transparent)]" />
          <h2 className="display relative text-4xl text-gray-100 md:text-5xl">Your first binary, in a minute.</h2>
          <p className="relative mt-4 text-gray-400">No sign-up needed. Open the workspace and type run.</p>
          <Link href="/" className="btn btn-primary relative mt-8 h-11 px-6 text-[15px]">Open the workspace</Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
