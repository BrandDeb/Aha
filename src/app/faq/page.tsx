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

const CATEGORIES = ['General', 'Compiling', 'Studio', 'GitHub', 'Self-hosting', 'Security'] as const;
type Category = (typeof CATEGORIES)[number];

const FAQS: FAQItem[] = [
  {
    id: 'what-is-nanocli',
    category: 'General',
    question: 'What is NanoCLI Studio?',
    answer: 'A browser IDE for building command-line tools in TypeScript. You write code in a Monaco editor, the server compiles it with scriptc, and you download a native executable or a WebAssembly module.',
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
    category: 'Studio',
    question: 'What do the templates cover?',
    answer: 'Nine starter programs — hello world, a recursive-descent calculator, wc, a JSON formatter, typed math utilities, a Fibonacci benchmark, an HTTP server, a fetch client and an async countdown. CI compiles every one of them with scriptc, so they always build.',
  },
  {
    id: 'shortcuts',
    category: 'Studio',
    question: 'What keyboard shortcuts are there?',
    answer: '⌘↵ / Ctrl+Enter compiles. Everything else is standard Monaco: ⌘F find, ⌘/ toggle comment, ⌥↑/↓ move line, F2 rename symbol, and ⌘K ⌘0 to fold everything.',
  },
  {
    id: 'collab',
    category: 'Studio',
    question: 'How does live collaboration work?',
    answer: 'Turn on live collaboration and share the project link. Edits are relayed over a WebSocket to everyone in the same project. The server only accepts connections from the studio’s own origin and stamps each message with the sender’s connection identity.',
  },
  {
    id: 'saving',
    category: 'Studio',
    question: 'Is my work saved?',
    answer: 'Not automatically. Use Share to get a link that encodes the code, commit to GitHub from the studio, or download the source. Reloading the page starts from the default program.',
  },
  {
    id: 'terminal',
    category: 'Studio',
    question: 'Does the terminal run my binary?',
    answer: 'No — the studio terminal is a small simulated shell (ls, echo, compile, …) that runs in your browser. Download the executable to run it on your machine.',
  },
  {
    id: 'github-connect',
    category: 'GitHub',
    question: 'What can the GitHub integration do?',
    answer: 'Sign in with GitHub, browse your repositories and folders, open a file in the editor, and commit the editor contents back — either updating the file you opened (with conflict detection) or creating a new one in the folder you browsed to.',
  },
  {
    id: 'github-scope',
    category: 'GitHub',
    question: 'What access does the GitHub app request?',
    answer: 'The OAuth app asks for the `repo` and `read:user` scopes so it can read and write repository contents, including private repositories you choose to open. The token is kept in an HTTP-only cookie and is never exposed to page scripts. Sign out to delete it.',
  },
  {
    id: 'self-host',
    category: 'Self-hosting',
    question: 'How do I run my own instance?',
    answer: 'Clone the repository and run `docker compose up -d`. The image contains the Next.js app, the collaboration server, scriptc and its clang/lld/zig toolchain. For GitHub sign-in, create an OAuth app and set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and NEXT_PUBLIC_BASE_URL.',
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

      <main className="mx-auto max-w-3xl px-4 pt-16 pb-24">
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
                    ? 'border-gray-100 bg-gray-100 text-black'
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
