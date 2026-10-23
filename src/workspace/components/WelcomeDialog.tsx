'use client';

import { useState } from 'react';
import { getProvider } from '@/lib/ai-providers';
import { useActions } from '../actions';
import { useAiConfig } from '../ai-config';
import { Dialog } from './Dialog';

export type StartWith = 'typescript' | 'python' | 'web' | 'other' | 'kits' | null;

const CHOICES: { id: Exclude<StartWith, null> | 'here'; title: string; detail: string }[] = [
  { id: 'here', title: 'A command-line tool', detail: 'TypeScript, compiled to a small native binary. The editor already has one open.' },
  { id: 'python', title: 'Python or AI', detail: 'An LLM agent, RAG, data analysis, an MCP server, managed by uv' },
  { id: 'web', title: 'A web app', detail: 'Next.js, Vite, SvelteKit, Astro… with a live preview' },
  { id: 'other', title: 'Another language', detail: 'Go, Rust, Java, C#, Ruby and 30 more, with tests and CI' },
  { id: 'kits', title: 'A customer project', detail: 'A field kit: playbook, checks and setup for FDE and ISV work' },
];

/**
 * The first minute: what you are building (a starter), a model for the agent, and GitHub (optional).
 * Shown once, on a first visit; every step can be skipped and done later.
 */
export function WelcomeDialog({ onClose, onStart }: { onClose: () => void; onStart: (startWith: StartWith) => void }) {
  const actions = useActions();
  const config = useAiConfig();
  const [step, setStep] = useState(0);
  const [startWith, setStartWith] = useState<StartWith>(null);
  const provider = config.provider ? getProvider(config.provider) : null;
  const hasModel = !!provider && (!provider.needsKey || !!config.keys[provider.id]);

  const finish = () => {
    onClose();
    if (startWith) onStart(startWith);
  };

  return (
    <Dialog title="Welcome to NanoCLI Studio" description={['What are you building?', 'Connect a model for the agent', 'GitHub (optional)'][step]} onClose={finish} width="max-w-xl">
      <div className="space-y-4 p-5">
        <ol className="flex gap-1.5" aria-label="Steps">
          {[0, 1, 2].map((i) => (
            <li key={i} className={`h-1 flex-1 rounded-full ${i <= step ? 'bg-[var(--color-accent)]' : 'bg-white/10'}`} aria-current={i === step ? 'step' : undefined} />
          ))}
        </ol>

        {step === 0 && (
          <ul className="grid gap-2">
            {CHOICES.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => {
                    setStartWith(c.id === 'here' ? null : c.id);
                    setStep(1);
                  }}
                  className="w-full rounded-xl border border-border p-3.5 text-left transition-colors hover:border-border-strong hover:bg-white/[0.04]"
                >
                  <span className="block text-sm font-medium text-gray-100">{c.title}</span>
                  <span className="mt-0.5 block text-sm text-gray-400">{c.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-gray-400">
              The agent works with the model you choose; your key stays in this browser and goes only to that provider. Free options: a Google Gemini key (aistudio.google.com/apikey), Groq or OpenRouter, or a local model with Ollama.
            </p>
            {hasModel ? (
              <p className="rounded-lg border border-[var(--accent-line)] bg-[var(--accent-soft)] px-3 py-2 text-sm text-gray-100">✓ Using {provider?.name}{config.models[config.provider] ? ` · ${config.models[config.provider]}` : ''}</p>
            ) : (
              <button onClick={() => actions.openSettings('ai')} className="btn btn-primary w-full">See which model to use, and why</button>
            )}
            {hasModel && (
              <button onClick={() => actions.openSettings('ai')} className="text-xs text-gray-400 underline-offset-2 hover:text-gray-100 hover:underline">
                Compare: which model for which job (agent, reviewer, questions, worker)
              </button>
            )}
            <div className="flex justify-between">
              <button onClick={() => setStep(0)} className="btn btn-ghost btn-sm">Back</button>
              <button onClick={() => setStep(2)} className="btn btn-secondary btn-sm">{hasModel ? 'Next' : 'Later'}</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-gray-400">Sign in to pull and push repositories, see CI on your branch, and let the agent fix failing pipelines. You can do this any time from the Source tab.</p>
            <button onClick={actions.signIn} className="btn btn-secondary w-full">Sign in with GitHub</button>
            <div className="flex justify-between">
              <button onClick={() => setStep(1)} className="btn btn-ghost btn-sm">Back</button>
              <button onClick={finish} className="btn btn-primary btn-sm">Start building</button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
