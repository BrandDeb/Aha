/**
 * NanoCLI Studio - Overview
 * Numbers on this page were measured on Linux x64 with scriptc 0.2.2 and Node.js 22.
 */

import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/SiteHeader';
import { TEMPLATES } from '@/lib/templates';

const STATS = [
  { value: '55 KB', label: 'Hello-world executable', detail: 'stripped, statically linked runtime' },
  { value: '1.2 ms', label: 'Process startup', detail: 'vs ~30 ms for the same script on Node.js' },
  { value: '0', label: 'Runtime dependencies', detail: 'no Node, no V8, no JS engine in the binary' },
  { value: '<1 s', label: 'Typical build', detail: 'cached runtime objects, incremental linking' },
];

const FEATURES = [
  {
    title: 'Ordinary TypeScript',
    body: 'No annotations or dialect. Code is type-checked by the real TypeScript compiler, and what compiles behaves like Node.',
  },
  {
    title: 'Native or WebAssembly',
    body: 'Emit a standalone executable, a WASI Preview 1 module, LLVM IR or assembly from the same source.',
  },
  {
    title: 'Errors where you type',
    body: 'scriptc diagnostics — code, location and rewrite hint — are drawn inline in the editor after every build.',
  },
  {
    title: 'Coverage analysis',
    body: 'See what percentage of a program compiles statically and exactly which constructs block the rest.',
  },
  {
    title: 'GitHub in the loop',
    body: 'Browse your repositories, open a file, and commit changes back without leaving the studio.',
  },
  {
    title: 'Live collaboration',
    body: 'Share a link and edit together over WebSockets, with origin checks and server-assigned identities.',
  },
];

const STEPS = [
  { title: 'Write', body: 'Start from a template or paste a script. The editor speaks TypeScript.' },
  { title: 'Compile', body: 'Pick native or WASM and press ⌘↵. scriptc builds it on the server in about a second.' },
  { title: 'Ship', body: 'Download one file. Copy it to a server, a container or a USB stick — it just runs.' },
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
    q: 'Can I run it myself?',
    a: 'Yes — the studio is open source. `docker compose up` gives you the editor, compiler toolchain and collaboration server in one container.',
  },
];

function CodeWindow() {
  return (
    <div className="surface overflow-hidden text-left shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_30px_80px_-20px_rgba(59,140,255,0.25)]">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-gray-700" />
        <span className="h-2.5 w-2.5 rounded-full bg-gray-700" />
        <span className="h-2.5 w-2.5 rounded-full bg-gray-700" />
        <span className="ml-3 font-mono text-xs text-gray-500">hello.ts</span>
      </div>
      <pre className="overflow-x-auto px-5 py-4 font-mono text-[13px] leading-6 text-gray-300">
        <span className="text-[#ff7ab2]">const</span> name = process.argv[<span className="text-[#79c0ff]">2</span>] ?? <span className="text-[#7ee787]">&apos;World&apos;</span>;{'\n'}
        console.log(<span className="text-[#7ee787]">{'`Hello, ${name}!`'}</span>);
      </pre>
      <div className="border-t border-border bg-black px-5 py-4 font-mono text-[13px] leading-6">
        <div><span className="text-gray-500">$</span> <span className="text-gray-100">scriptc build hello.ts -o hello --strip</span></div>
        <div><span className="text-gray-500">$</span> <span className="text-gray-100">ls -lh hello</span></div>
        <div className="text-gray-400">-rwxr-xr-x  55K  hello</div>
        <div><span className="text-gray-500">$</span> <span className="text-gray-100">./hello Vercel</span></div>
        <div className="text-success">Hello, Vercel!</div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="app-bg min-h-screen">
      <SiteHeader active="/landing">
        <Link href="/" className="btn btn-primary btn-sm">Open editor</Link>
      </SiteHeader>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pt-20 pb-16 md:pt-28">
        <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
          <div className="animate-fade-in">
            <a href="https://scriptc.dev" className="badge mb-6 hover:text-gray-100 transition-colors">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              Powered by scriptc from Vercel Labs
            </a>
            <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
              <span className="text-gradient">TypeScript in.</span>
              <br />
              <span className="text-gray-100">Native binary out.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-gray-400">
              NanoCLI Studio is a browser IDE for building command-line tools. Write ordinary TypeScript,
              compile it with scriptc, and download a single executable — no Node.js required to run it.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/" className="btn btn-primary h-11 px-5 text-[15px]">Start building</Link>
              <Link href="/studio" className="btn btn-secondary h-11 px-5 text-[15px]">Open the studio</Link>
            </div>
          </div>
          <CodeWindow />
        </div>
      </section>

      {/* Stats */}
      <section className="mx-auto max-w-6xl px-4">
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-4">
          {STATS.map((stat) => (
            <div key={stat.label} className="bg-black p-6">
              <dt className="text-sm text-gray-400">{stat.label}</dt>
              <dd className="mt-2 font-mono text-3xl tracking-tight text-gray-100">{stat.value}</dd>
              <dd className="mt-1 text-xs text-gray-500">{stat.detail}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-gray-500">Measured on Linux x64 with scriptc 0.2.2 and Node.js 22.</p>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-4 py-24">
        <div className="max-w-2xl">
          <div className="eyebrow">Features</div>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
            Everything between an idea and a binary.
          </h2>
        </div>
        <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="bg-black p-6 transition-colors hover:bg-gray-900">
              <h3 className="font-medium text-gray-100">{feature.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-400">{feature.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 pb-24">
        <div className="eyebrow">How it works</div>
        <ol className="mt-6 grid gap-6 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="surface p-6">
              <div className="font-mono text-sm text-gray-500">0{i + 1}</div>
              <h3 className="mt-3 text-lg font-medium text-gray-100">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-400">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Templates */}
      <section className="mx-auto max-w-6xl px-4 pb-24">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="eyebrow">Templates</div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">Start from a working program.</h2>
          </div>
          <Link href="/" className="btn btn-ghost">Browse in the editor →</Link>
        </div>
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TEMPLATES.map((template) => (
            <div key={template.id} className="surface p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-100">{template.name}</span>
                <span className="font-mono text-xs text-gray-500">{template.filename}</span>
              </div>
              <p className="mt-1.5 text-sm text-gray-400">{template.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-6xl px-4 pb-24">
        <div className="grid gap-10 lg:grid-cols-[1fr_2fr]">
          <div>
            <div className="eyebrow">FAQ</div>
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
        <div className="surface relative overflow-hidden px-6 py-14 text-center">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(40rem_16rem_at_50%_0%,rgba(59,140,255,0.18),transparent)]" />
          <h2 className="relative text-3xl font-semibold tracking-tight md:text-4xl">Build your first binary in a minute.</h2>
          <p className="relative mt-3 text-gray-400">No sign-up needed. Open the editor and press ⌘↵.</p>
          <Link href="/" className="btn btn-primary relative mt-8 h-11 px-6 text-[15px]">Open the editor</Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
