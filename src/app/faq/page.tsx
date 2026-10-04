'use client';

/**
 * NanoCLI Studio - FAQ Page
 * Comprehensive FAQ with search and filtering
 */

import { useState } from 'react';
import Link from 'next/link';

interface FAQItem {
  id: string;
  question: string;
  answer: string;
  category: string;
  tags: string[];
}

export default function FAQPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  
  // FAQ Data
  const faqs: FAQItem[] = [
    {
      id: 'what-is-nanocli',
      question: 'What is NanoCLI Studio?',
      answer: 'NanoCLI Studio is a web-based IDE that lets you write TypeScript and compile it to native binaries, C code, LLVM IR, or WASM using scriptc. It provides a zero-runtime development environment where you can build production-ready CLI tools without Node.js, npm, or any dependencies.',
      category: 'General',
      tags: ['getting-started', 'overview'],
    },
    {
      id: 'how-different-from-node',
      question: 'How is NanoCLI Studio different from Node.js?',
      answer: 'Node.js requires a JavaScript runtime (~10MB+ binary) and has 35-100ms cold starts. NanoCLI Studio compiles TypeScript to self-contained native binaries (~178KB) with ~2ms cold starts and zero dependencies. There\'s no Node.js runtime, no V8 engine, and no JavaScript interpreter - just pure native code.',
      category: 'General',
      tags: ['comparison', 'performance'],
    },
    {
      id: 'no-installation',
      question: 'Do I need to install anything to use NanoCLI Studio?',
      answer: 'No! NanoCLI Studio runs entirely in your browser. Just open the app, write your TypeScript code, click compile, and download your binary. No Node.js installation, no npm, no configuration required. Everything happens server-side.',
      category: 'Getting Started',
      tags: ['setup', 'requirements'],
    },
    {
      id: 'supported-platforms',
      question: 'What platforms are supported?',
      answer: 'You can compile to Linux (x64, arm64), macOS (x64, arm64), and Windows (x64). The compilation happens server-side using scriptc and our cross-platform clang-wrapper, so you can generate binaries for any platform from any device - Windows, macOS, or Linux.',
      category: 'Platforms',
      tags: ['linux', 'macos', 'windows', 'cross-platform'],
    },
    {
      id: 'compilation-targets',
      question: 'What compilation targets are available?',
      answer: 'NanoCLI Studio supports four compilation targets: 1) Native Binary - Self-contained executable for your target platform, 2) C Code - Human-readable C code that you can inspect or modify, 3) LLVM IR - LLVM Intermediate Representation for further processing, 4) WASM - WebAssembly for browser or WASM runtime deployment.',
      category: 'Compilation',
      tags: ['native', 'c', 'llvm', 'wasm'],
    },
    {
      id: 'how-real-time-collab-works',
      question: 'How does real-time collaboration work?',
      answer: 'NanoCLI Studio uses WebSocket connections to sync code changes between collaborators in real-time. When you type, your changes are instantly broadcast to all other users in the same project. You can see their cursor positions, selections, and edits as they happen. The connection is encrypted and uses our WebSocket server for low-latency updates.',
      category: 'Collaboration',
      tags: ['websocket', 'multiplayer', 'live'],
    },
    {
      id: 'github-integration',
      question: 'Can I integrate with GitHub?',
      answer: 'Yes! You can connect your GitHub account to save and load projects directly from your repositories. We support OAuth 2.0 authentication, repository browsing, file read/write operations, and both public and private repositories. Private repository access requires a Pro plan.',
      category: 'GitHub',
      tags: ['oauth', 'repositories', 'version-control'],
    },
    {
      id: 'github-private-repos',
      question: 'Can I use private GitHub repositories?',
      answer: 'Private GitHub repository access is available on our Pro and Enterprise plans. The Free plan allows you to connect your GitHub account and access public repositories. Upgrade to Pro for private repository support, custom domains, analytics, and priority support.',
      category: 'GitHub',
      tags: ['private', 'pro', 'pricing'],
    },
    {
      id: 'what-is-scriptc',
      question: 'What is scriptc?',
      answer: 'scriptc is a revolutionary TypeScript compiler that compiles TypeScript to native code via LLVM. Unlike traditional TypeScript compilers that target JavaScript, scriptc compiles directly to native machine code, eliminating the need for a JavaScript runtime. This enables zero-runtime TypeScript applications with native performance characteristics.',
      category: 'Technology',
      tags: ['scriptc', 'compiler', 'llvm'],
    },
    {
      id: 'performance-benefits',
      question: 'What are the performance benefits of using scriptc?',
      answer: 'scriptc provides several performance advantages: 1) ~2ms cold starts (vs 35-100ms with Node.js), 2) ~178KB binary size (vs 10MB+ with Node.js), 3) ~1-4MB memory usage (vs 60-100MB with Node.js), 4) No GC pauses = deterministic latency, 5) Zero runtime overhead. These benefits make scriptc ideal for edge computing, CLI tools, and performance-critical applications.',
      category: 'Performance',
      tags: ['speed', 'memory', 'latency'],
    },
    {
      id: 'security',
      question: 'Is my code secure when using NanoCLI Studio?',
      answer: 'Yes, security is a top priority. Your code is compiled server-side and never stored permanently. We use HTTPS for all connections, follow best security practices, and don\'t retain your source code after compilation. For additional security, you can self-host NanoCLI Studio using our Docker image or Enterprise on-premise deployment.',
      category: 'Security',
      tags: ['privacy', 'encryption', 'self-host'],
    },
    {
      id: 'self-host',
      question: 'Can I self-host NanoCLI Studio?',
      answer: 'Yes! You can self-host NanoCLI Studio using Docker. The Enterprise plan includes on-premise deployment options with dedicated support. You can also deploy the open-source version yourself: 1) Build the Docker image: docker build -t nano-cli-studio ., 2) Run the container: docker run -p 3000:3000 nano-cli-studio, 3) Set up environment variables for GitHub OAuth and other configurations.',
      category: 'Deployment',
      tags: ['docker', 'on-premise', 'enterprise'],
    },
    {
      id: 'monaco-editor',
      question: 'What is Monaco Editor and why is it used?',
      answer: 'Monaco Editor is the code editor that powers VS Code. We use it in NanoCLI Studio to provide a full-featured TypeScript editing experience with syntax highlighting, IntelliSense, code navigation, and other advanced features. It\'s the same editor used in VS Code, GitHub Codespaces, and many other professional development tools.',
      category: 'Editor',
      tags: ['monaco', 'editor', 'vscode'],
    },
    {
      id: 'autosave',
      question: 'Does NanoCLI Studio auto-save my work?',
      answer: 'Yes! NanoCLI Studio automatically saves your work. For the Monaco Editor, changes are saved to the browser\'s local storage. For projects, changes are synced in real-time if you\'re using collaboration mode. You can also manually save by clicking the Save button or using the Ctrl/Cmd + S keyboard shortcut.',
      category: 'Editor',
      tags: ['save', 'auto-save', 'persistence'],
    },
    {
      id: 'keyboard-shortcuts',
      question: 'What keyboard shortcuts are available?',
      answer: 'NanoCLI Studio supports the standard Monaco Editor keyboard shortcuts: Ctrl/Cmd + S - Save, Ctrl/Cmd + F - Find, Ctrl/Cmd + Z - Undo, Ctrl/Cmd + Y - Redo, Ctrl/Cmd + C - Copy, Ctrl/Cmd + V - Paste, Ctrl/Cmd + / - Comment, Ctrl/Cmd + \ - Toggle line comment, Tab - Indent, Shift + Tab - Outdent, Ctrl/Cmd + Arrow - Move cursor by word, Shift + Ctrl/Cmd + Arrow - Select by word.',
      category: 'Editor',
      tags: ['shortcuts', 'keyboard', 'productivity'],
    },
    {
      id: 'multiple-files',
      question: 'Can I work with multiple files in a project?',
      answer: 'Yes! NanoCLI Studio supports multi-file projects. You can create, edit, and manage multiple files within a project. Use the Project Explorer to navigate between files, create new files, delete files, and organize your project structure. Each file can have its own language mode (TypeScript, JavaScript, Python, etc.).',
      category: 'Projects',
      tags: ['files', 'multi-file', 'projects'],
    },
    {
      id: 'multiple-projects',
      question: 'Can I have multiple projects?',
      answer: 'Yes! You can create and manage multiple projects in NanoCLI Studio. Each project has its own set of files and configuration. Use the Project Explorer to switch between projects, create new projects, or delete existing ones. Your projects are saved to the browser\'s local storage and can be synced to GitHub if you connect your account.',
      category: 'Projects',
      tags: ['projects', 'multi-project', 'organization'],
    },
    {
      id: 'terminal-emulator',
      question: 'How does the live terminal emulator work?',
      answer: 'The live terminal emulator in NanoCLI Studio provides a simulated bash environment where you can run commands and test your compiled binaries. It supports basic commands like ls, pwd, echo, clear, help, compile, date, and time. The compile command triggers compilation of your current file. The terminal maintains a history of commands and outputs.',
      category: 'Terminal',
      tags: ['terminal', 'commands', 'testing'],
    },
    {
      id: 'ai-gateway',
      question: 'What is the AI Gateway feature?',
      answer: 'The AI Gateway is a feature that lets you route LLM (Large Language Model) requests to the fastest or cheapest provider. It supports multiple providers including OpenRouter, Groq, Firebase, Anthropic, and Mistral. The gateway provides ~2ms cold starts, latency-based routing, A/B testing support, and real-time monitoring. It\'s designed for edge deployment with zero runtime overhead.',
      category: 'AI Gateway',
      tags: ['ai', 'llm', 'gateway', 'providers'],
    },
    {
      id: 'ai-providers',
      question: 'Which AI providers are supported?',
      answer: 'The AI Gateway currently supports these providers: OpenRouter - Fast and cost-effective, Groq - Ultra-low latency, Firebase - Google\'s AI platform, Anthropic - Claude models, Mistral - Open-source models. Each provider has different latency, cost, and capability characteristics. The gateway can auto-route to the fastest provider or let you manually select.',
      category: 'AI Gateway',
      tags: ['openrouter', 'groq', 'firebase', 'anthropic', 'mistral'],
    },
    {
      id: 'auth-middleware',
      question: 'What is the Auth Middleware feature?',
      answer: 'The Auth Middleware is a feature for validating JWTs, API keys, and OAuth tokens at the edge with ~1ms latency. It provides cryptographic validation without the node:crypto dependency, resulting in tiny 178KB binaries. You can deploy it to any edge runtime like Cloudflare Workers, Vercel Edge, or AWS Lambda@Edge.',
      category: 'Auth',
      tags: ['auth', 'jwt', 'api-keys', 'middleware'],
    },
    {
      id: 'auth-algorithms',
      question: 'Which authentication algorithms are supported?',
      answer: 'The Auth Middleware supports these algorithms for JWT validation: HS256 - HMAC with SHA-256, RS256 - RSA with SHA-256, ES256 - ECDSA with SHA-256, PS256 - RSASSA-PSS with SHA-256, EdDSA - Edwards-curve Digital Signature Algorithm. These cover the most common JWT signing algorithms used in modern authentication systems.',
      category: 'Auth',
      tags: ['jwt', 'algorithms', 'security'],
    },
    {
      id: 'url-shortener',
      question: 'How does the URL Shortener work?',
      answer: 'The URL Shortener in NanoCLI Studio creates short URLs without requiring a database. It uses KV (Key-Value) storage like Cloudflare KV or Redis to store the URL mappings. Features include custom domain support, analytics (click counting), expiration dates, and password protection. The shortener provides ~1ms latency for URL redirection.',
      category: 'URL Shortener',
      tags: ['url', 'shortener', 'kv', 'analytics'],
    },
    {
      id: 'markdown-editor',
      question: 'What features does the Markdown Editor have?',
      answer: 'The Markdown Editor in NanoCLI Studio provides offline-first markdown editing with these features: Live preview - See rendered markdown as you type, Multiple notes - Switch between different markdown files, Tag support - Organize notes with tags, Auto-save - Changes are saved automatically, Full-text search - Find content across all notes, Export options - Download as markdown or PDF.',
      category: 'Markdown',
      tags: ['markdown', 'editor', 'notes'],
    },
    {
      id: 'analytics-dashboard',
      question: 'What metrics does the Analytics Dashboard show?',
      answer: 'The Analytics Dashboard provides real-time monitoring of your scriptc-powered edge functions with these metrics: Total requests, Average latency, Requests by type (AI, Auth, URL, etc.), Requests by provider (OpenRouter, Groq, etc.), Cold start latency, Memory usage, Binary size, Requests per second. The dashboard updates in real-time and shows historical trends.',
      category: 'Analytics',
      tags: ['analytics', 'metrics', 'monitoring'],
    },
    {
      id: 'free-plan',
      question: 'What does the Free plan include?',
      answer: 'The Free plan includes: Unlimited projects, Public GitHub repositories, Community support, Monaco Editor with all features, All compilation targets (native, C, LLVM, WASM), Real-time collaboration, Terminal emulator, NanoCLI branding. It\'s perfect for individuals, open source projects, and getting started with NanoCLI Studio.',
      category: 'Pricing',
      tags: ['free', 'pricing', 'features'],
    },
    {
      id: 'pro-plan',
      question: 'What does the Pro plan include?',
      answer: 'The Pro plan ($10/month) includes everything in Free plus: Private GitHub repositories, Custom domains for your compiled binaries, Analytics dashboard with advanced metrics, Priority support, Early access to new features. It\'s designed for professionals and small teams who need additional features and support.',
      category: 'Pricing',
      tags: ['pro', 'pricing', 'features'],
    },
    {
      id: 'enterprise-plan',
      question: 'What does the Enterprise plan include?',
      answer: 'The Enterprise plan (custom pricing) includes everything in Pro plus: Unlimited users, On-premise deployment, Team collaboration features, Dedicated support with SLA, Custom integrations, White-label options, Advanced security features. It\'s designed for organizations that need full control and support.',
      category: 'Pricing',
      tags: ['enterprise', 'pricing', 'on-premise'],
    },
    {
      id: 'payment-methods',
      question: 'What payment methods are accepted?',
      answer: 'We accept major credit cards (Visa, Mastercard, American Express) through Stripe for Pro and Enterprise plans. For Enterprise plans, we also support invoice billing and purchase orders. Contact our sales team at hello@nano.cli for custom payment arrangements.',
      category: 'Pricing',
      tags: ['payment', 'billing', 'stripe'],
    },
    {
      id: 'refund-policy',
      question: 'What is your refund policy?',
      answer: 'We offer a 14-day money-back guarantee for Pro plan subscriptions. If you\'re not satisfied with your purchase, contact us within 14 days of your subscription start date for a full refund. For Enterprise plans, refunds are handled on a case-by-case basis according to your contract.',
      category: 'Pricing',
      tags: ['refund', 'guarantee', 'cancellation'],
    },
    {
      id: 'data-portability',
      question: 'Can I export my data?',
      answer: 'Yes! You can export your projects and data at any time. For projects saved in the browser, you can download them as individual files. For projects saved to GitHub, you already have full access to your repositories. We also provide an API for programmatic access to your data.',
      category: 'Data',
      tags: ['export', 'portability', 'backup'],
    },
    {
      id: 'data-retention',
      question: 'How long is my data retained?',
      answer: 'Your compiled code and temporary files are deleted immediately after compilation. Project data saved to the browser is retained until you clear your browser cache. Projects saved to GitHub are subject to GitHub\'s data retention policies. We don\'t retain your source code or compiled binaries on our servers.',
      category: 'Data',
      tags: ['retention', 'privacy', 'deletion'],
    },
    {
      id: 'support',
      question: 'How can I get support?',
      answer: 'For Free plan users: Community support through Discord and GitHub discussions. For Pro plan users: Priority support via email and Discord. For Enterprise plan users: Dedicated support with SLA, phone support, and a dedicated account manager. You can also find answers in our documentation, FAQ, and blog.',
      category: 'Support',
      tags: ['help', 'support', 'contact'],
    },
    {
      id: 'report-bug',
      question: 'How do I report a bug or request a feature?',
      answer: 'You can report bugs and request features through GitHub Issues. Please include as much detail as possible: steps to reproduce, expected behavior, actual behavior, screenshots, and your browser/OS information. For urgent issues, Pro and Enterprise users can contact support directly.',
      category: 'Support',
      tags: ['bug', 'feature', 'feedback'],
    },
    {
      id: 'contributing',
      question: 'How can I contribute to NanoCLI Studio?',
      answer: 'We welcome contributions! You can contribute by: 1) Reporting bugs and requesting features, 2) Submitting pull requests with fixes or improvements, 3) Writing documentation or tutorials, 4) Helping others in the community, 5) Sponsoring the project. See our CONTRIBUTING.md file for detailed guidelines.',
      category: 'Community',
      tags: ['contribute', 'open-source', 'github'],
    },
    {
      id: 'roadmap',
      question: 'What\'s on the roadmap?',
      answer: 'Our roadmap includes: Plugin system for extensibility, Debugger with breakpoints, Package.json management for dependencies, Performance profiler, Export/Import projects as ZIP, Dependency graph visualization, More AI providers, WebSocket improvements, Mobile app (React Native), Desktop app (Tauri). Follow our blog and GitHub for updates.',
      category: 'Roadmap',
      tags: ['future', 'planned', 'upcoming'],
    },
    {
      id: 'changelog',
      question: 'Where can I find the changelog?',
      answer: 'You can find the changelog in several places: 1) GitHub Releases page for major version updates, 2) CHANGELOG.md file in the repository, 3) Our blog at blog.nano.cli, 4) In-app notifications for important updates. We follow semantic versioning (SemVer) for all releases.',
      category: 'Updates',
      tags: ['changelog', 'releases', 'updates'],
    },
    {
      id: 'status-page',
      question: 'Is there a status page for service uptime?',
      answer: 'Yes! You can check our service status at status.nano.cli. The status page shows the current status of all our services including the web app, API, compilation service, and authentication. You can also subscribe to updates via email or RSS.',
      category: 'Reliability',
      tags: ['status', 'uptime', 'reliability'],
    },
  ];
  
  // Categories
  const categories = ['all', 'General', 'Getting Started', 'Platforms', 'Compilation', 'Collaboration', 'GitHub', 'Technology', 'Performance', 'Security', 'Deployment', 'Editor', 'Projects', 'Terminal', 'AI Gateway', 'Auth', 'URL Shortener', 'Markdown', 'Analytics', 'Pricing', 'Data', 'Support', 'Community', 'Roadmap', 'Updates', 'Reliability'];
  
  // Filter FAQs
  const filteredFAQs = faqs.filter(faq => {
    const matchesSearch = faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         faq.answer.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         faq.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCategory = selectedCategory === 'all' || faq.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });
  
  // Toggle FAQ item
  const toggleFAQ = (id: string) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedItems(newExpanded);
  };
  
  // Toggle dark mode
  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
    document.documentElement.classList.toggle('dark');
  };
  
  // Clear search
  const clearSearch = () => {
    setSearchQuery('');
  };
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-black text-white">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-gray-900/80 backdrop-blur-lg border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl flex items-center justify-center">
              <span className="text-xl font-bold">N</span>
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
              NanoCLI
            </span>
          </Link>
          
          <div className="flex items-center gap-4">
            <Link href="/app" className="px-4 py-2 bg-purple-600/20 hover:bg-purple-600/30 rounded-xl font-medium transition-colors">
              Launch App
            </Link>
            <button
              onClick={toggleDarkMode}
              className="p-2 rounded-full bg-gray-800 hover:bg-gray-700 transition-colors"
            >
              {isDarkMode ? '☀️' : '🌙'}
            </button>
          </div>
        </div>
      </nav>
      
      <div className="max-w-4xl mx-auto px-4 py-20">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            Frequently Asked Questions
          </h1>
          <p className="text-xl text-gray-400">
            Find answers to common questions about NanoCLI Studio
          </p>
        </div>
        
        {/* Search and Filter */}
        <div className="mb-12">
          <div className="bg-gray-800/30 rounded-2xl p-6 border border-gray-700/50 backdrop-blur-lg">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search FAQs..."
                  className="w-full p-4 bg-gray-800 rounded-xl border border-gray-700 focus:border-purple-500 focus:outline-none text-white"
                />
                {searchQuery && (
                  <button
                    onClick={clearSearch}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                  >
                    ✕
                  </button>
                )}
              </div>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="p-4 bg-gray-800 rounded-xl border border-gray-700 focus:border-purple-500 focus:outline-none text-white"
              >
                {categories.map(category => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>
            
            <div className="mt-4 text-sm text-gray-400">
              {filteredFAQs.length} {filteredFAQs.length === 1 ? 'result' : 'results'} found
              {searchQuery && ` for "${searchQuery}"`}
              {selectedCategory !== 'all' && ` in ${selectedCategory}`}
            </div>
          </div>
        </div>
        
        {/* FAQ List */}
        <div className="space-y-4">
          {filteredFAQs.length > 0 ? (
            filteredFAQs.map(faq => (
              <div
                key={faq.id}
                className="bg-gray-800/30 rounded-2xl border border-gray-700/50 backdrop-blur-lg overflow-hidden"
              >
                <button
                  onClick={() => toggleFAQ(faq.id)}
                  className="w-full p-6 text-left flex items-center justify-between"
                >
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold mb-2">{faq.question}</h3>
                    <div className="flex items-center gap-3 text-sm text-gray-400">
                      <span className="px-2 py-1 bg-gray-700 rounded">{faq.category}</span>
                      {faq.tags.slice(0, 2).map(tag => (
                        <span key={tag} className="px-2 py-1 bg-gray-700/50 rounded text-xs">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <span className="text-2xl transition-transform {
                    expandedItems.has(faq.id) ? 'rotate-180' : ''
                  }" />
                </button>
                
                {expandedItems.has(faq.id) && (
                  <div className="p-6 pt-0 text-gray-400">
                    <p className="whitespace-pre-wrap">{faq.answer}</p>
                    {faq.tags.length > 2 && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {faq.tags.slice(2).map(tag => (
                          <span key={tag} className="px-2 py-1 bg-gray-700/50 rounded text-xs">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="text-center py-16">
              <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">❓</span>
              </div>
              <h3 className="text-xl font-semibold mb-2">No FAQs found</h3>
              <p className="text-gray-400">
                Try adjusting your search query or filter
              </p>
            </div>
          )}
        </div>
        
        {/* Categories Navigation */}
        <div className="mt-16">
          <h3 className="text-xl font-semibold mb-6">Browse by Category</h3>
          <div className="flex flex-wrap gap-3">
            {categories.filter(c => c !== 'all').map(category => (
              <button
                key={category}
                onClick={() => {
                  setSelectedCategory(category);
                  setSearchQuery('');
                }}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                  selectedCategory === category
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-800/50 text-gray-400 hover:bg-gray-800 hover:text-white'
                }`}
              >
                {category}
              </button>
            ))}
          </div>
        </div>
      </div>
      
      {/* Footer */}
      <footer className="py-16 px-4 border-t border-gray-800">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <h4 className="font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-gray-400">
                <li><Link href="/app" className="hover:text-white transition-colors">App</Link></li>
                <li><Link href="/landing" className="hover:text-white transition-colors">Landing</Link></li>
                <li><Link href="/onboarding" className="hover:text-white transition-colors">Onboarding</Link></li>
                <li><Link href="/unified" className="hover:text-white transition-colors">Unified</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Resources</h4>
              <ul className="space-y-2 text-gray-400">
                <li><a href="https://docs.nano.cli" className="hover:text-white transition-colors">Documentation</a></li>
                <li><a href="https://github.com/BrandDeb/Aha" className="hover:text-white transition-colors">GitHub</a></li>
                <li><Link href="/faq" className="hover:text-white transition-colors">FAQ</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Legal</h4>
              <ul className="space-y-2 text-gray-400">
                <li><a href="https://nano.cli/privacy" className="hover:text-white transition-colors">Privacy</a></li>
                <li><a href="https://nano.cli/terms" className="hover:text-white transition-colors">Terms</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Connect</h4>
              <ul className="space-y-2 text-gray-400">
                <li><a href="https://twitter.com/nano_cli" className="hover:text-white transition-colors">Twitter</a></li>
                <li><a href="https://discord.gg/nano-cli" className="hover:text-white transition-colors">Discord</a></li>
              </ul>
            </div>
          </div>
          
          <div className="pt-8 border-t border-gray-800 flex flex-col md:flex-row justify-between items-center text-gray-400 text-sm">
            <div>© {new Date().getFullYear()} NanoCLI Studio. All rights reserved.</div>
            <div>Built with ❤️ using scriptc</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
