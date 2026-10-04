'use client';

/**
 * NanoCLI Studio - Unified Page
 * 
 * Complete IDE with all features:
 * - Monaco Editor for TypeScript
 * - Real-time Collaboration via WebSocket
 * - GitHub Integration
 * - AI Gateway
 * - Auth Middleware
 * - URL Shortener
 * - Markdown Editor
 * - Analytics Dashboard
 * - Live Terminal Emulator
 * - Multi-File Project Explorer
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { CodeEditor } from '@/components/CodeEditor';
import { SiteFooter, SiteHeader } from '@/components/SiteHeader';
import { compileTypeScriptBrowser, type CompileResult } from '@/lib/compiler-browser';
import { WebSocketManager } from '@/lib/websocket';
import { generateSecureId, formatMs, debounce, formatBytes } from '@/lib/utils';
import type { AIRequest, AIResponse, CompilePlatform, CompileTarget } from '@/types';


// Feature types
type ActiveFeature = 'editor' | 'ai' | 'auth' | 'shorten' | 'markdown' | 'analytics' | 'terminal' | 'projects';

interface ProjectFile {
  id: string;
  name: string;
  path: string;
  content: string;
  language: string;
  createdAt: Date;
  updatedAt: Date;
  isDirty: boolean;
}

interface Project {
  id: string;
  name: string;
  files: ProjectFile[];
  createdAt: Date;
}

interface MockAIProvider {
  name: string;
  latency: number;
  cost: number;
  status: 'online' | 'offline' | 'degraded';
}

interface MockUrl {
  id: string;
  original: string;
  short: string;
  clicks: number;
  createdAt: Date;
}

interface MockNote {
  id: string;
  title: string;
  content: string;
  updatedAt: Date;
  tags: string[];
}

interface AnalyticsData {
  totalRequests: number;
  avgLatency: number;
  requestsByType: Record<string, number>;
  requestsByProvider: Record<string, number>;
}

interface TerminalCommand {
  input: string;
  output: string;
  timestamp: Date;
  workingDirectory: string;
}

export default function UnifiedStudioPage() {
  const clientId = useRef<string>(crypto.randomUUID()).current;
  const projectId = useRef<string>(crypto.randomUUID()).current;
  const wsManager = useRef<WebSocketManager | null>(null);
  
  // Global state
  const [isLoading, setIsLoading] = useState(false);
  const [activeFeature, setActiveFeature] = useState<ActiveFeature>('editor');
  const [consoleMessages, setConsoleMessages] = useState<string[]>([]);
  
  // Editor state
  const [code, setCode] = useState<string>(`// NanoCLI Studio - Write TypeScript, Get Native Binaries
const args = process.argv.slice(2);
const name = args[0] || 'World';

console.log(\`Hello, \${name}!\`);

function add(a: number, b: number): number {
  return a + b;
}

const result = add(3, 5);
console.log(\`3 + 5 = \${result}\`);`);
  const [filename, setFilename] = useState('app.ts');
  const [target, setTarget] = useState<CompileTarget>('exe');
  const [platform, setPlatform] = useState<CompilePlatform>('linux');
  const [compileResult, setCompileResult] = useState<CompileResult | null>(null);
  
  // Project Explorer state
  const [projects, setProjects] = useState<Project[]>([
    {
      id: projectId,
      name: 'My Project',
      files: [
        {
          id: generateSecureId(),
          name: 'main.ts',
          path: '/main.ts',
          content: code,
          language: 'typescript',
          createdAt: new Date(),
          updatedAt: new Date(),
          isDirty: false,
        },
      ],
      createdAt: new Date(),
    },
  ]);
  const [activeProjectId, setActiveProjectId] = useState<string>(projectId);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileLanguage, setNewFileLanguage] = useState('typescript');
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  
  // Terminal state
  const [terminalInput, setTerminalInput] = useState('');
  const [terminalHistory, setTerminalHistory] = useState<TerminalCommand[]>([]);
  const [terminalOutput, setTerminalOutput] = useState('');
  const terminalRef = useRef<HTMLDivElement>(null);
  
  // AI Gateway state
  const [aiRequest, setAiRequest] = useState<AIRequest>({
    prompt: '',
    provider: 'openrouter',
    stream: false,
    maxTokens: 100,
    temperature: 0.7
  });
  const [aiResponse, setAiResponse] = useState<AIResponse | null>(null);
  const [providers, setProviders] = useState<MockAIProvider[]>([
    { name: 'openrouter', latency: 2, cost: 0.000002, status: 'online' },
    { name: 'groq', latency: 1, cost: 0.000001, status: 'online' },
    { name: 'firebase', latency: 3, cost: 0.000003, status: 'online' },
    { name: 'anthropic', latency: 5, cost: 0.000005, status: 'online' },
    { name: 'mistral', latency: 4, cost: 0.000002, status: 'online' }
  ]);
  
  // Auth state
  const [authToken, setAuthToken] = useState('');
  const [authResult, setAuthResult] = useState<{ valid: boolean; latency: string } | null>(null);
  
  // URL Shortener state
  const [urlToShorten, setUrlToShorten] = useState('');
  const [customId, setCustomId] = useState('');
  const [shortenedUrl, setShortenedUrl] = useState<MockUrl | null>(null);
  const [urls, setUrls] = useState<MockUrl[]>([]);
  
  // Markdown Editor state
  const [notes, setNotes] = useState<MockNote[]>([
    { id: '1', title: 'Welcome', content: '# Welcome to Nano CLI Studio\n\nThis is your unified workspace.\n\n## Features\n\n- **Monaco Editor**: Full TypeScript editing\n- **Real-time Collaboration**: Work together with others\n- **AI Gateway**: Route LLM requests\n- **Auth Middleware**: Validate tokens\n- **URL Shortener**: Create short links\n- **Terminal**: Run commands\n- **Projects**: Manage multiple files\n', updatedAt: new Date(), tags: ['welcome', 'studio'] }
  ]);
  const [activeNoteId, setActiveNoteId] = useState('1');
  const [noteContent, setNoteContent] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  
  // Analytics state
  const [analytics, setAnalytics] = useState<AnalyticsData>({
    totalRequests: 1542,
    avgLatency: 2.3,
    requestsByType: { editor: 892, ai: 340, auth: 210, shorten: 98, markdown: 2 },
    requestsByProvider: { openrouter: 450, groq: 320, firebase: 122 }
  });
  
  // Stats
  const [stats, setStats] = useState({
    coldStart: '~2ms',
    memoryUsage: '~1.2MB',
    requestsPerSecond: 45,
    wasmSize: '178KB'
  });
  
  // Initialize
  useEffect(() => {
    if (projects.length > 0 && !activeFileId) {
      setActiveFileId(projects[0]?.files[0]?.id || null);
    }
  }, [projects, activeFileId]);
  
  // Initialize note content
  useEffect(() => {
    const note = notes.find(n => n.id === activeNoteId);
    if (note) {
      setNoteTitle(note.title);
      setNoteContent(note.content);
    }
  }, [activeNoteId, notes]);
  
  // Auto-save note
  const saveNote = useCallback(
    debounce((id: string, title: string, content: string) => {
      setNotes(prev => prev.map(n => 
        n.id === id ? { ...n, title, content, updatedAt: new Date() } : n
      ));
    }, 500),
    []
  );
  
  useEffect(() => {
    if (activeNoteId) {
      saveNote(activeNoteId, noteTitle, noteContent);
    }
  }, [noteTitle, noteContent, activeNoteId, saveNote]);
  
  // Scroll terminal to bottom
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminalHistory, terminalOutput]);
  
  // Add console message
  const addConsoleMessage = useCallback((message: string) => {
    setConsoleMessages(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  }, []);
  
  // Get active file
  const getActiveFile = (): ProjectFile | null => {
    if (!activeProjectId || !activeFileId) return null;
    const project = projects.find(p => p.id === activeProjectId);
    if (!project) return null;
    return project.files.find(f => f.id === activeFileId) || null;
  };
  
  // Set active file content
  const setActiveFileContent = (content: string) => {
    if (!activeProjectId || !activeFileId) return;
    
    setProjects(prev => prev.map(project => {
      if (project.id !== activeProjectId) return project;
      return {
        ...project,
        files: project.files.map(file => {
          if (file.id !== activeFileId) return file;
          return { ...file, content, updatedAt: new Date(), isDirty: true };
        }),
      };
    }));
    
    // Broadcast to collaborators
    if (wsManager.current?.isConnected()) {
      wsManager.current.send({
        type: 'edit',
        content,
        projectId,
        clientId,
        fileId: activeFileId,
      });
    }
  };
  
  // Handle compilation
  const handleCompile = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    addConsoleMessage('Starting compilation...');
    
    try {
      const activeFile = getActiveFile();
      const result = await compileTypeScriptBrowser({
        code: activeFile?.content || code,
        filename: activeFile?.name || filename,
        target,
        platform,
      });
      
      setCompileResult(result);
      
      if (result.success) {
        addConsoleMessage(`Compilation successful! Target: ${target}`);
        if (result.downloadUrl) {
          addConsoleMessage(`Download: ${result.downloadUrl}`);
        }
      } else {
        addConsoleMessage(`Compilation failed: ${result.error}`);
      }
    } catch (err) {
      addConsoleMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoading(false);
    }
  }, [code, filename, target, platform, activeProjectId, activeFileId, addConsoleMessage]);
  
  // Create new file
  const createNewFile = () => {
    if (!activeProjectId || !newFileName.trim()) return;
    
    const newFile: ProjectFile = {
      id: generateSecureId(),
      name: newFileName,
      path: `/${newFileName}`,
      content: '',
      language: newFileLanguage,
      createdAt: new Date(),
      updatedAt: new Date(),
      isDirty: false,
    };
    
    setProjects(prev => prev.map(project => {
      if (project.id !== activeProjectId) return project;
      return {
        ...project,
        files: [...project.files, newFile],
      };
    }));
    
    setActiveFileId(newFile.id);
    setNewFileName('');
    setNewFileLanguage('typescript');
    setShowNewFileModal(false);
    addConsoleMessage(`Created new file: ${newFileName}`);
  };
  
  // Create new project
  const createNewProject = () => {
    if (!newProjectName.trim()) return;
    
    const newProject: Project = {
      id: generateSecureId(),
      name: newProjectName,
      files: [
        {
          id: generateSecureId(),
          name: 'main.ts',
          path: '/main.ts',
          content: '// New project\nexport function main() {\n  console.log("Hello, World!");\n}\n',
          language: 'typescript',
          createdAt: new Date(),
          updatedAt: new Date(),
          isDirty: false,
        },
      ],
      createdAt: new Date(),
    };
    
    setProjects(prev => [...prev, newProject]);
    setActiveProjectId(newProject.id);
    setActiveFileId(newProject.files[0].id);
    setNewProjectName('');
    setShowNewProjectModal(false);
    addConsoleMessage(`Created new project: ${newProjectName}`);
  };
  
  // Delete file
  const deleteFile = (fileId: string) => {
    if (!activeProjectId) return;
    
    setProjects(prev => prev.map(project => {
      if (project.id !== activeProjectId) return project;
      if (project.files.length <= 1) return project; // Don't delete last file
      
      const newFiles = project.files.filter(f => f.id !== fileId);
      const newActiveFileId = newFiles[0]?.id || null;
      
      if (activeFileId === fileId) {
        setActiveFileId(newActiveFileId);
      }
      
      return { ...project, files: newFiles };
    }));
    
    addConsoleMessage('File deleted');
  };
  
  // Delete project
  const deleteProject = (projectId: string) => {
    if (projects.length <= 1) return; // Don't delete last project
    
    setProjects(prev => prev.filter(p => p.id !== projectId));
    
    if (activeProjectId === projectId) {
      setActiveFileId(projects[0]?.files[0]?.id ?? null);
      setActiveFileId(projects[0]?.files[0]?.id || null);
    }
    
    addConsoleMessage('Project deleted');
  };
  
  // Handle terminal command
  const handleTerminalCommand = () => {
    if (!terminalInput.trim()) return;
    
    const command = terminalInput;
    setTerminalInput('');
    
    // Simulate command execution
    let output = '';
    
    if (command.toLowerCase() === 'help') {
      output = 'Available commands:\n' +
        '  help    - Show this help message\n' +
        '  clear   - Clear the terminal\n' +
        '  ls      - List files\n' +
        '  pwd     - Show current directory\n' +
        '  echo    - Echo text\n' +
        '  compile - Compile current file\n' +
        '  date    - Show current date\n' +
        '  time    - Show current time\n';
    } else if (command.toLowerCase() === 'clear') {
      setTerminalHistory([]);
      setTerminalOutput('');
      return;
    } else if (command.toLowerCase() === 'ls') {
      const activeProject = projects.find(p => p.id === activeProjectId);
      if (activeProject) {
        output = activeProject.files.map(f => f.name).join('\n');
      } else {
        output = 'No project selected';
      }
    } else if (command.toLowerCase() === 'pwd') {
      output = '/projects' + (activeProjectId ? `/${projects.find(p => p.id === activeProjectId)?.name}` : '');
    } else if (command.toLowerCase().startsWith('echo ')) {
      output = command.substring(5);
    } else if (command.toLowerCase() === 'compile') {
      handleCompile();
      output = 'Compiling... (check console for results)';
    } else if (command.toLowerCase() === 'date') {
      output = new Date().toLocaleDateString();
    } else if (command.toLowerCase() === 'time') {
      output = new Date().toLocaleTimeString();
    } else {
      output = `Command not found: ${command}\nType 'help' for available commands.`;
    }
    
    setTerminalHistory(prev => [...prev, {
      input: command,
      output,
      timestamp: new Date(),
      workingDirectory: output.includes('/projects') ? output.split('\n')[0] : '/',
    }]);
    
    setTerminalOutput(output);
  };
  
  // AI Gateway handlers
  const handleAiRequest = async () => {
    if (!aiRequest.prompt.trim()) return;
    setIsLoading(true);
    await new Promise(resolve => setTimeout(resolve, 800));
    
    const response: AIResponse = {
      provider: aiRequest.provider || 'openrouter',
      prompt: aiRequest.prompt,
      completion: `This is a simulated response from ${aiRequest.provider || 'openrouter'}. Your prompt was: "${aiRequest.prompt}".\n\nWith scriptc, this would have ~2ms cold start latency instead of 35-100ms with Node.js.`,
      stream: aiRequest.stream || false,
      timestamp: Date.now(),
      latency: formatMs(Math.random() * 5 + 1),
      model: 'mistral-large',
      tokensUsed: Math.floor(aiRequest.prompt.length / 4)
    };
    
    setAiResponse(response);
    setIsLoading(false);
    setAnalytics(prev => ({
      ...prev,
      totalRequests: prev.totalRequests + 1,
      requestsByType: { ...prev.requestsByType, ai: prev.requestsByType.ai + 1 },
      requestsByProvider: { ...prev.requestsByProvider, [aiRequest.provider || 'openrouter']: (prev.requestsByProvider[aiRequest.provider || 'openrouter'] || 0) + 1 }
    }));
  };
  
  // Auth handler
  const handleAuthValidation = async () => {
    if (!authToken.trim()) return;
    setIsLoading(true);
    await new Promise(resolve => setTimeout(resolve, 50));
    const isValid = authToken.startsWith('valid_') || authToken === 'demo-token';
    setAuthResult({ valid: isValid, latency: formatMs(Math.random() * 2 + 0.5) });
    setIsLoading(false);
    setAnalytics(prev => ({
      ...prev,
      totalRequests: prev.totalRequests + 1,
      requestsByType: { ...prev.requestsByType, auth: prev.requestsByType.auth + 1 }
    }));
  };
  
  // URL Shortener handler
  const handleShortenUrl = async () => {
    if (!urlToShorten.trim()) return;
    setIsLoading(true);
    await new Promise(resolve => setTimeout(resolve, 30));
    const id = customId || generateSecureId(8);
    const shortUrl: MockUrl = {
      id,
      original: urlToShorten,
      short: `${window.location.origin}/s/${id}`,
      clicks: 0,
      createdAt: new Date()
    };
    setShortenedUrl(shortUrl);
    setUrls(prev => [shortUrl, ...prev.slice(0, 4)]);
    setUrlToShorten('');
    setCustomId('');
    setIsLoading(false);
    setAnalytics(prev => ({
      ...prev,
      totalRequests: prev.totalRequests + 1,
      requestsByType: { ...prev.requestsByType, shorten: prev.requestsByType.shorten + 1 }
    }));
  };
  
  // Toggle dark mode
  
  // Get provider status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'bg-green-500';
      case 'offline': return 'bg-red-500';
      case 'degraded': return 'bg-yellow-500';
      default: return 'bg-gray-500';
    }
  };
  
  // Render feature panels
  const renderFeaturePanel = () => {
    switch (activeFeature) {
      case 'editor':
        return renderEditor();
      case 'ai':
        return renderAIGateway();
      case 'auth':
        return renderAuthMiddleware();
      case 'shorten':
        return renderUrlShortener();
      case 'markdown':
        return renderMarkdownEditor();
      case 'analytics':
        return renderAnalyticsDashboard();
      case 'terminal':
        return renderTerminal();
      case 'projects':
        return renderProjectExplorer();
      default:
        return renderEditor();
    }
  };
  
  // Editor Panel
  const renderEditor = () => (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-100">Editor</h2>
        <p className="text-sm text-gray-500">TypeScript with IntelliSense; scriptc errors appear inline after a build.</p>
      </div>
      
      <div className="surface overflow-hidden h-[500px]">
        {activeFileId && (
          <CodeEditor
            value={getActiveFile()?.content || code}
            diagnostics={compileResult?.diagnostics}
            onChange={(value) => {
              setCode(value);
              setActiveFileContent(value);
            }}
          />
        )}
      </div>
      
      <div className="flex gap-4">
        <button
          onClick={handleCompile}
          disabled={isLoading}
          className="flex-1 bg-gray-100 text-black hover:bg-white p-3 rounded-lg font-medium transition-colors disabled:opacity-50"
        >
          {isLoading ? 'Compiling…' : 'Compile'}
        </button>
        
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value as CompileTarget)}
          className="p-3 bg-gray-800 border border-gray-700 rounded-lg text-white"
        >
          <option value="exe">Native</option>
          <option value="asm">Assembly</option>
          <option value="llvm">LLVM IR</option>
          <option value="wasm">WASM</option>
        </select>
        
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value as CompilePlatform)}
          className="p-3 bg-gray-800 border border-gray-700 rounded-lg text-white"
        >
          <option value="linux">Linux</option>
          <option value="macos">macOS</option>
          <option value="windows">Windows</option>
        </select>
      </div>
      
      {compileResult && (
        <div className={`p-4 rounded-lg ${
          compileResult.success ? 'bg-green-500/10 border border-green-500' : 'bg-red-500/10 border border-red-500'
        }`}>
          <p className="font-medium">
            {compileResult.success ? '✓ Compilation Successful' : '✗ Compilation Failed'}
          </p>
          {compileResult.downloadUrl && (
            <a
              href={compileResult.downloadUrl}
              download
              className="text-purple-400 hover:underline text-sm"
            >
              Download {compileResult.filename}
            </a>
          )}
        </div>
      )}
    </div>
  );
  
  // Project Explorer Panel
  const renderProjectExplorer = () => (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-100">Project Explorer</h2>
        <p className="text-sm text-gray-500">Manage multiple files and projects</p>
      </div>
      
      <div className="grid md:grid-cols-3 gap-4">
        <div className="surface p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Projects</h3>
            <button
              onClick={() => setShowNewProjectModal(true)}
              className="px-3 py-1 bg-gray-100 text-black hover:bg-white rounded text-sm transition-colors"
            >
              + New
            </button>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {projects.map(project => (
              <div
                key={project.id}
                onClick={() => {
                  setActiveProjectId(project.id);
                  if (project.files.length > 0) {
                    setActiveFileId(project.files[0].id);
                  }
                }}
                className={`p-2 rounded cursor-pointer transition-colors ${
                  activeProjectId === project.id 
                    ? 'bg-purple-600/20 border border-purple-500' 
                    : 'bg-gray-700/50 hover:bg-gray-600/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm">{project.name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteProject(project.id);
                    }}
                    className="text-red-500 hover:text-red-400 text-xs"
                  >
                    🗑️
                  </button>
                </div>
                <span className="text-xs text-gray-500">{project.files.length} files</span>
              </div>
            ))}
          </div>
        </div>
        
        <div className="surface p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Files</h3>
            <button
              onClick={() => setShowNewFileModal(true)}
              className="px-3 py-1 bg-gray-100 text-black hover:bg-white rounded text-sm transition-colors"
            >
              + New
            </button>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {projects.find(p => p.id === activeProjectId)?.files.map(file => (
              <div
                key={file.id}
                onClick={() => setActiveFileId(file.id)}
                className={`p-2 rounded cursor-pointer transition-colors ${
                  activeFileId === file.id 
                    ? 'bg-purple-600/20 border border-purple-500' 
                    : 'bg-gray-700/50 hover:bg-gray-600/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">{file.language}</span>
                    <span className="text-sm">{file.name}</span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteFile(file.id);
                    }}
                    className="text-red-500 hover:text-red-400 text-xs"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        
        <div className="surface p-4">
          <h3 className="font-semibold mb-2">File Info</h3>
          {activeFileId && (
            <div className="space-y-2 text-sm">
              <p><strong>Name:</strong> {getActiveFile()?.name}</p>
              <p><strong>Language:</strong> {getActiveFile()?.language}</p>
              <p><strong>Lines:</strong> {(getActiveFile()?.content || '').split('\n').length}</p>
              <p><strong>Size:</strong> {formatBytes((getActiveFile()?.content || '').length)}</p>
              <p><strong>Last Updated:</strong> {getActiveFile()?.updatedAt.toLocaleTimeString()}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
  
  // Terminal Panel
  const renderTerminal = () => (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-100">Live Terminal</h2>
        <p className="text-sm text-gray-500">Run commands and test your binaries</p>
      </div>
      
      <div 
        ref={terminalRef}
        className="bg-gray-900 rounded-xl p-4 border border-gray-700 h-[400px] overflow-y-auto font-mono text-sm"
      >
        {terminalHistory.map((cmd, index) => (
          <div key={index} className="mb-2">
            <div className="text-green-400">
              <span className="text-gray-500">{cmd.workingDirectory}</span> $
              <span>{cmd.input}</span>
            </div>
            <div className="text-gray-300 whitespace-pre-wrap">{cmd.output}</div>
          </div>
        ))}
        {terminalOutput && (
          <div className="text-gray-300 whitespace-pre-wrap">{terminalOutput}</div>
        )}
        <div className="flex items-center gap-2 mt-2">
          <span className="text-green-400">$
            <span className="text-gray-500">
              {activeProjectId ? `/projects/${projects.find(p => p.id === activeProjectId)?.name}` : '/'}
            </span>
          </span>
          <input
            value={terminalInput}
            onChange={(e) => setTerminalInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleTerminalCommand()}
            placeholder="Type a command..."
            className="flex-1 bg-transparent border-none outline-none text-white"
            autoFocus
          />
        </div>
      </div>
      
      <div className="surface p-4">
        <h3 className="font-semibold mb-2">Available Commands</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          {['help', 'clear', 'ls', 'pwd', 'echo', 'compile', 'date', 'time'].map(cmd => (
            <button
              key={cmd}
              onClick={() => {
                setTerminalInput(cmd);
                handleTerminalCommand();
              }}
              className="p-2 bg-gray-700 hover:bg-gray-600 rounded transition-colors text-left"
            >
              {cmd}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
  
  // AI Gateway Panel
  const renderAIGateway = () => (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-gray-100">Zero-Latency AI Gateway</h2>
          <span className="badge">Demo · simulated data</span>
        </div>
        <p className="mt-1 text-sm text-gray-500">Route LLM requests to the fastest/cheapest provider</p>
      </div>
      
      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <select
            value={aiRequest.provider}
            onChange={(e) => setAiRequest({ ...aiRequest, provider: e.target.value as AIRequest['provider'] })}
            className="w-full p-3 rounded-lg border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
          >
            {providers.map(provider => (
              <option key={provider.name} value={provider.name}>
                {provider.name} ({provider.latency}ms, ${provider.cost}/token)
              </option>
            ))}
          </select>
          
          <textarea
            value={aiRequest.prompt}
            onChange={(e) => setAiRequest({ ...aiRequest, prompt: e.target.value })}
            placeholder="Enter your prompt..."
            rows={6}
            className="w-full p-3 rounded-lg border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 resize-none"
          />
          
          <div className="grid grid-cols-2 gap-4">
            <input
              type="number"
              value={aiRequest.maxTokens}
              onChange={(e) => setAiRequest({ ...aiRequest, maxTokens: Number(e.target.value) })}
              placeholder="Max Tokens"
              className="w-full p-3 rounded-lg border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
            />
            <input
              type="number"
              step="0.1"
              min="0"
              max="1"
              value={aiRequest.temperature}
              onChange={(e) => setAiRequest({ ...aiRequest, temperature: Number(e.target.value) })}
              placeholder="Temperature"
              className="w-full p-3 rounded-lg border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
            />
          </div>
          
          <button
            onClick={handleAiRequest}
            disabled={isLoading || !aiRequest.prompt.trim()}
            className="btn btn-primary w-full h-11"
          >
            {isLoading ? 'Processing...' : 'Send Request'}
          </button>
        </div>
        
        <div className="space-y-4">
          <h3 className="text-xl font-semibold">Provider Status</h3>
          <div className="space-y-3">
            {providers.map(provider => (
              <div key={provider.name} className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${getStatusColor(provider.status)}`} />
                  <span className="font-medium">{provider.name}</span>
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {provider.latency}ms • ${provider.cost}/token
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {aiResponse && (
        <div className="bg-gray-50 dark:bg-gray-900 p-6 rounded-lg border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold mb-4">Response</h3>
          <div className="space-y-2">
            <p><strong>Provider:</strong> {aiResponse.provider}</p>
            <p><strong>Latency:</strong> {aiResponse.latency}</p>
            <p><strong>Tokens Used:</strong> {aiResponse.tokensUsed}</p>
          </div>
          <div className="mt-4 p-4 bg-white dark:bg-gray-800 rounded-lg">
            <pre className="whitespace-pre-wrap text-sm">{aiResponse.completion}</pre>
          </div>
        </div>
      )}
    </div>
  );
  
  // Auth Middleware Panel
  const renderAuthMiddleware = () => (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-gray-100">Instant Auth Middleware</h2>
          <span className="badge">Demo · simulated data</span>
        </div>
        <p className="mt-1 text-sm text-gray-500">Validate JWTs, API keys, and OAuth tokens at the edge</p>
      </div>
      
      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <textarea
            value={authToken}
            onChange={(e) => setAuthToken(e.target.value)}
            placeholder="Enter JWT, API key, or OAuth token..."
            rows={4}
            className="w-full p-3 rounded-lg border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 resize-none font-mono text-sm"
          />
          
          <button
            onClick={handleAuthValidation}
            disabled={isLoading || !authToken.trim()}
            className="btn btn-primary w-full h-11"
          >
            {isLoading ? 'Validating...' : 'Validate Token'}
          </button>
          
          <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
            <h4 className="font-semibold mb-2">Try These Tokens</h4>
            <div className="space-y-2 text-sm">
              {['valid_jwt_token', 'valid_api_key_123', 'demo-token', 'invalid_token'].map(token => (
                <button
                  key={token}
                  onClick={() => setAuthToken(token)}
                  className="block w-full text-left p-2 bg-white dark:bg-gray-800 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  {token}
                </button>
              ))}
            </div>
          </div>
        </div>
        
        <div className="space-y-4">
          <h3 className="text-xl font-semibold">Validation Result</h3>
          
          {authResult && (
            <div className={`p-6 rounded-lg ${authResult.valid ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'}`}>
              <h4 className="text-lg font-semibold mb-2">
                {authResult.valid ? '✓ Valid Token' : '✗ Invalid Token'}
              </h4>
              <p><strong>Latency:</strong> {authResult.latency}</p>
            </div>
          )}
          
          <div className="bg-cyan-50 dark:bg-cyan-900/20 p-4 rounded-lg border border-cyan-200 dark:border-cyan-800">
            <h4 className="font-semibold mb-2">scriptc Advantage</h4>
            <ul className="text-sm space-y-1">
              <li>• ~1ms auth checks (vs 20-50ms Node)</li>
              <li>• No node:crypto dependency</li>
              <li>• Tiny 178KB binary</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
  
  // URL Shortener Panel
  const renderUrlShortener = () => (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-gray-100">No-BS URL Shortener</h2>
          <span className="badge">Demo · simulated data</span>
        </div>
        <p className="mt-1 text-sm text-gray-500">Zero-database URL shortener with KV storage and ~1ms latency</p>
      </div>
      
      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <input
            type="url"
            value={urlToShorten}
            onChange={(e) => setUrlToShorten(e.target.value)}
            placeholder="https://example.com/very/long/url"
            className="w-full p-3 rounded-lg border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
          />
          
          <input
            value={customId}
            onChange={(e) => setCustomId(e.target.value)}
            placeholder="Custom ID (optional)"
            className="w-full p-3 rounded-lg border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
          />
          
          <button
            onClick={handleShortenUrl}
            disabled={isLoading || !urlToShorten.trim()}
            className="btn btn-primary w-full h-11"
          >
            {isLoading ? 'Shortening...' : 'Shorten URL'}
          </button>
          
          {shortenedUrl && (
            <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
              <h4 className="font-semibold mb-2">Your Short URL</h4>
              <div className="flex gap-2">
                <input
                  value={shortenedUrl.short}
                  readOnly
                  className="flex-1 p-2 rounded border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-sm"
                />
                <button
                  onClick={() => navigator.clipboard.writeText(shortenedUrl.short)}
                  className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
                >
                  Copy
                </button>
              </div>
            </div>
          )}
        </div>
        
        <div className="space-y-4">
          <h3 className="text-xl font-semibold">Recent URLs</h3>
          
          {urls.length > 0 ? (
            <div className="space-y-3">
              {urls.map(url => (
                <div key={url.id} className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 rounded-lg">
                  <div>
                    <p className="font-medium truncate">{url.short}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{url.original}</p>
                  </div>
                  <span className="text-sm text-gray-500 dark:text-gray-400">{url.clicks} clicks</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 dark:text-gray-400 text-center py-4">
              No URLs shortened yet
            </p>
          )}
        </div>
      </div>
    </div>
  );
  
  // Markdown Editor Panel
  const renderMarkdownEditor = () => (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-gray-100">Notion-like Markdown Editor</h2>
          <span className="badge">Demo · simulated data</span>
        </div>
        <p className="mt-1 text-sm text-gray-500">Offline-first markdown editor with live preview</p>
      </div>
      
      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <select
            value={activeNoteId}
            onChange={(e) => setActiveNoteId(e.target.value)}
            className="w-full p-3 rounded-lg border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
          >
            {notes.map(note => (
              <option key={note.id} value={note.id}>{note.title}</option>
            ))}
          </select>
          
          <textarea
            value={noteContent}
            onChange={(e) => setNoteContent(e.target.value)}
            placeholder="Write your markdown here..."
            rows={10}
            className="w-full p-3 rounded-lg border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 resize-none"
          />
        </div>
        
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Preview</h3>
          <div className="h-[400px] p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-300 dark:border-gray-600 overflow-y-auto">
            <MarkdownPreview content={noteContent} />
          </div>
        </div>
      </div>
    </div>
  );
  
  // Analytics Dashboard Panel
  const renderAnalyticsDashboard = () => (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-gray-100">Real-Time Analytics</h2>
          <span className="badge">Demo · simulated data</span>
        </div>
        <p className="mt-1 text-sm text-gray-500">Live monitoring of your scriptc-powered edge functions</p>
      </div>
      
      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Requests by Type</h3>
          <div className="space-y-3">
            {Object.entries(analytics.requestsByType).map(([type, count]) => (
              <div key={type} className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 rounded-lg">
                <span>{type}</span>
                <span className="font-semibold">{count}</span>
                <div className="w-24 h-2 bg-gray-200 dark:bg-gray-700 rounded-full ml-4">
                  <div
                    className="h-full bg-indigo-500 rounded-full"
                    style={{ width: `${(count / analytics.totalRequests) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
        
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Requests by Provider</h3>
          <div className="space-y-3">
            {Object.entries(analytics.requestsByProvider).map(([provider, count]) => (
              <div key={provider} className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 rounded-lg">
                <span>{provider}</span>
                <span className="font-semibold">{count}</span>
                <div className="w-24 h-2 bg-gray-200 dark:bg-gray-700 rounded-full ml-4">
                  <div
                    className="h-full bg-purple-500 rounded-full"
                    style={{ width: `${(count / Object.values(analytics.requestsByProvider).reduce((a, b) => a + b, 0)) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      <div className="bg-indigo-50 dark:bg-indigo-900/20 p-6 rounded-lg border border-indigo-200 dark:border-indigo-800">
        <h3 className="text-lg font-semibold mb-4">Performance Metrics</h3>
        
        <div className="grid md:grid-cols-3 gap-6">
          <div>
            <h4 className="font-semibold mb-2">Cold Start Latency</h4>
            <div className="text-3xl font-bold text-indigo-600">{stats.coldStart}</div>
            <p className="text-sm text-gray-600 dark:text-gray-400">vs 35-100ms with Node.js</p>
          </div>
          
          <div>
            <h4 className="font-semibold mb-2">Memory Usage</h4>
            <div className="text-3xl font-bold text-indigo-600">{stats.memoryUsage}</div>
            <p className="text-sm text-gray-600 dark:text-gray-400">vs 60-100MB with Node.js</p>
          </div>
          
          <div>
            <h4 className="font-semibold mb-2">Binary Size</h4>
            <div className="text-3xl font-bold text-indigo-600">{stats.wasmSize}</div>
            <p className="text-sm text-gray-600 dark:text-gray-400">Compiled WASM binary</p>
          </div>
        </div>
      </div>
    </div>
  );
  
  // Simple markdown preview
  const MarkdownPreview = ({ content }: { content: string }) => {
    const renderLine = (line: string, index: number) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('# ')) return <h1 key={index} className="text-2xl font-bold mt-4 mb-2">{trimmed.substring(2)}</h1>;
      if (trimmed.startsWith('## ')) return <h2 key={index} className="text-xl font-bold mt-3 mb-2">{trimmed.substring(3)}</h2>;
      if (trimmed.startsWith('### ')) return <h3 key={index} className="text-lg font-bold mt-2 mb-2">{trimmed.substring(4)}</h3>;
      if (trimmed.startsWith('> ')) return <blockquote key={index} className="border-l-4 border-gray-300 pl-4 my-2 text-gray-600 dark:text-gray-400">{trimmed.substring(2)}</blockquote>;
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('+ ')) return <li key={index} className="list-disc ml-6">{trimmed.substring(2)}</li>;
      if (trimmed.startsWith('**') && trimmed.endsWith('**')) return <strong key={index}>{trimmed.substring(2, trimmed.length - 2)}</strong>;
      if (trimmed.startsWith('*') && trimmed.endsWith('*')) return <em key={index}>{trimmed.substring(1, trimmed.length - 1)}</em>;
      return <p key={index} className="my-2">{line}</p>;
    };
    return <div>{content.split('\n').map(renderLine)}</div>;
  };
  
  // Error state
  const [error, setError] = useState<string | null>(null);
  
  return (
    <div className="min-h-screen app-bg">
      <SiteHeader active="/unified" />
      
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Navigation */}
        <nav className="mb-8">
          <div className="flex gap-2 overflow-x-auto pb-2 -mb-2">
            {[
              { id: 'editor', label: 'Editor' },
              { id: 'projects', label: 'Projects' },
              { id: 'terminal', label: 'Terminal' },
              { id: 'ai', label: 'AI Gateway' },
              { id: 'auth', label: 'Auth' },
              { id: 'shorten', label: 'URL Shortener' },
              { id: 'markdown', label: 'Markdown' },
              { id: 'analytics', label: 'Analytics' },
            ].map(feature => (
              <button
                key={feature.id}
                onClick={() => setActiveFeature(feature.id as ActiveFeature)}
                className={`h-9 px-3.5 rounded-lg text-sm flex items-center gap-2 whitespace-nowrap transition-colors ${
                  activeFeature === feature.id
                    ? 'bg-gray-100 text-black'
                    : 'text-gray-400 hover:text-gray-100 hover:bg-white/[0.06]'
                }`}
              >
                <span>{feature.label}</span>
              </button>
            ))}
          </div>
        </nav>
        
        {/* Main Content */}
        <main className="bg-white dark:bg-gray-900 rounded-xl shadow-lg overflow-hidden">
          <div className="p-6">
            {renderFeaturePanel()}
          </div>
        </main>
      </div>
      
      {/* New File Modal */}
      {showNewFileModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl p-6 max-w-sm w-full mx-4 border border-gray-700">
            <h3 className="text-lg font-semibold mb-4">New File</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-2">File Name</label>
                <input
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  placeholder="main.ts"
                  className="input"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-2">Language</label>
                <select
                  value={newFileLanguage}
                  onChange={(e) => setNewFileLanguage(e.target.value)}
                  className="input"
                >
                  <option value="typescript">TypeScript</option>
                  <option value="javascript">JavaScript</option>
                  <option value="python">Python</option>
                  <option value="json">JSON</option>
                  <option value="html">HTML</option>
                  <option value="css">CSS</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={createNewFile}
                  className="flex-1 bg-gray-100 text-black hover:bg-white p-2 rounded-lg transition-colors"
                >
                  Create
                </button>
                <button
                  onClick={() => setShowNewFileModal(false)}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-white p-2 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* New Project Modal */}
      {showNewProjectModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl p-6 max-w-sm w-full mx-4 border border-gray-700">
            <h3 className="text-lg font-semibold mb-4">New Project</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-2">Project Name</label>
                <input
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="My Project"
                  className="input"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={createNewProject}
                  className="flex-1 bg-gray-100 text-black hover:bg-white p-2 rounded-lg transition-colors"
                >
                  Create
                </button>
                <button
                  onClick={() => setShowNewProjectModal(false)}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-white p-2 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <SiteFooter />
    </div>
  );
}
