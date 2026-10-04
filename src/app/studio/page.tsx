'use client';

/**
 * NanoCLI Studio - Studio Page
 * Zero-Runtime TypeScript CLI Generator with Live Terminal & Multi-File Support
 * 
 * Features:
 * - Monaco Editor with TypeScript support
 * - Live Terminal Emulator
 * - Multi-File Project Explorer
 * - Real-time Collaboration via WebSocket
 * - GitHub Integration
 * - Compilation to Native/C/WASM/LLVM
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { compileTypeScriptBrowser, type CompileResult } from '@/lib/compiler-browser';
import { WebSocketManager } from '@/lib/websocket';
import type {
  CollaboratorInfo,
  CompilePlatform,
  CompileTarget,
  GitHubRepoInfo,
  GitHubRepoItem,
  GitHubUserInfo,
} from '@/types';

// Load Monaco Editor dynamically
const Editor = dynamic(
  () => import('@monaco-editor/react').then((mod) => mod.default),
  { ssr: false, loading: () => <div className="loading">Loading editor...</div> }
);

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// File type for project explorer
interface FileNode {
  name: string;
  content: string;
  type: 'file' | 'folder';
  children?: FileNode[];
}

// Terminal history type
interface TerminalEntry {
  input: string;
  output: string;
}

// Template type
interface Template {
  name: string;
  code: string;
}

// The GitHub file the editor content was loaded from (or will be saved to)
interface LinkedRepoFile {
  path: string;
  sha?: string;
}

export default function StudioPage() {
  const [code, setCode] = useState<string>(`// NanoCLI Studio - Studio Edition
// Write TypeScript, Get Native Binaries

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
  const [target, setTarget] = useState<CompileTarget>('exe');
  const [platform, setPlatform] = useState<CompilePlatform>('linux');
  const [isCompiling, setIsCompiling] = useState<boolean>(false);
  const [compileResult, setCompileResult] = useState<CompileResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'editor' | 'output' | 'console' | 'terminal'>('editor');
  const [consoleMessages, setConsoleMessages] = useState<string[]>([]);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [projectName, setProjectName] = useState<string>('my-cli');
  const [showShareModal, setShowShareModal] = useState<boolean>(false);
  const [shareUrl, setShareUrl] = useState<string>('');
  const [showTemplates, setShowTemplates] = useState<boolean>(false);
  const [showGitHubModal, setShowGitHubModal] = useState<boolean>(false);
  const [githubUser, setGithubUser] = useState<GitHubUserInfo | null>(null);
  const [githubRepos, setGithubRepos] = useState<GitHubRepoInfo[]>([]);
  const [showRepoBrowser, setShowRepoBrowser] = useState<boolean>(false);
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepoInfo | null>(null);
  const [repoPath, setRepoPath] = useState<string>('');
  const [repoFiles, setRepoFiles] = useState<GitHubRepoItem[]>([]);
  const [repoLoading, setRepoLoading] = useState<boolean>(false);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [linkedFile, setLinkedFile] = useState<LinkedRepoFile | null>(null);
  const [commitMessage, setCommitMessage] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [showCollaboration, setShowCollaboration] = useState<boolean>(false);
  const [collaborators, setCollaborators] = useState<CollaboratorInfo[]>([]);
  const [gitStatus, setGitStatus] = useState<{modified: string[], untracked: string[]}>({ modified: [], untracked: [] });

  // Live Terminal Emulator State
  const [terminalHistory, setTerminalHistory] = useState<TerminalEntry[]>([]);
  const [terminalCommand, setTerminalCommand] = useState<string>('');
  const [terminalCursor, setTerminalCursor] = useState<boolean>(true);

  // Multi-File Project Explorer State
  const [files, setFiles] = useState<FileNode[]>([
    { name: 'app.ts', content: code, type: 'file' },
  ]);
  const [selectedFile, setSelectedFile] = useState<string>('app.ts');
  const [showFileModal, setShowFileModal] = useState<boolean>(false);
  const [newFileName, setNewFileName] = useState<string>('');
  const [newFileType, setNewFileType] = useState<'file' | 'folder'>('file');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const [clientId] = useState(() => crypto.randomUUID());
  const [projectId] = useState(() => crypto.randomUUID());
  const wsManager = useRef<WebSocketManager | null>(null);

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
  }, [showCollaboration, projectId, clientId]);

  // Check GitHub authentication status
  useEffect(() => {
    fetch('/api/github/user')
      .then(res => res.json())
      .then(data => {
        if (data.authenticated) {
          setGithubUser(data.user);
          // Load user repos
          fetch('/api/github/repos')
            .then(res => res.json())
            .then(data => setGithubRepos(Array.isArray(data.repos) ? data.repos : []))
            .catch(console.error);
        }
      })
      .catch(console.error);
  }, []);

  // Add message to console
  const addConsoleMessage = useCallback((message: string) => {
    setConsoleMessages(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  }, []);

  // Load a directory listing from a repo
  const loadRepoFiles = useCallback(async (repo: GitHubRepoInfo, dirPath: string = '') => {
    setSelectedRepo(repo);
    setRepoPath(dirPath);
    setRepoLoading(true);
    setRepoError(null);
    setShowRepoBrowser(true);
    try {
      const query = dirPath ? `?path=${encodeURIComponent(dirPath)}` : '';
      const response = await fetch(`/api/github/repos/${repo.full_name}/contents${query}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load repository');
      }
      setRepoFiles(Array.isArray(data) ? data : []);
    } catch (err) {
      setRepoFiles([]);
      setRepoError(errorMessage(err));
    } finally {
      setRepoLoading(false);
    }
  }, []);

  // Load file from repo
  const loadFromRepo = useCallback(async (file: GitHubRepoItem) => {
    if (!selectedRepo) return;
    try {
      const response = await fetch(
        `/api/github/repos/${selectedRepo.full_name}/file?path=${encodeURIComponent(file.path)}`
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load file');
      }
      setCode(data.content);
      setFilename(file.name);
      setLinkedFile({ path: file.path, sha: data.sha });
      setShowRepoBrowser(false);
      addConsoleMessage(`Loaded from GitHub: ${selectedRepo.full_name}/${file.path}`);
    } catch (err) {
      setRepoError(errorMessage(err));
    }
  }, [selectedRepo, addConsoleMessage]);

  // Commit the current editor content to the selected repository
  const saveToGitHub = useCallback(async () => {
    if (!githubUser || !selectedRepo) {
      addConsoleMessage('Please select a repository first');
      setShowRepoBrowser(true);
      return;
    }

    const targetPath = linkedFile?.path || (repoPath ? `${repoPath}/${filename}` : filename);
    setIsSaving(true);
    try {
      const response = await fetch(`/api/github/repos/${selectedRepo.full_name}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: targetPath,
          content: code,
          message: commitMessage || undefined,
          sha: linkedFile?.path === targetPath ? linkedFile.sha : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          response.status === 409 || response.status === 422
            ? 'File changed on GitHub since it was loaded — reload it and try again'
            : data.error || 'Failed to save file'
        );
      }
      setLinkedFile({ path: targetPath, sha: data.sha });
      setCommitMessage('');
      setGitStatus({ modified: [], untracked: [] });
      addConsoleMessage(`Committed ${targetPath} to ${selectedRepo.full_name} (${String(data.commit?.sha).slice(0, 7)})`);
    } catch (err) {
      addConsoleMessage(`GitHub save failed: ${errorMessage(err)}`);
    } finally {
      setIsSaving(false);
    }
  }, [githubUser, selectedRepo, linkedFile, repoPath, filename, code, commitMessage, addConsoleMessage]);

  // Check git status (simulated)
  const checkGitStatus = useCallback(() => {
    // In a real implementation, this would check actual git status
    setGitStatus({
      modified: files.filter(f => f.type === 'file' && f.content !== '').map(f => f.name),
      untracked: [],
    });
  }, [files]);

  // Terminal cursor blink effect
  useEffect(() => {
    const interval = setInterval(() => {
      setTerminalCursor(prev => !prev);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Update file content when code changes
  useEffect(() => {
    if (selectedFile) {
      setFiles(prev => prev.map(f => 
        f.name === selectedFile ? { ...f, content: code } : f
      ));
    }
  }, [code, selectedFile]);

  // Initialize with current code
  useEffect(() => {
    if (files.length === 1 && files[0].name === 'app.ts' && files[0].content !== code) {
      setFiles([{ name: 'app.ts', content: code, type: 'file' }]);
    }
  }, [code, files]);

  // Handle compilation
  const handleCompile = useCallback(async (): Promise<CompileResult | null> => {
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
      return result;
    } catch (err) {
      setError(errorMessage(err) || 'Compilation error');
      addConsoleMessage(`Error: ${errorMessage(err)}`);
      return null;
    } finally {
      setIsCompiling(false);
    }
  }, [code, filename, target, platform, addConsoleMessage]);

  // Download compiled file
  const handleDownload = useCallback(async () => {
    if (!compileResult?.filename) return;

    try {
      const response = await fetch(`/api/download/${encodeURIComponent(compileResult.filename)}`);
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
    } catch (err) {
      setError(errorMessage(err));
      addConsoleMessage(`Download error: ${errorMessage(err)}`);
    }
  }, [compileResult, addConsoleMessage]);

  // Login with GitHub
  const handleGitHubLogin = useCallback(() => {
    // Full-page navigation: the OAuth flow is a server redirect, not a client route
    window.location.assign('/api/github/auth');
  }, []);

  // Logout from GitHub
  const handleGitHubLogout = useCallback(async () => {
    await fetch('/api/github/user', { method: 'DELETE' });
    setGithubUser(null);
    addConsoleMessage('Logged out from GitHub');
  }, [addConsoleMessage]);

  // Load template
  const loadTemplate = useCallback((template: Template) => {
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

  // Load from share URL (once, on mount — re-running would clobber edits)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shareData = params.get('share');
    if (shareData) {
      try {
        const decoded = JSON.parse(decodeURIComponent(atob(shareData)));
        if (typeof decoded.code === 'string') setCode(decoded.code);
        if (typeof decoded.filename === 'string') setFilename(decoded.filename);
        if (['exe', 'c', 'llvm', 'wasm'].includes(decoded.target)) setTarget(decoded.target);
        if (['linux', 'macos', 'windows'].includes(decoded.platform)) setPlatform(decoded.platform);
        if (typeof decoded.projectName === 'string') setProjectName(decoded.projectName);
        addConsoleMessage('Loaded shared project');
      } catch (err) {
        console.error('Error loading share:', err);
      }
    }
  }, [addConsoleMessage]);

  // Toggle dark mode
  const toggleDarkMode = useCallback(() => {
    setIsDarkMode(!isDarkMode);
    document.documentElement.classList.toggle('dark');
  }, [isDarkMode]);

  // Terminal Emulator Functions
  const executeTerminalCommand = useCallback(async (command: string) => {
    if (!command.trim()) return;

    setTerminalHistory(prev => [...prev, { input: `$ ${command}`, output: '' }]);
    setTerminalCommand('');

    try {
      // Handle built-in commands
      if (command.toLowerCase() === 'clear' || command.toLowerCase() === 'cls') {
        setTerminalHistory([]);
        return;
      }

      if (command.toLowerCase() === 'help') {
        setTerminalHistory(prev => [
          ...prev.slice(0, -1),
          {
            input: `$ ${command}`,
            output: 'Available commands:\n  clear/cls    - Clear terminal\n  help        - Show this help\n  ls          - List files\n  compile     - Compile current project\n  run <file>  - Run compiled binary\n  echo <text> - Print text\n  date        - Show current date\n  whoami      - Show current user',
          },
        ]);
        return;
      }

      if (command.toLowerCase() === 'ls') {
        const fileList = files.map(f => f.type === 'folder' ? `${f.name}/` : f.name).join('\n  ');
        setTerminalHistory(prev => [
          ...prev.slice(0, -1),
          { input: `$ ${command}`, output: `Files:\n  ${fileList}` },
        ]);
        return;
      }

      if (command.toLowerCase() === 'date') {
        const date = new Date().toLocaleString();
        setTerminalHistory(prev => [
          ...prev.slice(0, -1),
          { input: `$ ${command}`, output: date },
        ]);
        return;
      }

      if (command.toLowerCase().startsWith('echo ')) {
        const text = command.slice(5);
        setTerminalHistory(prev => [
          ...prev.slice(0, -1),
          { input: `$ ${command}`, output: text },
        ]);
        return;
      }

      if (command.toLowerCase() === 'whoami') {
        const user = githubUser?.login || 'anonymous';
        setTerminalHistory(prev => [
          ...prev.slice(0, -1),
          { input: `$ ${command}`, output: user },
        ]);
        return;
      }

      if (command.toLowerCase() === 'compile') {
        const compiled = await handleCompile();
        const result = compiled?.success ? 'Compilation successful!' : compiled?.error || 'Compilation failed';
        setTerminalHistory(prev => [
          ...prev.slice(0, -1),
          { input: `$ ${command}`, output: result },
        ]);
        return;
      }

      if (command.toLowerCase().startsWith('run ')) {
        const fileToRun = command.slice(4);
        if (compileResult?.filename === fileToRun || fileToRun === 'app') {
          setTerminalHistory(prev => [
            ...prev.slice(0, -1),
            { input: `$ ${command}`, output: 'Running compiled binary...\n[Note: Binary execution is simulated in browser. Download and run locally for actual execution.]' },
          ]);
        } else {
          setTerminalHistory(prev => [
            ...prev.slice(0, -1),
            { input: `$ ${command}`, output: `File '${fileToRun}' not found or not compiled` },
          ]);
        }
        return;
      }

      // Unknown command
      setTerminalHistory(prev => [
        ...prev.slice(0, -1),
        { input: `$ ${command}`, output: `Command not found: ${command.split(' ')[0]}\nTry 'help' for available commands` },
      ]);
    } catch (err) {
      setTerminalHistory(prev => [
        ...prev.slice(0, -1),
        { input: `$ ${command}`, output: `Error: ${errorMessage(err)}` },
      ]);
    }
  }, [files, githubUser, compileResult, handleCompile]);

  // Handle terminal input
  const handleTerminalKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      executeTerminalCommand(terminalCommand);
    }
  }, [terminalCommand, executeTerminalCommand]);

  // File Management Functions
  const createNewFile = useCallback(() => {
    if (!newFileName.trim()) return;

    const newFile: FileNode = {
      name: newFileName,
      content: newFileType === 'file' ? '// New file\n' : '',
      type: newFileType,
      children: newFileType === 'folder' ? [] : undefined,
    };

    setFiles(prev => [...prev, newFile]);
    if (newFileType === 'file') {
      setSelectedFile(newFileName);
      setCode('// New file\n');
    }

    setNewFileName('');
    setShowFileModal(false);
    addConsoleMessage(`Created ${newFileType}: ${newFileName}`);
  }, [newFileName, newFileType, addConsoleMessage]);

  const deleteFile = useCallback((fileName: string) => {
    if (files.length <= 1) {
      addConsoleMessage('Cannot delete the last file');
      return;
    }

    setFiles(prev => prev.filter(f => f.name !== fileName));
    if (selectedFile === fileName) {
      setSelectedFile(files[0]?.name || '');
      setCode(files[0]?.content || '');
    }
    addConsoleMessage(`Deleted: ${fileName}`);
  }, [files, selectedFile, addConsoleMessage]);

  const selectFile = useCallback((fileName: string) => {
    setSelectedFile(fileName);
    const file = files.find(f => f.name === fileName);
    if (file && file.type === 'file') {
      setCode(file.content);
      setFilename(fileName);
    }
  }, [files]);

  const saveCurrentFile = useCallback(() => {
    setFiles(prev => prev.map(f => 
      f.name === selectedFile ? { ...f, content: code } : f
    ));
    addConsoleMessage(`Saved: ${selectedFile}`);
  }, [code, selectedFile, addConsoleMessage]);

  const toggleFolder = useCallback((folderName: string) => {
    setExpandedFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(folderName)) {
        newSet.delete(folderName);
      } else {
        newSet.add(folderName);
      }
      return newSet;
    });
  }, []);

  // Templates
  const templates: Template[] = [
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
              Studio Edition
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
        <div className="grid lg:grid-cols-4 gap-6">
          {/* Left Sidebar - Project Info & Explorer */}
          <div className="lg:col-span-1 space-y-4">
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
              <button
                onClick={saveCurrentFile}
                className="w-full mt-2 p-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors"
              >
                Save File
              </button>
            </div>

            {/* Project Explorer */}
            <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-400">Project Explorer</h3>
                <button
                  onClick={() => setShowFileModal(true)}
                  className="p-1 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
                >
                  <span className="text-lg">+</span>
                </button>
              </div>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {files.map((file) => (
                  <div key={file.name} className="flex items-center justify-between p-1 rounded hover:bg-gray-700/50">
                    <button
                      onClick={() => file.type === 'folder' ? toggleFolder(file.name) : selectFile(file.name)}
                      className="flex items-center gap-2 flex-1 text-left text-sm"
                    >
                      <span>
                        {file.type === 'folder' ? 
                          (expandedFolders.has(file.name) ? '▼' : '▶') :
                          '→'}
                      </span>
                      <span className={selectedFile === file.name ? 'text-purple-400' : 'text-gray-300'}>
                        {file.name}
                      </span>
                    </button>
                    {file.type === 'file' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteFile(file.name);
                        }}
                        className="p-1 rounded hover:bg-red-600/20 transition-colors"
                      >
                        <span className="text-xs text-red-400">✕</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
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

            {githubUser && (
              <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                <h3 className="text-sm font-semibold text-gray-400 mb-3">GitHub</h3>
                <button
                  onClick={() => setShowRepoBrowser(true)}
                  className="w-full flex items-center justify-between p-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors mb-2"
                >
                  <span>Browse Repos</span>
                  <span>▼</span>
                </button>
                <button
                  onClick={checkGitStatus}
                  className="w-full flex items-center justify-between p-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors mb-2"
                >
                  <span>Git Status</span>
                  {gitStatus.modified.length > 0 && (
                    <span className="text-xs text-yellow-400">{gitStatus.modified.length} modified</span>
                  )}
                </button>
                <p className="text-xs text-gray-500 mb-2 truncate">
                  {selectedRepo
                    ? `${selectedRepo.full_name}/${linkedFile?.path || (repoPath ? `${repoPath}/${filename}` : filename)}`
                    : 'No repository selected'}
                </p>
                <input
                  type="text"
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  placeholder="Commit message (optional)"
                  className="w-full p-2 mb-2 bg-gray-700 rounded-lg border border-gray-600 focus:border-purple-500 focus:outline-none text-white text-sm"
                />
                <button
                  onClick={saveToGitHub}
                  disabled={!selectedRepo || isSaving}
                  className="w-full p-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 rounded-lg text-sm font-medium transition-colors"
                >
                  {isSaving ? 'Committing...' : 'Commit to GitHub'}
                </button>
              </div>
            )}

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
                  <span>{showCollaboration ? '👥 Collab On' : '👥 Collab'}</span>
                </button>
              </div>
            </div>

            {/* Compilation Settings */}
            <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
              <h3 className="text-sm font-semibold text-gray-400 mb-3">Target</h3>
              <div className="space-y-2">
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value as CompileTarget)}
                  className="w-full p-2 bg-gray-700 rounded-lg border border-gray-600 focus:border-purple-500 focus:outline-none text-white"
                >
                  <option value="exe">Native Binary</option>
                  <option value="c">C Code</option>
                  <option value="llvm">LLVM IR</option>
                  <option value="wasm">WASM</option>
                </select>

                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value as CompilePlatform)}
                  className="w-full p-2 bg-gray-700 rounded-lg border border-gray-600 focus:border-purple-500 focus:outline-none text-white"
                >
                  <option value="linux">Linux</option>
                  <option value="macos">macOS</option>
                  <option value="windows">Windows</option>
                </select>
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
          </div>

          {/* Center - Editor */}
          <div className="lg:col-span-3 space-y-4">
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
                <button
                  onClick={() => setActiveTab('terminal')}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    activeTab === 'terminal' 
                      ? 'bg-gray-700 text-white' 
                      : 'text-gray-400 hover:bg-gray-700/50'
                  }`}
                >
                  Terminal
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

                {activeTab === 'terminal' && (
                  <div className="h-full p-4 overflow-y-auto bg-black">
                    <div className="space-y-1">
                      {terminalHistory.map((entry, index) => (
                        <div key={index} className="mb-2">
                          <div className="text-green-400 font-mono text-sm">
                            {entry.input}
                          </div>
                          {entry.output && (
                            <div className="text-gray-300 font-mono text-sm whitespace-pre-wrap">
                              {entry.output}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 mt-4">
                      <span className="text-green-400 font-mono">$</span>
                      <input
                        type="text"
                        value={terminalCommand}
                        onChange={(e) => setTerminalCommand(e.target.value)}
                        onKeyDown={handleTerminalKeyDown}
                        className="flex-1 bg-transparent border-none outline-none text-white font-mono text-sm"
                        autoFocus
                      />
                      {terminalCursor && (
                        <span className="text-white bg-white/50 w-1 h-4 animate-pulse"></span>
                      )}
                    </div>
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

      {/* New File Modal */}
      {showFileModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4 border border-gray-700">
            <h3 className="text-lg font-semibold mb-4">Create New {newFileType}</h3>
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">Name</label>
              <input
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value.replace(/[^a-zA-Z0-9._-]/g, ''))}
                placeholder={`Enter ${newFileType} name`}
                className="w-full p-2 bg-gray-700 rounded-lg border border-gray-600 focus:border-purple-500 focus:outline-none text-white"
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">Type</label>
              <select
                value={newFileType}
                onChange={(e) => setNewFileType(e.target.value as 'file' | 'folder')}
                className="w-full p-2 bg-gray-700 rounded-lg border border-gray-600 focus:border-purple-500 focus:outline-none text-white"
              >
                <option value="file">File</option>
                <option value="folder">Folder</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button
                onClick={createNewFile}
                disabled={!newFileName.trim()}
                className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 rounded-lg font-medium transition-colors"
              >
                Create
              </button>
              <button
                onClick={() => setShowFileModal(false)}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* Repository Browser Modal */}
      {showRepoBrowser && !selectedRepo && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl p-6 max-w-2xl w-full mx-4 border border-gray-700 max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">GitHub Repositories</h3>
              <button
                onClick={() => setShowRepoBrowser(false)}
                className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
              >
                ✕
              </button>
            </div>
            
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {githubRepos.length === 0 && (
                <p className="text-sm text-gray-500">No repositories found.</p>
              )}
              {githubRepos.map((repo) => (
                <div key={repo.id} className="p-3 bg-gray-700/50 rounded-lg hover:bg-gray-700 transition-colors">
                  <div className="flex items-center gap-3">
                    <span className="text-yellow-400">●</span>
                    <button
                      onClick={() => loadRepoFiles(repo)}
                      className="flex-1 text-left font-medium"
                    >
                      {repo.name}
                    </button>
                    {repo.private && <span className="text-xs text-gray-400">Private</span>}
                    <span className="text-xs text-gray-500">{repo.language}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1 pl-6">{repo.description || 'No description'}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Repository Files Modal */}
      {showRepoBrowser && selectedRepo && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl p-6 max-w-2xl w-full mx-4 border border-gray-700 max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4 gap-2">
              <h3 className="text-lg font-semibold truncate">
                {selectedRepo.full_name}{repoPath ? `/${repoPath}` : ''}
              </h3>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => {
                    setSelectedRepo(null);
                    setRepoFiles([]);
                    setRepoPath('');
                    setRepoError(null);
                  }}
                  className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors"
                >
                  All repos
                </button>
                <button
                  onClick={() => setShowRepoBrowser(false)}
                  className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
                >
                  ✕
                </button>
              </div>
            </div>

            {repoError && (
              <p className="mb-3 text-sm text-red-400">{repoError}</p>
            )}
            
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {repoPath && (
                <button
                  onClick={() => loadRepoFiles(selectedRepo, repoPath.split('/').slice(0, -1).join('/'))}
                  className="w-full p-3 bg-gray-700/50 rounded-lg hover:bg-gray-700 transition-colors text-left text-gray-300"
                >
                  ↑ ..
                </button>
              )}
              {repoLoading && <p className="text-sm text-gray-500">Loading...</p>}
              {!repoLoading && !repoError && repoFiles.length === 0 && (
                <p className="text-sm text-gray-500">This directory is empty. Commit the current file to create it here.</p>
              )}
              {!repoLoading && repoFiles.map((file) => (
                <div key={file.path} className="p-3 bg-gray-700/50 rounded-lg hover:bg-gray-700 transition-colors">
                  <div className="flex items-center gap-3">
                    <span className={file.type === 'dir' ? 'text-yellow-400' : 'text-blue-400'}>
                      {file.type === 'dir' ? '📁' : '📄'}
                    </span>
                    <button
                      onClick={() => file.type === 'dir' ? loadRepoFiles(selectedRepo, file.path) : loadFromRepo(file)}
                      disabled={file.type !== 'dir' && file.type !== 'file'}
                      className="flex-1 text-left disabled:text-gray-500"
                    >
                      {file.name}
                    </button>
                    <span className="text-xs text-gray-500">{file.type === 'dir' ? 'Dir' : 'File'}</span>
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-4 text-xs text-gray-500">
              Pick a file to open it, or close this dialog to commit the current file into this folder.
            </p>
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
          NanoCLI Studio - Studio Edition with Live Terminal & Multi-File Support
        </p>
      </footer>
    </div>
  );
}
