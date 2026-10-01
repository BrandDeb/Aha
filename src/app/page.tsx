'use client';

/**
 * NanoCLI Studio - Main Page
 * Zero-Runtime TypeScript CLI Generator
 * 
 * Write TypeScript in your browser → Get native binaries in seconds.
 * No Node. No npm. No dependencies. Just 178KB of pure, instant performance.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { compileTypeScriptBrowser } from '@/lib/compiler-browser';
import { WebSocketManager } from '@/lib/websocket';

export default function HomePage() {
  const router = useRouter();
  const [code, setCode] = useState<string>(`// NanoCLI Studio - Write TypeScript, Get Native Binaries
// Try it: Click "Compile" to generate a native binary

const args = process.argv.slice(2);
const name = args[0] || 'World';

console.log(\`Hello, \${name}!\`);

// Add more code to see the power of scriptc
function add(a: number, b: number): number {
  return a + b;
}

const result = add(3, 5);
console.log(\`3 + 5 = \${result}\`);

// Export for use in other modules
module.exports = { add };`);
  
  const [filename, setFilename] = useState<string>('app.ts');
  const [target, setTarget] = useState<'exe' | 'c' | 'llvm' | 'wasm'>('exe');
  const [platform, setPlatform] = useState<'linux' | 'macos' | 'windows'>('linux');
  const [isCompiling, setIsCompiling] = useState<boolean>(false);
  const [compileResult, setCompileResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string>('');
  const [showOutput, setShowOutput] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'editor' | 'output' | 'console'>('editor');
  const [consoleMessages, setConsoleMessages] = useState<string[]>([]);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [projectName, setProjectName] = useState<string>('my-cli');
  const [showShareModal, setShowShareModal] = useState<boolean>(false);
  const [shareUrl, setShareUrl] = useState<string>('');
  const [showTemplates, setShowTemplates] = useState<boolean>(false);
  const [showGitHubModal, setShowGitHubModal] = useState<boolean>(false);
  const [githubUser, setGithubUser] = useState<any>(null);
  const [showCollaboration, setShowCollaboration] = useState<boolean>(false);
  const [collaborators, setCollaborators] = useState<any[]>([]);
  
  const clientId = useRef<string>(crypto.randomUUID()).current;
  const projectId = useRef<string>(crypto.randomUUID()).current;
  const wsManager = useRef<WebSocketManager | null>(null);
  
  // Load Monaco Editor dynamically to reduce bundle size
  const Editor = dynamic(
    () => import('@monaco-editor/react').then((mod) => mod.default),
    { ssr: false, loading: () => <div className="loading">Loading editor...</div> }
  );
  
  // Initialize WebSocket connection for collaboration
  useEffect(() => {
    if (showCollaboration) {
      wsManager.current = new WebSocketManager(projectId, clientId, 'User');
      wsManager.current.connect();
      
      wsManager.current.on('collaborator_joined', (message) => {
        setCollaborators(prev => [...prev, {
          id: message.clientId,
          name: message.content || 'Anonymous',
          color: '#' + Math.floor(Math.random() * 16777215).toString(16),
        }]);
      });
      
      wsManager.current.on('collaborator_left', (message) => {
        setCollaborators(prev => prev.filter(c => c.id !== message.clientId));
      });
      
      wsManager.current.on('content_update', (message) => {
        if (message.content !== undefined) {
          setCode(message.content);
        }
      });
      
      return () => {
        wsManager.current?.disconnect();
      };
    }
  }, [showCollaboration]);
  
  // Check GitHub authentication status
  useEffect(() => {
    fetch('/api/github/user')
      .then(res => res.json())
      .then(data => {
        if (data.authenticated) {
          setGithubUser(data.user);
        }
      })
      .catch(console.error);
  }, []);
  
  // Handle compilation
  const handleCompile = useCallback(async () => {
    setIsCompiling(true);
    setError(null);
    setOutput('');
    setCompileResult(null);
    addConsoleMessage('Starting compilation...');
    
    try {
      const result = await compileTypeScriptBrowser({
        code,
        filename,
        target,
        platform,
        optimization: 'O2',
      });
      
      setCompileResult(result);
      
      if (result.success) {
        addConsoleMessage(`Compilation successful! Target: ${target}`);
        if (result.downloadUrl) {
          addConsoleMessage(`Download: ${result.downloadUrl}`);
        }
        setOutput(result.output || '');
      } else {
        setError(result.error || 'Compilation failed');
        addConsoleMessage(`Compilation failed: ${result.error}`);
        if (result.stderr) {
          addConsoleMessage(result.stderr);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Compilation error');
      addConsoleMessage(`Error: ${err.message}`);
    } finally {
      setIsCompiling(false);
    }
  }, [code, filename, target, platform]);
  
  // Add message to console
  const addConsoleMessage = useCallback((message: string) => {
    setConsoleMessages(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  }, []);
  
  // Download compiled file
  const handleDownload = useCallback(async () => {
    if (!compileResult?.filename) return;
    
    try {
      const response = await fetch(`/api/download/${compileResult.filename}`);
      if (!response.ok) {
        throw new Error('File not found');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = compileResult.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      addConsoleMessage(`Downloaded: ${compileResult.filename}`);
    } catch (err: any) {
      setError(err.message);
      addConsoleMessage(`Download error: ${err.message}`);
    }
  }, [compileResult, addConsoleMessage]);
  
  // Login with GitHub
  const handleGitHubLogin = useCallback(() => {
    window.location.href = '/api/github/auth';
  }, []);
  
  // Logout from GitHub
  const handleGitHubLogout = useCallback(async () => {
    await fetch('/api/github/user', { method: 'DELETE' });
    setGithubUser(null);
    addConsoleMessage('Logged out from GitHub');
  }, [addConsoleMessage]);
  
  // Load template
  const loadTemplate = useCallback((template: { name: string; code: string }) => {
    setCode(template.code);
    setFilename(`${template.name.toLowerCase().replace(/\s+/g, '-')}.ts`);
    setShowTemplates(false);
    addConsoleMessage(`Loaded template: ${template.name}`);
  }, [addConsoleMessage]);
  
  // Generate share URL
  const generateShareUrl = useCallback(() => {
    const shareData = {
      code,
      filename,
      target,
      platform,
      projectName,
    };
    const encoded = btoa(encodeURIComponent(JSON.stringify(shareData)));
    const url = `${window.location.origin}/?share=${encoded}`;
    setShareUrl(url);
    setShowShareModal(true);
  }, [code, filename, target, platform, projectName]);
  
  // Load from share URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shareData = params.get('share');
    if (shareData) {
      try {
        const decoded = JSON.parse(decodeURIComponent(atob(shareData)));
        setCode(decoded.code || code);
        setFilename(decoded.filename || filename);
        setTarget(decoded.target || target);
        setPlatform(decoded.platform || platform);
        setProjectName(decoded.projectName || projectName);
        addConsoleMessage('Loaded shared project');
      } catch (err) {
        console.error('Error loading share:', err);
      }
    }
  }, [code, filename, target, platform, projectName, addConsoleMessage]);
  
  // Toggle dark mode
  const toggleDarkMode = useCallback(() => {
    setIsDarkMode(!isDarkMode);
    document.documentElement.classList.toggle('dark');
  }, [isDarkMode]);
  
  // Templates
  const templates = [
    {
      name: 'Hello World',
      code: `const args = process.argv.slice(2);
const name = args[0] || 'World';
console.log(\`Hello, \${name}!\`);`,
    },
    {
      name: 'HTTP Server',
      code: `import { createServer } from 'http';

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Hello from NanoCLI Server!');
});

const port = parseInt(process.argv[2] || '3000');
server.listen(port, () => {
  console.log(\`Server running on port \${port}\`);
});`,
    },
    {
      name: 'File Processor',
      code: `import { readFileSync, writeFileSync } from 'fs';

const inputFile = process.argv[2];
const outputFile = process.argv[3];

if (!inputFile || !outputFile) {
  console.error('Usage: node app.js <input> <output>');
  process.exit(1);
}

try {
  const content = readFileSync(inputFile, 'utf8');
  const processed = content.toUpperCase();
  writeFileSync(outputFile, processed);
  console.log(\`Processed \${inputFile} -> \${outputFile}\`);
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}`,
    },
    {
      name: 'Math Utilities',
      code: `function add(a: number, b: number): number {
  return a + b;
}

function subtract(a: number, b: number): number {
  return a - b;
}

function multiply(a: number, b: number): number {
  return a * b;
}

function divide(a: number, b: number): number {
  if (b === 0) throw new Error('Division by zero');
  return a / b;
}

const args = process.argv.slice(2).map(Number);
if (args.length < 2) {
  console.log('Usage: math <num1> <num2> [operation: add|subtract|multiply|divide]');
  process.exit(1);
}

const operation = (process.argv[4] as string) || 'add';
const result = {
  add: () => add(args[0], args[1]),
  subtract: () => subtract(args[0], args[1]),
  multiply: () => multiply(args[0], args[1]),
  divide: () => divide(args[0], args[1]),
}[operation]();

console.log(\`\${args[0]} \${operation} \${args[1]} = \${result}\`);`,
    },
    {
      name: 'API Client',
      code: `async function fetchData(url: string): Promise<any> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(\`HTTP \${response.status}\`);
  }
  return response.json();
}

const apiUrl = process.argv[2];
if (!apiUrl) {
  console.error('Usage: api-client <url>');
  process.exit(1);
}

fetchData(apiUrl)
  .then(data => {
    console.log('Response:', JSON.stringify(data, null, 2));
  })
  .catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });`,
    },
    {
      name: 'CLI Calculator',
      code: `function calculate(expression: string): number {
  // Simple calculator that evaluates basic arithmetic
  // Note: In production, use a proper parser for security
  return Function('"use strict"; return (' + expression + ')')();
}

const expression = process.argv.slice(2).join(' ');
if (!expression) {
  console.error('Usage: calc "1 + 2 * 3"');
  process.exit(1);
}

try {
  const result = calculate(expression);
  console.log(\`\${expression} = \${result}\`);
} catch (err: any) {
  console.error('Error:', err.message);
  process.exit(1);
}`,
    },
    {
      name: 'JSON Processor',
      code: `import { readFileSync, writeFileSync } from 'fs';

const inputFile = process.argv[2];
const outputFile = process.argv[3];

if (!inputFile || !outputFile) {
  console.error('Usage: json-processor <input.json> <output.json>');
  process.exit(1);
}

try {
  const data = JSON.parse(readFileSync(inputFile, 'utf8'));
  const pretty = JSON.stringify(data, null, 2);
  writeFileSync(outputFile, pretty);
  console.log(\`Formatted JSON saved to \${outputFile}\`);
} catch (err: any) {
  console.error('Error:', err.message);
  process.exit(1);
}`,
    },
    {
      name: 'Timer Utility',
      code: `function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  return \`\${days}d \${hours % 24}h \${minutes % 60}m \${seconds % 60}s\`;
}

const args = process.argv.slice(2);
const duration = args.length > 0 ? parseInt(args[0]) * 1000 : 1000;

console.log(\`Starting timer for \${duration / 1000} seconds...\`);

setTimeout(() => {
  console.log(\`Timer complete! Elapsed: \${formatTime(duration)}\`);
  process.exit(0);
}, duration);`,
    },
  ];
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 text-white font-sans">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-lg border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
              NanoCLI Studio
            </h1>
            <span className="text-sm text-gray-400 hidden md:block">
              Zero-Runtime TypeScript Compiler
            </span>
          </div>
          
          <div className="flex items-center gap-4">
            <button
              onClick={toggleDarkMode}
              className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors"
            >
              {isDarkMode ? '☀️' : '🌙'}
            </button>
            
            {githubUser ? (
              <div className="flex items-center gap-2">
                <img 
                  src={githubUser.avatar_url} 
                  alt={githubUser.login} 
                  className="w-8 h-8 rounded-full border-2 border-purple-500"
                />
                <button
                  onClick={handleGitHubLogout}
                  className="px-3 py-1 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors"
                >
                  Logout
                </button>
              </div>
            ) : (
              <button
                onClick={handleGitHubLogin}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-medium transition-colors"
              >
                Login with GitHub
              </button>
            )}
            
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors"
            >
              ⚙️
            </button>
          </div>
        </div>
      </header>
      
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Main Content Grid */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Left Sidebar - Project Info */}
          <div className="space-y-4">
            <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
              <h3 className="text-sm font-semibold text-gray-400 mb-3">Project</h3>
              <input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Project name"
                className="w-full p-2 bg-gray-700 rounded-lg border border-gray-600 focus:border-purple-500 focus:outline-none text-white"
              />
              <input
                value={filename}
                onChange={(e) => setFilename(e.target.value.replace(/[^a-zA-Z0-9._-]/g, ''))}
                placeholder="Filename"
                className="w-full p-2 mt-2 bg-gray-700 rounded-lg border border-gray-600 focus:border-purple-500 focus:outline-none text-white"
              />
            </div>
            
            <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
              <h3 className="text-sm font-semibold text-gray-400 mb-3">Templates</h3>
              <button
                onClick={() => setShowTemplates(!showTemplates)}
                className="w-full flex items-center justify-between p-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
              >
                <span>Load Template</span>
                <span>▼</span>
              </button>
              
              {showTemplates && (
                <div className="mt-2 space-y-2 max-h-64 overflow-y-auto">
                  {templates.map((template) => (
                    <button
                      key={template.name}
                      onClick={() => loadTemplate(template)}
                      className="w-full text-left p-2 bg-gray-700 hover:bg-purple-600/20 rounded-lg text-sm transition-colors"
                    >
                      {template.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            
            <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
              <h3 className="text-sm font-semibold text-gray-400 mb-3">Actions</h3>
              <div className="space-y-2">
                <button
                  onClick={handleCompile}
                  disabled={isCompiling}
                  className="w-full flex items-center justify-center gap-2 p-3 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 rounded-lg font-medium transition-colors"
                >
                  <span>{isCompiling ? '⏳ Compiling...' : '▶ Compile'}</span>
                </button>
                
                <button
                  onClick={handleDownload}
                  disabled={!compileResult?.filename}
                  className="w-full flex items-center justify-center gap-2 p-3 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 rounded-lg font-medium transition-colors"
                >
                  <span>⬇ Download</span>
                </button>
                
                <button
                  onClick={generateShareUrl}
                  className="w-full flex items-center justify-center gap-2 p-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors"
                >
                  <span>🔗 Share</span>
                </button>
                
                <button
                  onClick={() => setShowCollaboration(!showCollaboration)}
                  className={`w-full flex items-center justify-center gap-2 p-3 rounded-lg font-medium transition-colors ${
                    showCollaboration 
                      ? 'bg-green-600 hover:bg-green-700'
                      : 'bg-gray-700 hover:bg-gray-600'
                  }`}
                >
                  <span>{showCollaboration ? '👥 Collaboration On' : '👥 Collaboration'}</span>
                </button>
              </div>
            </div>
            
            {showCollaboration && collaborators.length > 0 && (
              <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                <h3 className="text-sm font-semibold text-gray-400 mb-3">Collaborators</h3>
                <div className="space-y-2">
                  {collaborators.map((collab) => (
                    <div key={collab.id} className="flex items-center gap-2 p-2 bg-gray-700 rounded-lg">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: collab.color }}
                      />
                      <span className="text-sm">{collab.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Compilation Settings */}
            <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
              <h3 className="text-sm font-semibold text-gray-400 mb-3">Target</h3>
              <div className="space-y-2">
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value as any)}
                  className="w-full p-2 bg-gray-700 rounded-lg border border-gray-600 focus:border-purple-500 focus:outline-none text-white"
                >
                  <option value="exe">Native Binary</option>
                  <option value="c">C Code</option>
                  <option value="llvm">LLVM IR</option>
                  <option value="wasm">WASM</option>
                </select>
                
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value as any)}
                  className="w-full p-2 bg-gray-700 rounded-lg border border-gray-600 focus:border-purple-500 focus:outline-none text-white"
                >
                  <option value="linux">Linux</option>
                  <option value="macos">macOS</option>
                  <option value="windows">Windows</option>
                </select>
              </div>
            </div>
          </div>
          
          {/* Center - Editor */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-gray-800/50 rounded-xl border border-gray-700 overflow-hidden">
              <div className="flex border-b border-gray-700">
                <button
                  onClick={() => setActiveTab('editor')}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    activeTab === 'editor' 
                      ? 'bg-gray-700 text-white' 
                      : 'text-gray-400 hover:bg-gray-700/50'
                  }`}
                >
                  Editor
                </button>
                <button
                  onClick={() => setActiveTab('output')}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    activeTab === 'output' 
                      ? 'bg-gray-700 text-white' 
                      : 'text-gray-400 hover:bg-gray-700/50'
                  }`}
                >
                  Output
                </button>
                <button
                  onClick={() => setActiveTab('console')}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    activeTab === 'console' 
                      ? 'bg-gray-700 text-white' 
                      : 'text-gray-400 hover:bg-gray-700/50'
                  }`}
                >
                  Console
                </button>
              </div>
              
              <div className="h-[600px] overflow-hidden">
                {activeTab === 'editor' && (
                  <Editor
                    height="100%"
                    defaultLanguage="typescript"
                    value={code}
                    onChange={(value = '') => {
                      setCode(value);
                      if (showCollaboration && wsManager.current?.isConnected()) {
                        wsManager.current.send({
                          type: 'edit',
                          content: value,
                          projectId,
                          clientId,
                        });
                      }
                    }}
                    theme={isDarkMode ? 'vs-dark' : 'vs-light'}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 14,
                      wordWrap: 'on',
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                    }}
                  />
                )}
                
                {activeTab === 'output' && (
                  <div className="h-full p-4 overflow-y-auto bg-gray-900">
                    {output ? (
                      <pre className="text-sm text-gray-300 whitespace-pre-wrap">
                        {output.length > 10000 ? `${output.substring(0, 10000)}...\n\n[Output truncated - download full file]` : output}
                      </pre>
                    ) : (
                      <div className="flex items-center justify-center h-full text-gray-500">
                        <p>Compile your code to see output here</p>
                      </div>
                    )}
                  </div>
                )}
                
                {activeTab === 'console' && (
                  <div className="h-full p-4 overflow-y-auto bg-gray-900">
                    {consoleMessages.length > 0 ? (
                      consoleMessages.map((msg, index) => (
                        <div key={index} className="text-sm text-gray-300 mb-1">
                          {msg}
                        </div>
                      ))
                    ) : (
                      <div className="flex items-center justify-center h-full text-gray-500">
                        <p>Console messages will appear here</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            
            {/* Error Display */}
            {error && (
              <div className="bg-red-500/10 border border-red-500 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-red-500">❌</span>
                  <span className="font-semibold text-red-400">Compilation Error</span>
                </div>
                <pre className="text-sm text-red-300 whitespace-pre-wrap">{error}</pre>
              </div>
            )}
            
            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700 text-center">
                <div className="text-2xl font-bold text-purple-400">{code.split('\n').length}</div>
                <div className="text-sm text-gray-400">Lines</div>
              </div>
              <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700 text-center">
                <div className="text-2xl font-bold text-blue-400">{code.length}</div>
                <div className="text-sm text-gray-400">Chars</div>
              </div>
              <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700 text-center">
                <div className="text-2xl font-bold text-green-400">
                  {compileResult?.success ? '✓' : '✗'}
                </div>
                <div className="text-sm text-gray-400">Status</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Share Modal */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4 border border-gray-700">
            <h3 className="text-lg font-semibold mb-4">Share Project</h3>
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">Share URL</label>
              <div className="flex gap-2">
                <input
                  value={shareUrl}
                  readOnly
                  className="flex-1 p-2 bg-gray-700 rounded-lg border border-gray-600 text-white text-sm"
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(shareUrl);
                    addConsoleMessage('Share URL copied to clipboard');
                  }}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-medium transition-colors"
                >
                  Copy
                </button>
              </div>
            </div>
            <button
              onClick={() => setShowShareModal(false)}
              className="w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
      
      {/* GitHub Modal */}
      {showGitHubModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4 border border-gray-700">
            <h3 className="text-lg font-semibold mb-4">GitHub Integration</h3>
            <p className="text-gray-400 mb-4">
              Connect your GitHub account to save and load projects from repositories.
            </p>
            <button
              onClick={handleGitHubLogin}
              className="w-full px-4 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg font-medium transition-colors"
            >
              Connect with GitHub
            </button>
            <button
              onClick={() => setShowGitHubModal(false)}
              className="w-full mt-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
      
      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-4 py-8 text-center text-sm text-gray-500">
        <p>
          Built with ❤️ using <a href="https://scriptc.dev" className="text-purple-400 hover:underline">scriptc</a> • 
          <a href="https://github.com/BrandDeb/Aha" className="text-purple-400 hover:underline">GitHub</a>
        </p>
        <p className="mt-2">
          NanoCLI Studio - Zero-Runtime TypeScript Compiler
        </p>
      </footer>
    </div>
  );
}
