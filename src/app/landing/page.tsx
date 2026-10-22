/**
 * NanoCLI Studio - the product page. Every claim here is something the studio
 * does today; keep it that way (numbers measured on Linux x64, scriptc 0.2.2).
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { ByteField } from '@/components/ByteField';
import { SiteFooter, SiteHeader } from '@/components/SiteHeader';
import { AUDIENCE_LABEL, KIT_LIBRARY } from '@/lib/kit-library';
import { LANGUAGES } from '@/lib/languages';
import { PLANS, priceLabel } from '@/lib/pricing';

export const metadata: Metadata = {
  title: 'NanoCLI Studio · The IDE where AI does the work and proves it',
  description: 'An editor and an AI teammate in one workspace. Every change arrives as a proposal with the diff and evidence that it builds and runs. 40+ languages, live preview, field kits, your own model.',
};

const PROOF = [
  { value: `${LANGUAGES.length + 2}`, label: 'Languages and runtimes', detail: 'smart contracts included, toolchains installed and patched for you' },
  { value: '0', label: 'Changes without your OK', detail: 'every edit is a proposal on a private copy' },
  { value: '12 s', label: 'After you stop typing', detail: 'the worker picks up the next task' },
  { value: '55 KB', label: 'Native binary', detail: 'TypeScript compiled by scriptc, no runtime needed' },
];

const LOOP = [
  { title: 'Ask, or let it choose', body: 'Type what you want in the bar at the top. Or turn on the worker: it fixes what broke, clears errors, resolves TODOs and adds missing tests, on its own.' },
  { title: 'It works on a copy', body: 'The agent plans, edits a private copy of your project, builds it, runs it, and retries within a budget. Your files don’t change while it works.' },
  { title: 'You ship the evidence', body: 'The result opens next to your files: the diff, and what it proved (“Verified · built ✓ ran ✓”). One click to ship, one to discard.' },
];

const FEATURES = [
  { title: 'A worker that codes alongside you', body: 'Suggest mode keeps a ranked list of what’s worth doing next. Autonomous mode does it while you pause, one task at a time, within a budget, and waits for you when results need review.', wide: true },
  { title: 'Debugging on autopilot', body: 'Every failure, in any language, lands in one bar with its location. “Debug this” hands the agent the error, the code and what changed since it last worked.' },
  { title: 'Every language, kept current', body: 'Rust, Go, Java, C#, Swift, Zig, Elixir and 30 more run as soon as you press Run. Toolchains are installed on demand and patched within their major version.' },
  { title: 'Web apps, previewed instantly', body: 'Next.js, Nuxt, SvelteKit, Astro, Angular and Vite with their real dev servers, or React, Vue and Svelte bundled right in the browser with no install.' },
  { title: 'Best of three', body: 'For harder tasks, the agent runs the task three ways on separate copies, scores each by whether it builds and runs, and recommends the one that verified.' },
  { title: 'Connected, carefully', body: 'MCP servers, GitHub, Postgres and SQLite, web pages and your own commands become tools for the agent, and each call asks you first.' },
];

const AUDIENCES = [
  { who: 'Beginners', line: 'Pick a starter, press Run, ask the agent to explain. Nothing to install, nothing to break: every change can be discarded.', href: '/onboarding', cta: 'Take the tour' },
  { who: 'Senior engineers', line: 'Hand off the grind (failing tests, TODOs, missing coverage) to the worker and review diffs with evidence instead of babysitting a chat.', href: '/', cta: 'Open the studio' },
  { who: 'Forward-deployed engineers', line: 'Start every customer from a field kit: the integration, its playbook, the checks that prove it works, and the agent’s house rules.', href: '/?kit=customer-api-integration', cta: 'Open the integration kit' },
  { who: 'ISVs', line: 'Ship a kit with your SDK so developers are productive on day one, or expose your product to AI agents with the MCP server kit.', href: '/?kit=product-mcp-server', cta: 'Open the MCP kit' },
];

const PRIVATE = [
  'Runs on your machine or your server; it listens on localhost unless you say otherwise',
  'Your model, your key: keys stay in your browser and go only to the provider you chose',
  'Agent work happens on a copy; commands it wants to run ask you first',
  'Exported kits never carry secrets: env values, .env files and anything that looks like a key stay behind',
];

const FAQ = [
  { q: 'How is this different from an AI chat in my editor?', a: 'The agent and the editor are one workspace. Work arrives as proposals you can review like a pull request, with evidence that it builds and runs, and the worker keeps going on its own between your edits.' },
  { q: 'Which models can I use?', a: 'For the agent: Anthropic, OpenAI, Gemini, Groq, OpenRouter, or a local model in Ollama. The assistant also works with Mistral, Cerebras and LM Studio. You bring the key or the model; we never see either.' },
  { q: 'Do I need to install compilers?', a: 'No. Press Run and the studio installs the toolchain it needs and keeps it patched. If you already have one installed, yours is used.' },
  { q: 'Is it free?', a: 'The whole studio is free with your own model. Pro adds the autonomous worker, automatic debugging, best-of-three and the native app.' },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader active="/landing">
        <Link href="/pricing" className="btn btn-ghost btn-sm hidden sm:inline-flex">Pricing</Link>
        <Link href="/" className="btn btn-primary btn-sm">Open the studio</Link>
      </SiteHeader>

      <main id="main">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div aria-hidden="true" className="absolute inset-0 [mask-image:radial-gradient(70%_80%_at_50%_0%,black,transparent)]">
            <ByteField intensity="hero" />
          </div>
          <div className="relative mx-auto max-w-6xl px-4 pt-20 pb-16 md:pt-28">
            <span className="badge mb-8 animate-fade-in">
              <span className="dot text-accent" aria-hidden="true" />
              The agent and the editor, one workspace
            </span>
            <h1 className="display max-w-4xl text-[clamp(2.6rem,7vw,5.5rem)] text-gray-100 animate-fade-in">
              The IDE where AI does the work.
              <br />
              <span className="text-accent">And proves it.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-gray-300">
              Ask for a change, or let the worker pick up what’s next. Every result arrives as a proposal with the diff and the evidence that it builds and runs. Nothing touches your code until you say so.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/" className="btn btn-primary h-11 px-6 text-[15px]">Open the studio, free</Link>
              <Link href="/pricing" className="btn btn-secondary h-11 px-6 text-[15px]">See plans</Link>
            </div>
            <p className="mt-3 text-sm text-gray-500">No sign-up. Your model, your machine.</p>

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
                <img src="/marketing/proposal.png" alt="A proposal from the worker, marked Verified and built, open next to the editor, with the Worker panel on the right" width={1440} height={900} className="block w-full" />
              </div>
            </div>
          </div>
        </section>

        {/* Proof */}
        <section className="mx-auto max-w-6xl px-4" aria-label="At a glance">
          <dl className="grid grid-cols-2 border-y border-border lg:grid-cols-4">
            {PROOF.map((stat, i) => (
              <div key={stat.label} className={`flex flex-col-reverse px-1 py-8 lg:px-6 ${i ? 'lg:border-l lg:border-border' : ''} ${i % 2 ? 'border-l border-border pl-6' : ''}`}>
                <dd className="mt-1 text-xs text-gray-400">{stat.detail}</dd>
                <dt className="mt-2 text-sm font-medium text-gray-200">{stat.label}</dt>
                <dd className="font-mono text-4xl tracking-tight text-gray-100">{stat.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* The loop */}
        <section className="mx-auto max-w-6xl px-4 py-24" aria-labelledby="how">
          <div className="eyebrow text-accent">How it works</div>
          <h2 id="how" className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight md:text-4xl">Review results, not chat transcripts.</h2>
          <ol className="mt-10 grid gap-8 md:grid-cols-3">
            {LOOP.map((step, i) => (
              <li key={step.title} className="border-t border-border-strong pt-5">
                <div className="font-mono text-sm text-accent">0{i + 1}</div>
                <h3 className="mt-3 text-xl font-medium text-gray-100">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-400">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Features */}
        <section id="features" className="mx-auto max-w-6xl px-4 pb-24" aria-labelledby="features-title">
          <div className="eyebrow text-accent">What’s inside</div>
          <h2 id="features-title" className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight md:text-4xl">Everything between an idea and shipped code.</h2>
          <div className="mt-10 grid gap-3 md:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className={`surface p-6 transition-colors hover:border-border-strong ${f.wide ? 'md:col-span-2' : ''}`}>
                <h3 className="font-medium text-gray-100">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-400">{f.body}</p>
              </div>
            ))}
            <div className="surface p-6 md:col-span-2">
              <h3 className="font-medium text-gray-100">Press Run in any of them</h3>
              <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Languages">
                {['TypeScript', 'Python', ...LANGUAGES.map((l) => l.name.replace(/ \(.*\)$/, ''))].map((name) => (
                  <li key={name} className="badge">{name}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Audiences */}
        <section className="mx-auto max-w-6xl px-4 pb-24" aria-labelledby="who">
          <div className="eyebrow text-accent">Who it’s for</div>
          <h2 id="who" className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">From first program to customer site.</h2>
          <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
            {AUDIENCES.map((a) => (
              <div key={a.who} className="flex flex-col bg-[var(--raised)] p-6">
                <h3 className="text-lg font-medium text-gray-100">{a.who}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-gray-400">{a.line}</p>
                <Link href={a.href} className="mt-4 text-sm text-accent hover:text-gray-100">{a.cta} →</Link>
              </div>
            ))}
          </div>
        </section>

        {/* Field kits */}
        <section className="mx-auto max-w-6xl px-4 pb-24" aria-labelledby="kits">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
            <div>
              <div className="eyebrow text-accent">Field kits</div>
              <h2 id="kits" className="mt-3 text-3xl font-semibold tracking-tight">Day one, already working.</h2>
              <p className="mt-4 text-sm leading-relaxed text-gray-400">
                A kit is a project plus what usually lives in someone’s head: the playbook, the variables and connectors it needs, the checks that prove it works, and house rules for the agent. Share it as one file, without secrets.
              </p>
            </div>
            <ul className="space-y-2.5">
              {KIT_LIBRARY.map(({ kit }) => (
                <li key={kit.id}>
                  <Link href={`/?kit=${kit.id}`} className="surface flex items-start gap-4 p-4 transition-colors hover:border-border-strong">
                    <span className="badge mt-0.5 shrink-0 px-1.5 py-0 text-[10px]">{AUDIENCE_LABEL[kit.audience]}</span>
                    <span className="min-w-0">
                      <span className="block font-medium text-gray-100">{kit.name}</span>
                      <span className="mt-1 block text-sm text-gray-400">{kit.summary}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Private by design */}
        <section className="mx-auto max-w-6xl px-4 pb-24" aria-labelledby="private">
          <div className="rounded-2xl border border-border bg-[var(--panel)] p-8 md:p-10">
            <div className="eyebrow text-accent">Private by design</div>
            <h2 id="private" className="mt-3 text-3xl font-semibold tracking-tight">Your code stays yours.</h2>
            <ul className="mt-6 grid gap-4 md:grid-cols-2">
              {PRIVATE.map((line) => (
                <li key={line} className="flex gap-3 text-sm leading-relaxed text-gray-300">
                  <span className="mt-0.5 text-accent" aria-hidden="true">✓</span>
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Plans */}
        <section className="mx-auto max-w-6xl px-4 pb-24" aria-labelledby="plans">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="eyebrow text-accent">Plans</div>
              <h2 id="plans" className="mt-3 text-3xl font-semibold tracking-tight">Free to build. Pay when it works for you.</h2>
            </div>
            <Link href="/pricing" className="btn btn-ghost">Compare plans →</Link>
          </div>
          <div className="mt-8 grid gap-3 md:grid-cols-3">
            {PLANS.map((plan) => (
              <Link key={plan.id} href="/pricing" className={`surface p-6 transition-colors hover:border-border-strong ${plan.highlight ? 'border-accent/50' : ''}`}>
                <div className="flex items-baseline justify-between">
                  <span className="font-medium text-gray-100">{plan.name}</span>
                  <span className="font-mono text-gray-100">{priceLabel(plan, 'yearly')}<span className="text-xs text-gray-500">{plan.monthly === null ? '' : `/mo${plan.perSeat ? '/seat' : ''}`}</span></span>
                </div>
                <p className="mt-2 text-sm text-gray-400">{plan.tagline}</p>
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
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-gray-100">
                    {item.q}
                    <span className="text-gray-500 transition-transform group-open:rotate-45" aria-hidden="true">+</span>
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
            <h2 className="display relative text-4xl text-gray-100 md:text-5xl">Your next change, verified.</h2>
            <p className="relative mt-4 text-gray-400">Open the studio, pick a starter or a kit, and ask.</p>
            <div className="relative mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/" className="btn btn-primary h-11 px-6 text-[15px]">Open the studio</Link>
              <Link href="/onboarding" className="btn btn-secondary h-11 px-6 text-[15px]">Take the tour</Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
