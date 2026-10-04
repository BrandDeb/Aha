/**
 * Pure project/VFS helpers. No React, no DOM — unit tested in tests/workspace.test.ts.
 */

export interface Project {
  name: string;
  /** Project-relative path -> file content */
  files: Record<string, string>;
  /** Folders that exist without files (others are implied by file paths) */
  folders: string[];
  /** File compiled by Build/Run */
  entry: string;
}

export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children: TreeNode[];
}

/** Same rules the server enforces (see isValidProjectPath in lib/compiler.ts) */
export function isValidPath(filePath: string): boolean {
  return filePath.length > 0 && filePath.length <= 200 &&
    /^(?:[A-Za-z0-9_][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(filePath);
}

/** Resolve `target` against a working directory like a shell would */
export function resolvePath(cwd: string, target: string): string | null {
  const parts = (target.startsWith('/') ? target : `${cwd}/${target}`).split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!out.length) return null;
      out.pop();
    } else {
      out.push(part);
    }
  }
  return out.join('/');
}

export function dirname(filePath: string): string {
  const i = filePath.lastIndexOf('/');
  return i === -1 ? '' : filePath.slice(0, i);
}

export function basename(filePath: string): string {
  return filePath.slice(filePath.lastIndexOf('/') + 1);
}

/** Every folder in the project, including ones implied by file paths */
export function allFolders(project: Pick<Project, 'files' | 'folders'>): string[] {
  const set = new Set<string>();
  const add = (folder: string) => {
    for (let d = folder; d; d = dirname(d)) set.add(d);
  };
  for (const file of Object.keys(project.files)) add(dirname(file));
  for (const folder of project.folders) add(folder);
  return [...set].sort();
}

export function isFolder(project: Pick<Project, 'files' | 'folders'>, folderPath: string): boolean {
  return folderPath === '' || allFolders(project).includes(folderPath);
}

/** Folders first, then files, alphabetically */
export function buildTree(project: Pick<Project, 'files' | 'folders'>): TreeNode[] {
  const root: TreeNode = { name: '', path: '', type: 'folder', children: [] };
  const folderNodes = new Map<string, TreeNode>([['', root]]);
  const ensureFolder = (folder: string): TreeNode => {
    const existing = folderNodes.get(folder);
    if (existing) return existing;
    const node: TreeNode = { name: basename(folder), path: folder, type: 'folder', children: [] };
    folderNodes.set(folder, node);
    ensureFolder(dirname(folder)).children.push(node);
    return node;
  };
  for (const folder of allFolders(project)) ensureFolder(folder);
  for (const file of Object.keys(project.files)) {
    ensureFolder(dirname(file)).children.push({ name: basename(file), path: file, type: 'file', children: [] });
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1));
    nodes.forEach((n) => sort(n.children));
  };
  sort(root.children);
  return root.children;
}

/** Move/rename a file or folder; returns the new project or an error */
export function movePath(project: Project, from: string, to: string): Project | { error: string } {
  if (!isValidPath(to)) return { error: `Invalid path: ${to}` };
  if (from === to) return project;
  const files = { ...project.files };
  if (from in files) {
    if (to in files) return { error: `${to} already exists` };
    files[to] = files[from];
    delete files[from];
    return {
      ...project,
      files,
      entry: project.entry === from ? to : project.entry,
      folders: project.folders,
    };
  }
  if (!isFolder(project, from)) return { error: `No such file or folder: ${from}` };
  if (to.startsWith(`${from}/`)) return { error: 'Cannot move a folder into itself' };
  let entry = project.entry;
  for (const file of Object.keys(project.files)) {
    if (file.startsWith(`${from}/`)) {
      const target = to + file.slice(from.length);
      if (target in files && !target.startsWith(`${from}/`)) return { error: `${target} already exists` };
      files[target] = files[file];
      delete files[file];
      if (entry === file) entry = target;
    }
  }
  const folders = project.folders.map((f) => (f === from || f.startsWith(`${from}/`) ? to + f.slice(from.length) : f));
  return { ...project, files, folders, entry };
}

/** Delete a file or a folder (recursively) */
export function deletePath(project: Project, target: string): Project {
  const files = { ...project.files };
  delete files[target];
  for (const file of Object.keys(files)) {
    if (file.startsWith(`${target}/`)) delete files[file];
  }
  const folders = project.folders.filter((f) => f !== target && !f.startsWith(`${target}/`));
  const entry = project.entry in files ? project.entry : Object.keys(files).find(isRunnable) ?? '';
  return { ...project, files, folders, entry };
}

export function isRunnable(filePath: string): boolean {
  return /\.(?:ts|mts|cts|js|mjs|cjs)$/.test(filePath) && !filePath.endsWith('.d.ts');
}

export function languageFor(filePath: string): string {
  if (/\.(?:ts|mts|cts|tsx)$/.test(filePath)) return 'typescript';
  if (/\.(?:js|mjs|cjs|jsx)$/.test(filePath)) return 'javascript';
  if (filePath.endsWith('.json')) return 'json';
  if (filePath.endsWith('.md')) return 'markdown';
  if (filePath.endsWith('.css')) return 'css';
  if (filePath.endsWith('.html')) return 'html';
  return 'plaintext';
}

// ---------------------------------------------------------------------------
// Git status
// ---------------------------------------------------------------------------

export type ChangeKind = 'added' | 'modified' | 'deleted';

export function diffStatus(base: Record<string, string>, current: Record<string, string>): Record<string, ChangeKind> {
  const changes: Record<string, ChangeKind> = {};
  for (const [file, content] of Object.entries(current)) {
    if (!(file in base)) changes[file] = 'added';
    else if (base[file] !== content) changes[file] = 'modified';
  }
  for (const file of Object.keys(base)) {
    if (!(file in current)) changes[file] = 'deleted';
  }
  return changes;
}

/** Line-level summary used for "+12 −3" badges */
export function lineDelta(before: string, after: string): { added: number; removed: number } {
  const a = before.split('\n');
  const b = after.split('\n');
  // Longest common subsequence on lines (projects are small; O(n·m) is fine)
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const common = dp[0][0];
  return { added: b.length - common, removed: a.length - common };
}

// ---------------------------------------------------------------------------
// Dependency graph
// ---------------------------------------------------------------------------

export interface DependencyGraph {
  /** file -> resolved project files it imports */
  edges: Record<string, string[]>;
  /** file -> external modules (node:fs, lodash, …) */
  external: Record<string, string[]>;
  /** file -> relative imports that don't resolve to a project file */
  unresolved: Record<string, string[]>;
  /** Each cycle as a list of files, first file repeated implicitly */
  cycles: string[][];
  /** Files not reachable from the entry */
  unreachable: string[];
  /** Distance from the entry (for layered layouts) */
  depth: Record<string, number>;
}

const IMPORT_PATTERNS = [
  /\bimport\s+(?:type\s+)?(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/g,
  /\bexport\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
];

export function parseImports(source: string): string[] {
  // Drop comments so commented-out imports don't count
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const found = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of code.matchAll(pattern)) found.add(match[1]);
  }
  return [...found];
}

const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.mts', '.js', '.mjs', '.json', '/index.ts', '/index.js'];

export function resolveImport(files: Record<string, string>, from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = resolvePath(dirname(from), specifier.replace(/\.js$/, ''));
  if (base === null) return null;
  for (const suffix of RESOLVE_SUFFIXES) {
    if (`${base}${suffix}` in files) return `${base}${suffix}`;
  }
  // `./x.js` written for ESM resolution of x.ts
  if (specifier.endsWith('.js')) {
    const exact = resolvePath(dirname(from), specifier);
    if (exact && exact in files) return exact;
  }
  return null;
}

export function buildDependencyGraph(files: Record<string, string>, entry: string): DependencyGraph {
  const sources = Object.keys(files).filter((f) => /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/.test(f));
  const edges: Record<string, string[]> = {};
  const external: Record<string, string[]> = {};
  const unresolved: Record<string, string[]> = {};

  for (const file of sources) {
    edges[file] = [];
    for (const specifier of parseImports(files[file])) {
      if (!specifier.startsWith('.')) {
        (external[file] ??= []).push(specifier);
        continue;
      }
      const target = resolveImport(files, file, specifier);
      if (target) {
        if (!edges[file].includes(target)) edges[file].push(target);
      } else {
        (unresolved[file] ??= []).push(specifier);
      }
    }
  }

  // Depth via BFS from the entry
  const depth: Record<string, number> = {};
  if (entry in edges) {
    depth[entry] = 0;
    const queue = [entry];
    while (queue.length) {
      const file = queue.shift()!;
      for (const next of edges[file] ?? []) {
        if (!(next in depth)) {
          depth[next] = depth[file] + 1;
          queue.push(next);
        }
      }
    }
  }
  const unreachable = sources.filter((f) => !(f in depth)).sort();

  // Tarjan's strongly connected components → cycles
  let index = 0;
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];
  const strongConnect = (v: string) => {
    indices.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of edges[v] ?? []) {
      if (!indices.has(w)) {
        strongConnect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, indices.get(w)!));
      }
    }
    if (low.get(v) === indices.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      if (component.length > 1 || (edges[v] ?? []).includes(v)) cycles.push(component.reverse());
    }
  };
  for (const file of sources) if (!indices.has(file)) strongConnect(file);

  return { edges, external, unresolved, cycles, unreachable, depth };
}

// ---------------------------------------------------------------------------
// Keybindings
// ---------------------------------------------------------------------------

const CODE_NAMES: Record<string, string> = {
  Backslash: '\\', Slash: '/', Backquote: '`', Comma: ',', Period: '.', Semicolon: ';',
  BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Quote: "'", Space: 'Space',
};

/** Normalise a keyboard event to "Mod+Shift+K" form (Mod = ⌘ on Apple, Ctrl elsewhere) */
export function comboFromEvent(
  e: { key: string; code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean },
  isMac: boolean
): string | null {
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return null;
  let key: string;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (CODE_NAMES[e.code]) key = CODE_NAMES[e.code];
  else key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const parts: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) parts.push('Mod');
  if (isMac && e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

/** Human label: Mod+Shift+F → ⌘⇧F on Apple, Ctrl+Shift+F elsewhere */
export function formatCombo(combo: string, isMac: boolean): string {
  if (!combo) return '';
  const symbols: Record<string, string> = isMac
    ? { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Enter: '↵', Escape: 'Esc', Backspace: '⌫' }
    : { Mod: 'Ctrl', Enter: 'Enter', Escape: 'Esc' };
  return combo
    .split('+')
    .map((part) => symbols[part] ?? part)
    .join(isMac ? '' : '+');
}
