'use client';

/**
 * NanoCLI Studio - FAQ
 * Searchable, filterable answers. Keep these accurate to what the code does.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/SiteHeader';

interface FAQItem {
  id: string;
  question: string;
  answer: string;
  category: Category;
}

const CATEGORIES = ['General', 'Agent', 'Field kits', 'Plans', 'Compiling', 'Workspace', 'Python', 'GitHub', 'Assistant', 'Self-hosting', 'Security'] as const;
type Category = (typeof CATEGORIES)[number];

const FAQS: FAQItem[] = [
  {
    id: 'what-is-nanocli',
    category: 'General',
    question: 'What is NanoCLI Studio?',
    answer: 'An editor and an AI teammate in one workspace. You write code in 40+ languages and runtimes (smart contracts included) with toolchains installed for you; the agent and the worker make changes on a private copy and hand them back as proposals with the diff and evidence that they build and run. TypeScript can also be compiled by scriptc into a small native executable.',
  },
  {
    id: 'proposals',
    category: 'Agent',
    question: 'What is a proposal?',
    answer: 'Whatever the agent does arrives as a tab next to your files: its plan, the diff, and evidence from the builds and runs it did (“Verified · built ✓ ran ✓”). Your files change only when you press Ship; Discard throws the copy away.',
  },
  {
    id: 'worker',
    category: 'Agent',
    question: 'What does the worker do, and can it run away?',
    answer: 'It keeps a ranked list of useful tasks: the last failure, editor errors, the next step toward what you said you are building, your TODOs, and files no test covers. In Suggest mode you start each one; in Autonomous mode it starts the next about 12 seconds after you stop typing. It works one task at a time, within an hourly budget, never repeats a task, waits for you once three results need review, and pauses after three unverified results. Everything it does is a proposal.',
  },
  {
    id: 'auto-debug',
    category: 'Agent',
    question: 'How does automatic debugging work?',
    answer: 'Every failure (a build error, a crash in any language, a Python traceback, an error in the preview) shows in a bar under the editor with links to where it happened. Debug this hands the agent the error, the code it points at and what changed since the code last worked; it reproduces, fixes and runs it again to prove the fix. With automatic debugging on, that starts by itself once per distinct failure.',
  },
  {
    id: 'kits',
    category: 'Field kits',
    question: 'What is a field kit?',
    answer: 'A project plus its playbook, the environment variables and connectors it needs, checks that prove it works, and house rules for the agent, shared as one .nanokit.json file. Three are built in: a customer API integration, an MCP server for your product, and a data pipeline proof of concept. Each runs on sample data as soon as it opens.',
  },
  {
    id: 'kit-secrets',
    category: 'Field kits',
    question: 'Can an exported kit leak our keys?',
    answer: 'It is designed not to. Environment values are never part of a kit, .env files stay behind, and any file that looks like it holds a key (cloud, model, GitHub, Slack or Stripe keys, private keys, passwords in URLs) is left out and named when you export. Connectors use ${VARIABLE} placeholders instead of secrets.',
  },
  {
    id: 'plans',
    category: 'Plans',
    question: 'What is free and what is paid?',
    answer: 'The whole studio is free with your own model. Pro adds the worker in Autonomous mode, automatic debugging, best-of-three and the native app; Premium adds team features for forward-deployed, ISV and platform teams. See the pricing page for the full comparison.',
  },
  {
    id: 'what-is-scriptc',
    category: 'General',
    question: 'What is scriptc?',
    answer: 'scriptc is an open-source compiler from Vercel Labs (github.com/vercel-labs/scriptc). It compiles ordinary TypeScript and JavaScript through LLVM into small native executables or WASI modules — no Node, no V8 and no JavaScript engine in the artifact. Code is type-checked by the real TypeScript compiler.',
  },
  {
    id: 'vs-node',
    category: 'General',
    question: 'How is a scriptc binary different from running the script with Node.js?',
    answer: 'The binary carries only the runtime pieces your program uses. On Linux x64, a hello-world is a 55 KB file that starts in about 1.2 ms, where the same script on Node.js starts in about 30 ms and needs the ~118 MB Node runtime installed.',
  },
  {
    id: 'targets',
    category: 'Compiling',
    question: 'Which output targets are available?',
    answer: 'Native executable (stripped, statically linked runtime), WASM (WASI Preview 1), LLVM IR and target assembly. scriptc 0.2 removed the C backend, so C output is no longer offered.',
  },
  {
    id: 'platforms',
    category: 'Compiling',
    question: 'Can I build Windows or macOS executables?',
    answer: 'Native executables are linked for the machine the studio runs on — Linux x64 in the default Docker image. scriptc can cross-compile with per-target runtime packs and SDKs, which the hosted image does not ship. For a portable artifact, choose WASM and run it with any WASI runtime (Wasmtime, Wasmer or Node’s WASI support).',
  },
  {
    id: 'support',
    category: 'Compiling',
    question: 'Will my program compile?',
    answer: 'scriptc compiles a growing static subset of TypeScript and the Node APIs. Unsupported constructs fail with an SC error code, a location and usually a rewrite hint, shown inline in the editor. Use “Check coverage” to see what percentage of a program compiles and what blocks the rest. Common fixes: narrow catch bindings with `err instanceof Error` before reading `.message`, avoid `eval`/`Function`, and use ES modules instead of `module.exports`.',
  },
  {
    id: 'limits',
    category: 'Compiling',
    question: 'Are there limits on builds?',
    answer: 'Sources are limited to 512 KB, each build to 60 seconds, and the server runs two builds at a time by default (MAX_CONCURRENT_BUILDS). Build artifacts are deleted after an hour, so download what you want to keep.',
  },
  {
    id: 'wasm-zig',
    category: 'Compiling',
    question: 'Why does WASM need zig on the server?',
    answer: 'scriptc uses zig’s bundled wasm32-wasi toolchain to link WebAssembly modules. The Docker image installs it; if you run the studio elsewhere, put zig on the PATH or WASM builds report that it is missing.',
  },
  {
    id: 'templates',
    category: 'Workspace',
    question: 'What do the templates cover?',
    answer: 'Ten starter projects — a multi-file CLI with argument parsing, hello world, a recursive-descent calculator, wc, a JSON formatter, typed math utilities, a Fibonacci benchmark, an HTTP server, a fetch client and an async countdown. CI compiles every one of them with scriptc, so they always build. Open them from New project or the command palette.',
  },
  {
    id: 'shortcuts',
    category: 'Workspace',
    question: 'What keyboard shortcuts are there?',
    answer: '⌘K opens the command palette, ⌘↵ compiles, ⌘⇧↵ runs in the terminal, ⌘S saves a version (formatting first if enabled), ⌘⇧F formats, ⌘B and ⌘J toggle the explorer and terminal, ⌘\\ splits the editor and ⌘⌥Z enters zen mode. Every shortcut can be remapped — and exported or imported — under Settings → Keyboard shortcuts. On Windows and Linux, ⌘ is Ctrl.',
  },
  {
    id: 'collab',
    category: 'Workspace',
    question: 'How does live collaboration work?',
    answer: 'Start a live session from the command palette. Edits to each file are relayed over a WebSocket to everyone in the same session. The server only accepts connections from the studio’s own origin and stamps each message with the sender’s connection identity.',
  },
  {
    id: 'saving',
    category: 'Workspace',
    question: 'Is my work saved?',
    answer: 'Yes — the workspace autosaves to this browser as you type. Versions are stored in History when you press ⌘S, after each successful build and before pulls, restores and assistant edits; compare or restore them any time. To move work elsewhere, export a ZIP or a gist, copy a share link, or push to GitHub.',
  },
  {
    id: 'terminal',
    category: 'Workspace',
    question: 'Does the terminal run my program?',
    answer: 'Yes. `run` compiles the project to a WASI module and executes it in a Web Worker in your tab, with the project files mounted as its working directory — files it writes appear in the explorer. Output streams live, Ctrl+C stops it, and the Build panel shows exit code, wall time and memory. The native executable runs on your machine after download. The terminal also has ls, cd, cat, mv, rm, tree, build, format, git status and output redirection.',
  },
  {
    id: 'github-connect',
    category: 'GitHub',
    question: 'What can the GitHub integration do?',
    answer: 'Pull any branch of your repositories into the workspace, see changed files with +/− counts, review each one as a side-by-side diff, create branches, and commit and push all changes at once. If someone pushed since your pull, the push is refused so their work is never overwritten — pull, then commit again.',
  },
  {
    id: 'python',
    category: 'Python',
    question: 'Can I write Python?',
    answer: 'Yes. Python projects run with uv, Astral\'s fast package and project manager. Open a Python template, or add a .py file: the Python panel lists pyproject.toml dependencies with the versions uv.lock resolved, adds and removes packages, runs sync, lock and tree, and pins a Python version. In the terminal, `run`, `python main.py`, `uv add httpx` and `uv remove httpx` work; output streams as it happens and files your program writes (reports, CSVs) appear in the explorer. Scripts can also declare dependencies inline (PEP 723) and need no project at all. uv itself is detected on your machine, or the studio can download the official release for you.',
  },
  {
    id: 'python-ai',
    category: 'Python',
    question: 'Which Python AI starters are included?',
    answer: 'An LLM agent with tool calling (any OpenAI-compatible provider), embeddings + search (RAG) that works with keywords alone and improves with an embeddings endpoint, a local-model chat through Ollama, a pandas data-analysis report, an MCP server and a single-file uv script. API keys go in the Python panel\'s environment list and stay in your browser; "Use assistant provider" reuses the provider you already set up for the assistant.',
  },
  {
    id: 'python-safety',
    category: 'Security',
    question: 'Is it safe that Python runs on the server?',
    answer: 'Running Python means running your code on the machine that hosts the studio. That is what you want on your own computer, and the studio listens only on 127.0.0.1 by default so nothing else on your network can reach it. Python commands also require a known Host header (localhost, your NEXT_PUBLIC_BASE_URL or ALLOWED_HOSTS), same-origin requests, rate limits, timeouts and output caps, and the program never sees the server\'s own secrets, only the variables you set. It is not a sandbox: on a shared or public server set NANOCLI_PYTHON=0, or run the studio in a container. The Docker image ships with Python off.',
  },
  {
    id: 'github-scope',
    category: 'GitHub',
    question: 'What access does the GitHub app request?',
    answer: 'The OAuth app asks for `repo` (read and write repository contents, including private repositories you choose to open), `read:user` and `gist` (for gist export). The token is kept in an HTTP-only cookie and is never exposed to page scripts.',
  },
  {
    id: 'assistant',
    category: 'Assistant',
    question: 'What can the assistant do?',
    answer: 'It explains the active file, fixes scriptc compile errors and writes test programs, and answers questions about your project. It sees every project file, your selection and the latest diagnostics. Code blocks come with Apply, which writes the file and saves the previous version to History first. It runs on the model you choose: free tiers from Google Gemini, Groq, OpenRouter, Cerebras and Mistral, local models through Ollama or LM Studio, or your own Anthropic or OpenAI key. Keys stay in your browser and requests go straight to the provider, so the assistant costs nothing to host.',
  },
  {
    id: 'assistant-data',
    category: 'Assistant',
    question: 'What does the assistant send, and where?',
    answer: 'Only when you ask it something: the project files, your selection and the current errors go to the server, which forwards them to Anthropic’s API to generate the answer. Nothing is sent in the background.',
  },
  {
    id: 'license',
    category: 'General',
    question: 'Can I use or redistribute NanoCLI Studio’s source?',
    answer: 'No. NanoCLI Studio is proprietary software — copyright BrandDeb, all rights reserved. Using, copying, hosting or modifying it requires a written agreement. Programs you compile with it are yours.',
  },
  {
    id: 'self-host',
    category: 'Self-hosting',
    question: 'How do I run my own instance?',
    answer: 'Licensed deployments run with `docker compose up -d`: the image contains the Next.js app, the collaboration server, scriptc and its clang/lld/zig toolchain. For GitHub sign-in, create an OAuth app and set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and NEXT_PUBLIC_BASE_URL; optionally set ANTHROPIC_API_KEY to offer a hosted default model (users can always bring their own).',
  },
  {
    id: 'node',
    category: 'Self-hosting',
    question: 'Which Node.js version do I need?',
    answer: 'Node.js 24 or newer — scriptc 0.2 requires it for installation.',
  },
  {
    id: 'code-retention',
    category: 'Security',
    question: 'What happens to the code I compile?',
    answer: 'Source and artifacts are written to a temporary directory on the server under random names, used for the build and download, and deleted after an hour. Builds run scriptc directly (never through a shell) with input validation, size limits and timeouts.',
  },
  {
    id: 'report',
    category: 'Security',
    question: 'How do I report a bug or vulnerability?',
    answer: 'Open an issue on the GitHub repository. For security problems, please contact the maintainers privately first.',
  },
];

export default function FAQPage() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category | 'All'>('All');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return FAQS.filter((faq) =>
      (category === 'All' || faq.category === category) &&
      (!q || faq.question.toLowerCase().includes(q) || faq.answer.toLowerCase().includes(q))
    );
  }, [query, category]);

  return (
    <div className="app-bg min-h-screen">
      <SiteHeader active="/faq">
        <Link href="/" className="btn btn-primary btn-sm">Open editor</Link>
      </SiteHeader>

      <main id="main" className="mx-auto max-w-3xl px-4 pt-16 pb-24">
        <div className="eyebrow">Help</div>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Frequently asked questions</h1>
        <p className="mt-3 text-gray-400">
          How NanoCLI Studio and scriptc work, what they support today, and how to run your own.
        </p>

        <div className="mt-8 flex flex-col gap-3">
          <div className="relative">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search questions…"
              aria-label="Search questions"
              className="input h-11 pl-10"
            />
            <svg className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(['All', ...CATEGORIES] as const).map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                aria-pressed={category === c}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                  category === c
                    ? 'border-accent bg-accent text-[var(--color-accent-fg)]'
                    : 'border-border text-gray-400 hover:border-border-strong hover:text-gray-100'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-8 divide-y divide-border border-y border-border">
          {filtered.map((faq) => (
            <details key={faq.id} id={faq.id} className="group py-5">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-6">
                <span className="font-medium text-gray-100">{faq.question}</span>
                <span className="mt-0.5 shrink-0 text-gray-500 transition-transform group-open:rotate-45" aria-hidden="true">+</span>
              </summary>
              <p className="mt-3 text-[15px] leading-relaxed text-gray-400">{faq.answer}</p>
              <span className="mt-3 inline-block font-mono text-xs text-gray-500">{faq.category}</span>
            </details>
          ))}
          {filtered.length === 0 && (
            <div className="py-12 text-center text-gray-500">
              No questions match “{query}”.{' '}
              <button onClick={() => { setQuery(''); setCategory('All'); }} className="text-gray-100 underline underline-offset-4">
                Clear filters
              </button>
            </div>
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
