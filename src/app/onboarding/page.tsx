'use client';

/**
 * NanoCLI Studio - Onboarding
 * A three-step tour that ends in the editor with a template loaded.
 */

import { useState } from 'react';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { TEMPLATES } from '@/lib/templates';

const STEPS = ['Welcome', 'Pick a template', 'Ready'] as const;

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [templateId, setTemplateId] = useState(TEMPLATES[0].id);
  const template = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0];

  return (
    <div className="app-bg min-h-screen">
      <SiteHeader>
        <Link href="/" className="btn btn-ghost btn-sm">Skip</Link>
      </SiteHeader>

      <main id="main" className="mx-auto max-w-2xl px-4 pt-16 pb-24">
        <ol className="mb-10 flex items-center gap-3" aria-label="Progress">
          {STEPS.map((label, i) => (
            <li key={label} className="flex flex-1 items-center gap-3">
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border font-mono text-xs ${
                  i < step
                    ? 'border-gray-100 bg-gray-100 text-black'
                    : i === step
                      ? 'border-gray-100 text-gray-100'
                      : 'border-border-strong text-gray-500'
                }`}
                aria-current={i === step ? 'step' : undefined}
              >
                {i < step ? '✓' : i + 1}
              </span>
              <span className={`hidden text-sm sm:inline ${i === step ? 'text-gray-100' : 'text-gray-500'}`}>{label}</span>
              {i < STEPS.length - 1 && <span className="h-px flex-1 bg-border" />}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <section className="animate-fade-in">
            <h1 className="text-4xl font-semibold tracking-tight">Welcome to NanoCLI Studio</h1>
            <p className="mt-4 text-lg leading-relaxed text-gray-400">
              Write TypeScript here and the server compiles it with{' '}
              <a href="https://scriptc.dev" className="text-gray-100 underline underline-offset-4">scriptc</a>{' '}
              into a single native executable — no Node.js needed where it runs.
            </p>
            <ul className="mt-8 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
              {[
                ['Write', 'Ordinary TypeScript with full IntelliSense.'],
                ['Compile', 'Native or WASM in about a second.'],
                ['Ship', 'Download one small file and run it.'],
              ].map(([title, body]) => (
                <li key={title} className="bg-black p-5">
                  <div className="font-medium text-gray-100">{title}</div>
                  <p className="mt-1 text-sm text-gray-400">{body}</p>
                </li>
              ))}
            </ul>
            <div className="mt-10 flex justify-end">
              <button onClick={() => setStep(1)} className="btn btn-primary h-10 px-5">Continue</button>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="animate-fade-in">
            <h1 className="text-3xl font-semibold tracking-tight">Pick a starting point</h1>
            <p className="mt-3 text-gray-400">Every template compiles with scriptc as-is. You can switch any time.</p>
            <div className="mt-8 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Templates">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  role="radio"
                  aria-checked={templateId === t.id}
                  onClick={() => setTemplateId(t.id)}
                  className={`rounded-lg border p-4 text-left transition-colors ${
                    templateId === t.id
                      ? 'border-gray-100 bg-white/[0.04]'
                      : 'border-border hover:border-border-strong'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-100">{t.name}</span>
                    <span className="font-mono text-xs text-gray-500">{t.filename}</span>
                  </div>
                  <p className="mt-1 text-sm text-gray-400">{t.description}</p>
                </button>
              ))}
            </div>
            <div className="mt-10 flex justify-between">
              <button onClick={() => setStep(0)} className="btn btn-ghost">Back</button>
              <button onClick={() => setStep(2)} className="btn btn-primary h-10 px-5">Continue</button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="animate-fade-in">
            <h1 className="text-3xl font-semibold tracking-tight">You’re set</h1>
            <p className="mt-3 text-gray-400">
              The editor will open with <span className="text-gray-100">{template.name}</span>. A few things worth knowing:
            </p>
            <dl className="mt-8 divide-y divide-border border-y border-border text-sm">
              {[
                [<span key="k" className="kbd">⌘↵</span>, 'Compile the current file'],
                ['Problems', 'scriptc errors show inline with a rewrite hint'],
                ['Check coverage', 'See what share of your program compiles statically'],
                ['Share', 'Copy a link that opens a copy of your code'],
              ].map(([term, desc], i) => (
                <div key={i} className="flex items-center justify-between gap-4 py-3">
                  <dt className="text-gray-100">{term}</dt>
                  <dd className="text-gray-400">{desc}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-10 flex justify-between">
              <button onClick={() => setStep(1)} className="btn btn-ghost">Back</button>
              <Link href={`/?template=${template.id}`} className="btn btn-primary h-10 px-5">Open the editor</Link>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
