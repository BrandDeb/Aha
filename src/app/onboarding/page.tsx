'use client';

/**
 * NanoCLI Studio - Onboarding Flow
 * Step-by-step guide for new users
 */

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function OnboardingPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    experience: '',
    useCase: '',
    template: '',
  });
  
  // Auto-advance timer
  useEffect(() => {
    const timer = setTimeout(() => {
      // Auto-advance if on first few steps and no interaction
      if (currentStep < 3 && !formData.name) {
        setCurrentStep(currentStep + 1);
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, [currentStep, formData.name]);
  
  // Steps
  const steps = [
    {
      number: 1,
      title: 'Welcome to NanoCLI Studio',
      description: 'The zero-runtime TypeScript compiler that lets you build native binaries in seconds.',
      content: (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 p-6 rounded-xl border border-purple-500/20">
            <h3 className="text-xl font-bold mb-4">What You Can Do</h3>
            <ul className="space-y-3 text-gray-300">
              <li className="flex items-center gap-3">
                <span className="text-purple-500">✨</span>
                <span>Write TypeScript in your browser</span>
              </li>
              <li className="flex items-center gap-3">
                <span className="text-purple-500">⚡</span>
                <span>Compile to native binaries instantly</span>
              </li>
              <li className="flex items-center gap-3">
                <span className="text-purple-500">🌐</span>
                <span>Deploy to any platform</span>
              </li>
              <li className="flex items-center gap-3">
                <span className="text-purple-500">👥</span>
                <span>Collaborate in real-time</span>
              </li>
            </ul>
          </div>
          <div className="text-center">
            <button
              onClick={() => setCurrentStep(2)}
              className="px-8 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 rounded-xl font-semibold transition-all"
            >
              Get Started
            </button>
          </div>
        </div>
      ),
    },
    {
      number: 2,
      title: 'Tell Us About Yourself',
      description: 'Help us personalize your experience.',
      content: (
        <div className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium mb-2">Your Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="John Doe"
                className="w-full p-3 bg-gray-800 rounded-xl border border-gray-700 focus:border-purple-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="john@example.com"
                className="w-full p-3 bg-gray-800 rounded-xl border border-gray-700 focus:border-purple-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium mb-2">Experience Level</label>
              <select
                value={formData.experience}
                onChange={(e) => setFormData({ ...formData, experience: e.target.value })}
                className="w-full p-3 bg-gray-800 rounded-xl border border-gray-700 focus:border-purple-500 focus:outline-none"
              >
                <option value="">Select your experience</option>
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
                <option value="expert">Expert</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Primary Use Case</label>
              <select
                value={formData.useCase}
                onChange={(e) => setFormData({ ...formData, useCase: e.target.value })}
                className="w-full p-3 bg-gray-800 rounded-xl border border-gray-700 focus:border-purple-500 focus:outline-none"
              >
                <option value="">What will you build?</option>
                <option value="cli-tools">CLI Tools</option>
                <option value="scripts">Automation Scripts</option>
                <option value="services">Microservices</option>
                <option value="experiment">Experimentation</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div className="text-center">
            <button
              onClick={() => setCurrentStep(3)}
              disabled={!formData.name}
              className="px-8 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 rounded-xl font-semibold transition-all disabled:opacity-50"
            >
              Continue
            </button>
          </div>
        </div>
      ),
    },
    {
      number: 3,
      title: 'Choose Your Adventure',
      description: 'Select a starting template or begin from scratch.',
      content: (
        <div className="space-y-6">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                name: 'Hello World',
                description: 'Simple TypeScript CLI',
                icon: '👋',
                color: 'from-blue-500 to-cyan-500',
              },
              {
                name: 'HTTP Server',
                description: 'TypeScript HTTP server',
                icon: '🌐',
                color: 'from-green-500 to-emerald-500',
              },
              {
                name: 'File Processor',
                description: 'File manipulation utilities',
                icon: '📁',
                color: 'from-purple-500 to-pink-500',
              },
              {
                name: 'API Client',
                description: 'HTTP API client',
                icon: '🔗',
                color: 'from-orange-500 to-yellow-500',
              },
              {
                name: 'Math Utilities',
                description: 'Math operations library',
                icon: '➕',
                color: 'from-indigo-500 to-blue-500',
              },
              {
                name: 'Empty Project',
                description: 'Start from scratch',
                icon: '📝',
                color: 'from-gray-500 to-slate-500',
              },
            ].map((template, index) => (
              <button
                key={index}
                onClick={() => {
                  setFormData({ ...formData, template: template.name });
                  setCurrentStep(4);
                }}
                className="bg-gray-800/50 rounded-xl p-6 border border-gray-700 hover:bg-gray-800 hover:border-gray-600 transition-all text-left"
              >
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl mb-4 bg-gradient-to-br ${template.color}`}>
                  {template.icon}
                </div>
                <h3 className="font-semibold mb-2">{template.name}</h3>
                <p className="text-sm text-gray-400">{template.description}</p>
              </button>
            ))}
          </div>
          <div className="text-center">
            <button
              onClick={() => setCurrentStep(4)}
              className="px-8 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl font-semibold transition-colors"
            >
              Start Empty
            </button>
          </div>
        </div>
      ),
    },
    {
      number: 4,
      title: 'Tour the Interface',
      description: 'Quick overview of NanoCLI Studio features.',
      content: (
        <div className="space-y-6">
          <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
            <h3 className="text-xl font-bold mb-4">Main Features</h3>
            <div className="grid md:grid-cols-2 gap-6">
              {[
                { name: 'Editor', icon: '💻', desc: 'Monaco Editor with TypeScript support' },
                { name: 'Compiler', icon: '⚙️', desc: 'Compile to native, C, LLVM, or WASM' },
                { name: 'Projects', icon: '📁', desc: 'Multi-file project management' },
                { name: 'Terminal', icon: '🖥️', desc: 'Live terminal emulator' },
                { name: 'Collaboration', icon: '👥', desc: 'Real-time multi-user editing' },
                { name: 'GitHub', icon: '🔐', desc: 'Save to GitHub repositories' },
              ].map((feature, index) => (
                <div key={index} className="flex items-center gap-3 p-3 bg-gray-700/50 rounded-lg">
                  <span className="text-2xl">{feature.icon}</span>
                  <div>
                    <div className="font-semibold">{feature.name}</div>
                    <div className="text-sm text-gray-400">{feature.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="text-center">
            <button
              onClick={() => setCurrentStep(5)}
              className="px-8 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 rounded-xl font-semibold transition-all"
            >
              Next
            </button>
          </div>
        </div>
      ),
    },
    {
      number: 5,
      title: 'Ready to Build!',
      description: 'Your journey starts now.',
      content: (
        <div className="space-y-6 text-center">
          <div className="w-24 h-24 bg-gradient-to-br from-purple-500 to-pink-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <span className="text-4xl">🎉</span>
          </div>
          <h3 className="text-2xl font-bold mb-4">You&apos;re All Set!</h3>
          <p className="text-gray-400 mb-8 max-w-md mx-auto">
            {formData.name ? `Welcome, ${formData.name}! ` : 'Welcome! '}
            Start building amazing things with NanoCLI Studio.
          </p>
          <div className="space-y-4">
            <Link
              href="/app"
              className="block w-full max-w-md mx-auto px-8 py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 rounded-2xl font-bold text-lg transition-all"
            >
              Launch NanoCLI Studio
            </Link>
            <Link
              href="/landing"
              className="block w-full max-w-md mx-auto px-8 py-4 bg-transparent border-2 border-gray-600 hover:border-gray-500 rounded-2xl font-bold text-lg transition-all"
            >
              Back to Landing
            </Link>
          </div>
        </div>
      ),
    },
  ];
  
  // Current step data
  const current = steps[currentStep - 1];
  
  // Toggle dark mode
  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
    document.documentElement.classList.toggle('dark');
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
          <button
            onClick={toggleDarkMode}
            className="p-2 rounded-full bg-gray-800 hover:bg-gray-700 transition-colors"
          >
            {isDarkMode ? '☀️' : '🌙'}
          </button>
        </div>
      </nav>
      
      <div className="max-w-4xl mx-auto px-4 py-20">
        {/* Progress */}
        <div className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <button
                onClick={() => currentStep > 1 && setCurrentStep(currentStep - 1)}
                disabled={currentStep === 1}
                className="p-2 rounded-full bg-gray-800 hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                ←
              </button>
              <span className="text-sm text-gray-400">
                Step {currentStep} of {steps.length}
              </span>
            </div>
            <button
              onClick={() => router.push('/landing')}
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              Skip
            </button>
          </div>
          
          {/* Progress Bar */}
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full"
              style={{ width: `${((currentStep - 1) / (steps.length - 1)) * 100}%` }}
            />
          </div>
        </div>
        
        {/* Step Content */}
        <div className="bg-gray-800/30 rounded-3xl p-8 border border-gray-700/50 backdrop-blur-lg">
          <div className="text-center mb-8">
            <div className="inline-block px-4 py-2 bg-purple-500/10 rounded-full border border-purple-500/20 mb-4">
              <span className="text-sm font-medium text-purple-400">Step {current.number}</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold mb-4">{current.title}</h1>
            <p className="text-xl text-gray-400">{current.description}</p>
          </div>
          
          <div className="min-h-[400px]">
            {current.content}
          </div>
        </div>
      </div>
      
      {/* Footer */}
      <footer className="py-8 text-center text-gray-500 text-sm">
        <p>© {new Date().getFullYear()} NanoCLI Studio</p>
      </footer>
    </div>
  );
}
