'use client';

/**
 * NanoCLI Studio - Marketing Landing Page
 * Modern, highly-styled landing page with glass morphism and gradients
 */

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function LandingPage() {
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isScrolled, setIsScrolled] = useState(false);
  
  // Scroll effect
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 100);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);
  
  // Toggle dark mode
  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
    document.documentElement.classList.toggle('dark');
  };
  
  // Scroll to section
  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-black text-white overflow-x-hidden">
      {/* Navigation */}
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled ? 'bg-gray-900/80 backdrop-blur-lg shadow-2xl' : 'bg-transparent'
      }`}>
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl flex items-center justify-center">
              <span className="text-xl font-bold">N</span>
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
              NanoCLI
            </span>
          </Link>
          
          <div className="hidden md:flex items-center gap-8">
            <button
              onClick={() => scrollToSection('features')}
              className="text-gray-300 hover:text-white transition-colors"
            >
              Features
            </button>
            <button
              onClick={() => scrollToSection('pricing')}
              className="text-gray-300 hover:text-white transition-colors"
            >
              Pricing
            </button>
            <button
              onClick={() => scrollToSection('testimonials')}
              className="text-gray-300 hover:text-white transition-colors"
            >
              Testimonials
            </button>
            <button
              onClick={() => scrollToSection('faq')}
              className="text-gray-300 hover:text-white transition-colors"
            >
              FAQ
            </button>
          </div>
          
          <div className="flex items-center gap-4">
            <Link
              href="/app"
              className="hidden md:block px-6 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 rounded-full font-medium transition-all shadow-lg hover:shadow-purple-500/50"
            >
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
      
      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center justify-center px-4 pt-20">
        {/* Background Effects */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-pink-500/10 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gradient-to-r from-purple-500/5 to-pink-500/5 rounded-full blur-3xl" />
        </div>
        
        <div className="relative z-10 max-w-4xl mx-auto text-center">
          <div className="inline-block px-4 py-2 bg-gray-800/50 rounded-full border border-gray-700 mb-8">
            <span className="text-sm text-gray-400">Zero-Runtime TypeScript Compiler</span>
          </div>
          
          <h1 className="text-5xl md:text-7xl font-bold mb-6 leading-tight">
            Write TypeScript, 
            <span className="bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
              Get Native Binaries
            </span>
          </h1>
          
          <p className="text-xl md:text-2xl text-gray-400 mb-8 max-w-2xl mx-auto">
            Compile TypeScript to native executables in seconds. 
            No Node. No npm. No dependencies. Just 178KB of pure performance.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/app"
              className="px-8 py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 rounded-2xl font-semibold text-lg transition-all shadow-2xl hover:shadow-purple-500/50 transform hover:scale-105"
            >
              Start for Free
            </Link>
            <button
              onClick={() => scrollToSection('demo')}
              className="px-8 py-4 bg-transparent border-2 border-gray-600 hover:border-gray-500 rounded-2xl font-semibold text-lg transition-all"
            >
              See Demo
            </button>
          </div>
          
          <div className="mt-12 flex flex-col sm:flex-row gap-8 justify-center text-sm">
            <div className="flex items-center gap-2">
              <span className="text-green-500">✓</span>
              <span className="text-gray-400">No Node.js required</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-green-500">✓</span>
              <span className="text-gray-400">~2ms cold starts</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-green-500">✓</span>
              <span className="text-gray-400">178KB binaries</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-green-500">✓</span>
              <span className="text-gray-400">Cross-platform</span>
            </div>
          </div>
        </div>
      </section>
      
      {/* Demo Section */}
      <section id="demo" className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-4">
              See It In Action
            </h2>
            <p className="text-xl text-gray-400">
              Try NanoCLI Studio with a simple example
            </p>
          </div>
          
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="bg-gray-800/30 rounded-3xl p-8 border border-gray-700/50 backdrop-blur-lg">
              <h3 className="text-2xl font-bold mb-6">Code</h3>
              <div className="bg-gray-900 rounded-2xl p-6 font-mono text-sm overflow-x-auto">
                <pre className="text-gray-300">
<span className="text-purple-400">const</span> <span className="text-blue-400">args</span> = <span className="text-yellow-400">process.argv.slice</span>(<span className="text-green-400">2</span>);
<span className="text-purple-400">const</span> <span className="text-blue-400">name</span> = <span className="text-blue-400">args</span>[<span className="text-green-400">0</span>] || <span className="text-green-400">'World'</span>;

<span className="text-yellow-400">console.log</span>(<span className="text-green-400">`Hello, </span><span className="text-orange-400">\${name}</span><span className="text-green-400">!`</span>);
                </pre>
              </div>
              <button className="mt-6 w-full py-3 bg-purple-600/20 hover:bg-purple-600/30 rounded-xl font-medium transition-colors border border-purple-600/30">
                Copy Code
              </button>
            </div>
            
            <div className="bg-gray-800/30 rounded-3xl p-8 border border-gray-700/50 backdrop-blur-lg">
              <h3 className="text-2xl font-bold mb-6">Output</h3>
              <div className="bg-gray-900 rounded-2xl p-6 font-mono text-sm">
                <div className="text-green-400">$ ./app-linux Alice</div>
                <div className="text-white mt-2">Hello, Alice!</div>
                <div className="text-green-400 mt-4">$ ./app-macos Bob</div>
                <div className="text-white mt-2">Hello, Bob!</div>
                <div className="text-green-400 mt-4">$ ./app-windows.exe Charlie</div>
                <div className="text-white mt-2">Hello, Charlie!</div>
              </div>
              <div className="mt-6 grid grid-cols-3 gap-4 text-center text-sm">
                <div>
                  <div className="text-2xl font-bold text-purple-400">2ms</div>
                  <div className="text-gray-400">Startup</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-blue-400">178KB</div>
                  <div className="text-gray-400">Size</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-green-400">0</div>
                  <div className="text-gray-400">Deps</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      
      {/* Features Section */}
      <section id="features" className="py-20 px-4">
        <div className="max-w-6xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            Powerful Features
          </h2>
          <p className="text-xl text-gray-400 mb-16">
            Everything you need to build production-ready CLIs
          </p>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                icon: '⚡',
                title: 'Zero-Runtime',
                description: 'No Node.js, no V8, no JavaScript engine. Pure native code.',
                color: 'from-yellow-500 to-orange-500',
              },
              {
                icon: '🚀',
                title: 'Instant Startup',
                description: '~2ms cold starts vs 35-100ms with Node.js. No warmup needed.',
                color: 'from-blue-500 to-cyan-500',
              },
              {
                icon: '💾',
                title: 'Tiny Binaries',
                description: '178KB executables vs 10MB+ with Node.js. Easy to deploy.',
                color: 'from-green-500 to-emerald-500',
              },
              {
                icon: '🌐',
                title: 'Cross-Platform',
                description: 'Compile to Linux, macOS, and Windows from any platform.',
                color: 'from-purple-500 to-pink-500',
              },
              {
                icon: '🔧',
                title: 'Multiple Targets',
                description: 'Generate native binaries, C code, LLVM IR, or WASM.',
                color: 'from-indigo-500 to-blue-500',
              },
              {
                icon: '👥',
                title: 'Real-time Collab',
                description: 'Work together with others in real-time with WebSocket sync.',
                color: 'from-rose-500 to-pink-500',
              },
              {
                icon: '🔐',
                title: 'GitHub Integration',
                description: 'Save and load projects directly from your GitHub repos.',
                color: 'from-gray-500 to-slate-500',
              },
              {
                icon: '💻',
                title: 'Monaco Editor',
                description: 'Full-featured TypeScript editor with IntelliSense.',
                color: 'from-teal-500 to-cyan-500',
              },
              {
                icon: '🖥️',
                title: 'Live Terminal',
                description: 'Test your binaries with a built-in terminal emulator.',
                color: 'from-lime-500 to-green-500',
              },
            ].map((feature, index) => (
              <div
                key={index}
                className="bg-gray-800/30 rounded-3xl p-8 border border-gray-700/50 backdrop-blur-lg group hover:bg-gray-800/50 transition-all"
              >
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-6 bg-gradient-to-br ${feature.color} group-hover:scale-110 transition-transform`}>
                  {feature.icon}
                </div>
                <h3 className="text-xl font-bold mb-3">{feature.title}</h3>
                <p className="text-gray-400">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      
      {/* How It Works Section */}
      <section className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-4">
              How It Works
            </h2>
            <p className="text-xl text-gray-400">
              Simple workflow, powerful results
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: '01',
                title: 'Write Code',
                description: 'Use our Monaco Editor to write TypeScript. Full IntelliSense support.',
                color: 'from-purple-500 to-pink-500',
              },
              {
                step: '02',
                title: 'Compile',
                description: 'Click compile and choose your target: native, C, LLVM IR, or WASM.',
                color: 'from-blue-500 to-cyan-500',
              },
              {
                step: '03',
                title: 'Download',
                description: 'Get your compiled binary instantly. No waiting, no configuration.',
                color: 'from-green-500 to-emerald-500',
              },
            ].map((item, index) => (
              <div
                key={index}
                className="bg-gray-800/30 rounded-3xl p-8 border border-gray-700/50 backdrop-blur-lg"
              >
                <div className="text-4xl font-bold text-gray-600 mb-4">{item.step}</div>
                <h3 className="text-xl font-bold mb-3">{item.title}</h3>
                <p className="text-gray-400">{item.description}</p>
                <div className={`w-full h-1 bg-gradient-to-r ${item.color} rounded-full mt-6 opacity-50`} />
              </div>
            ))}
          </div>
        </div>
      </section>
      
      {/* Pricing Section */}
      <section id="pricing" className="py-20 px-4">
        <div className="max-w-6xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            Simple Pricing
          </h2>
          <p className="text-xl text-gray-400 mb-16">
            Free for individuals, affordable for teams
          </p>
          
          <div className="grid md:grid-cols-3 gap-8">
            {/* Free Plan */}
            <div className="bg-gray-800/30 rounded-3xl p-8 border border-gray-700/50 backdrop-blur-lg">
              <h3 className="text-2xl font-bold mb-2">Free</h3>
              <div className="text-4xl font-bold mb-4">$0</div>
              <p className="text-gray-400 mb-8">For individuals and open source</p>
              
              <ul className="space-y-4 mb-8">
                <li className="flex items-center gap-3">
                  <span className="text-green-500">✓</span>
                  <span>Unlimited projects</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="text-green-500">✓</span>
                  <span>Public repositories</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="text-green-500">✓</span>
                  <span>Community support</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="text-green-500">✓</span>
                  <span>NanoCLI branding</span>
                </li>
              </ul>
              
              <Link
                href="/app"
                className="w-full py-3 bg-transparent border-2 border-gray-600 hover:border-gray-500 rounded-xl font-medium transition-colors"
              >
                Get Started
              </Link>
            </div>
            
            {/* Pro Plan */}
            <div className="bg-gray-800/50 rounded-3xl p-8 border-2 border-purple-500 backdrop-blur-lg relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-b from-purple-500/5 to-transparent -z-10" />
              <h3 className="text-2xl font-bold mb-2">Pro</h3>
              <div className="text-4xl font-bold mb-4">$10<span className="text-lg font-normal">/mo</span></div>
              <p className="text-gray-400 mb-8">For professionals and small teams</p>
              
              <ul className="space-y-4 mb-8">
                <li className="flex items-center gap-3">
                  <span className="text-green-500">✓</span>
                  <span>Everything in Free</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="text-green-500">✓</span>
                  <span>Private repositories</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="text-green-500">✓</span>
                  <span>Custom domains</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="text-green-500">✓</span>
                  <span>Analytics dashboard</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="text-green-500">✓</span>
                  <span>Priority support</span>
                </li>
              </ul>
              
              <Link
                href="/app"
                className="w-full py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 rounded-xl font-medium transition-all"
              >
                Upgrade to Pro
              </Link>
            </div>
            
            {/* Enterprise Plan */}
            <div className="bg-gray-800/30 rounded-3xl p-8 border border-gray-700/50 backdrop-blur-lg">
              <h3 className="text-2xl font-bold mb-2">Enterprise</h3>
              <div className="text-4xl font-bold mb-4">Custom</div>
              <p className="text-gray-400 mb-8">For organizations</p>
              
              <ul className="space-y-4 mb-8">
                <li className="flex items-center gap-3">
                  <span className="text-green-500">✓</span>
                  <span>Everything in Pro</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="text-green-500">✓</span>
                  <span>Unlimited users</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="text-green-500">✓</span>
                  <span>On-premise deployment</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="text-green-500">✓</span>
                  <span>Team collaboration</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="text-green-500">✓</span>
                  <span>Dedicated support</span>
                </li>
              </ul>
              
              <button className="w-full py-3 bg-transparent border-2 border-gray-600 hover:border-gray-500 rounded-xl font-medium transition-colors">
                Contact Sales
              </button>
            </div>
          </div>
        </div>
      </section>
      
      {/* Testimonials Section */}
      <section id="testimonials" className="py-20 px-4">
        <div className="max-w-6xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            Loved by Developers
          </h2>
          <p className="text-xl text-gray-400 mb-16">
            What our users are saying
          </p>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                quote: 'NanoCLI Studio completely changed how I build CLIs. No more Node.js bloat, just pure native performance.',
                author: 'Sarah Chen',
                role: 'DevOps Engineer at TechCorp',
                avatar: 'SC',
              },
              {
                quote: 'The real-time collaboration is amazing. My team can work together on CLI tools like never before.',
                author: 'Mark Johnson',
                role: 'CTO at StartupX',
                avatar: 'MJ',
              },
              {
                quote: 'From TypeScript to native binary in seconds. This is exactly what the CLI ecosystem needed.',
                author: 'Emma Rodriguez',
                role: 'Open Source Maintainer',
                avatar: 'ER',
              },
              {
                quote: 'The WASM output is incredible. I can now deploy my tools to any platform without worrying about dependencies.',
                author: 'David Kim',
                role: 'Full Stack Developer',
                avatar: 'DK',
              },
              {
                quote: 'Finally, a tool that lets me write TypeScript without the Node.js runtime overhead. Game changer.',
                author: 'Lisa Patel',
                role: 'Senior Engineer at DataInc',
                avatar: 'LP',
              },
              {
                quote: 'The Monaco Editor integration is so smooth. Feels like VS Code in my browser.',
                author: 'James Wilson',
                role: 'Frontend Developer',
                avatar: 'JW',
              },
            ].map((testimonial, index) => (
              <div
                key={index}
                className="bg-gray-800/30 rounded-3xl p-8 border border-gray-700/50 backdrop-blur-lg"
              >
                <div className="flex items-center gap-2 mb-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <span key={i} className="text-yellow-500">★</span>
                  ))}
                </div>
                <p className="text-gray-300 mb-6 italic">{testimonial.quote}</p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-600 rounded-full flex items-center justify-center">
                    <span className="text-sm font-bold">{testimonial.avatar}</span>
                  </div>
                  <div className="text-left">
                    <div className="font-semibold">{testimonial.author}</div>
                    <div className="text-sm text-gray-400">{testimonial.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      
      {/* FAQ Section */}
      <section id="faq" className="py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-4">
              Frequently Asked Questions
            </h2>
            <p className="text-xl text-gray-400">
              Get your questions answered
            </p>
          </div>
          
          <div className="space-y-6">
            {[
              {
                question: 'What is NanoCLI Studio?',
                answer: 'NanoCLI Studio is a web-based IDE that lets you write TypeScript and compile it to native binaries, C code, LLVM IR, or WASM. It uses scriptc under the hood to achieve zero-runtime compilation.',
              },
              {
                question: 'How is this different from Node.js?',
                answer: 'Node.js requires a JavaScript runtime (~10MB+) and has 35-100ms cold starts. NanoCLI produces self-contained native binaries (~178KB) with ~2ms cold starts and zero dependencies.',
              },
              {
                question: 'Do I need to install anything?',
                answer: 'No! NanoCLI Studio runs entirely in your browser. Just write code, click compile, and download your binary. No Node.js, no npm, no configuration.',
              },
              {
                question: 'What platforms are supported?',
                answer: 'You can compile to Linux (x64, arm64), macOS (x64, arm64), and Windows (x64). The compilation happens server-side, so you can generate binaries for any platform from any device.',
              },
              {
                question: 'Can I use this for commercial projects?',
                answer: 'Yes! The Free plan allows commercial use. For additional features like private repositories and analytics, check out our Pro and Enterprise plans.',
              },
              {
                question: 'How does real-time collaboration work?',
                answer: 'NanoCLI Studio uses WebSocket connections to sync code changes between collaborators in real-time. You can see others typing, their cursor positions, and selections.',
              },
              {
                question: 'Can I integrate with GitHub?',
                answer: 'Yes! You can connect your GitHub account to save and load projects directly from your repositories. We support both public and private repos (private repos require Pro plan).',
              },
              {
                question: 'What is scriptc?',
                answer: 'scriptc is a revolutionary TypeScript compiler that compiles TypeScript to native code via LLVM. It enables zero-runtime TypeScript applications with native performance.',
              },
              {
                question: 'Is my code secure?',
                answer: 'Yes. Your code is compiled server-side and never stored permanently. We use HTTPS for all connections and follow best security practices.',
              },
              {
                question: 'Can I self-host NanoCLI Studio?',
                answer: 'Yes! The Enterprise plan includes on-premise deployment options. You can also deploy the open-source version yourself with Docker.',
              },
            ].map((faq, index) => (
              <div
                key={index}
                className="bg-gray-800/30 rounded-3xl p-8 border border-gray-700/50 backdrop-blur-lg"
              >
                <h3 className="text-xl font-bold mb-4">{faq.question}</h3>
                <p className="text-gray-400">{faq.answer}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      
      {/* CTA Section */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-bold mb-6">
            Ready to Build Something Amazing?
          </h2>
          <p className="text-xl text-gray-400 mb-8">
            Start building zero-runtime TypeScript CLIs today.
          </p>
          <Link
            href="/app"
            className="inline-block px-12 py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 rounded-3xl font-bold text-xl transition-all shadow-2xl hover:shadow-purple-500/50 transform hover:scale-105"
          >
            Launch NanoCLI Studio
          </Link>
        </div>
      </section>
      
      {/* Footer */}
      <footer className="py-16 px-4 border-t border-gray-800">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <h4 className="font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-gray-400">
                <li><Link href="/app" className="hover:text-white transition-colors">App</Link></li>
                <li><Link href="#features" className="hover:text-white transition-colors">Features</Link></li>
                <li><Link href="#pricing" className="hover:text-white transition-colors">Pricing</Link></li>
                <li><Link href="#faq" className="hover:text-white transition-colors">FAQ</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Resources</h4>
              <ul className="space-y-2 text-gray-400">
                <li><a href="https://docs.nano.cli" className="hover:text-white transition-colors">Documentation</a></li>
                <li><a href="https://github.com/BrandDeb/Aha" className="hover:text-white transition-colors">GitHub</a></li>
                <li><a href="https://blog.nano.cli" className="hover:text-white transition-colors">Blog</a></li>
                <li><a href="https://community.nano.cli" className="hover:text-white transition-colors">Community</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Legal</h4>
              <ul className="space-y-2 text-gray-400">
                <li><a href="https://nano.cli/privacy" className="hover:text-white transition-colors">Privacy</a></li>
                <li><a href="https://nano.cli/terms" className="hover:text-white transition-colors">Terms</a></li>
                <li><a href="https://nano.cli/security" className="hover:text-white transition-colors">Security</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Connect</h4>
              <ul className="space-y-2 text-gray-400">
                <li><a href="https://twitter.com/nano_cli" className="hover:text-white transition-colors">Twitter</a></li>
                <li><a href="https://discord.gg/nano-cli" className="hover:text-white transition-colors">Discord</a></li>
                <li><a href="mailto:hello@nano.cli" className="hover:text-white transition-colors">Email</a></li>
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
