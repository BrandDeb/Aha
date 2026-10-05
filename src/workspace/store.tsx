'use client';

/**
 * Workspace state: the project's files, open editors, Git link, version
 * history and user settings. Persisted to localStorage (wrapped in try/catch
 * so private windows and blocked storage still work, just without saving).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_CODE } from '@/lib/templates';
import { deletePath, isRunnable, isValidPath, movePath, type Project } from './project';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface Settings {
  theme: 'dark' | 'light';
  highContrast: boolean;
  fontSize: number;
  formatOnSave: boolean;
  /** Prettier options */
  semi: boolean;
  singleQuote: boolean;
  printWidth: number;
  tabWidth: number;
  /** Command id -> key combo overrides ('' unbinds) */
  keybindings: Record<string, string>;
  /** Built-in extensions that are switched on */
  extensions: Record<string, boolean>;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  highContrast: false,
  fontSize: 14,
  formatOnSave: true,
  semi: true,
  singleQuote: true,
  printWidth: 100,
  tabWidth: 2,
  keybindings: {},
  extensions: { minimap: false, wordWrap: true, bracketPairs: true, stickyScroll: true, todoHighlights: true, byteField: true },
};

// ---------------------------------------------------------------------------
// Project state
// ---------------------------------------------------------------------------

export interface GitLink {
  owner: string;
  repo: string;
  branch: string;
  /** Commit the base was read at; commits are refused if the branch moved */
  headSha: string;
  /** File contents at the last pull/commit — the baseline for status and diffs */
  base: Record<string, string>;
}

export interface Snapshot {
  id: string;
  label: string;
  createdAt: number;
  files: Record<string, string>;
  entry: string;
}

interface EditorState {
  project: Project;
  tabs: string[];
  active: string;
  /** File shown in the right-hand split pane, if split view is on */
  split: string | null;
  git: GitLink | null;
}

type Action =
  | { type: 'write'; path: string; content: string }
  | { type: 'create'; path: string; content?: string }
  | { type: 'mkdir'; path: string }
  | { type: 'delete'; path: string }
  | { type: 'move'; from: string; to: string }
  | { type: 'open'; path: string }
  | { type: 'close'; path: string }
  | { type: 'setEntry'; path: string }
  | { type: 'rename-project'; name: string }
  | { type: 'split'; path: string | null }
  | { type: 'replace'; project: Project; git?: GitLink | null }
  | { type: 'git'; git: GitLink | null };

const STORAGE_KEY = 'nanocli:workspace';
const HISTORY_KEY = 'nanocli:history';
const SETTINGS_KEY = 'nanocli:settings';
const MAX_SNAPSHOTS = 40;

export function defaultProject(): Project {
  return { name: 'my-cli', files: { 'src/main.ts': DEFAULT_CODE }, folders: [], entry: 'src/main.ts' };
}

function initialState(): EditorState {
  const project = defaultProject();
  return { project, tabs: [project.entry], active: project.entry, split: null, git: null };
}

function reducer(state: EditorState, action: Action): EditorState {
  const { project } = state;
  switch (action.type) {
    case 'write':
      if (!(action.path in project.files) || project.files[action.path] === action.content) return state;
      return { ...state, project: { ...project, files: { ...project.files, [action.path]: action.content } } };
    case 'create': {
      if (!isValidPath(action.path) || action.path in project.files) return state;
      const files = { ...project.files, [action.path]: action.content ?? '' };
      const entry = project.entry || (isRunnable(action.path) ? action.path : '');
      return {
        ...state,
        project: { ...project, files, entry },
        tabs: state.tabs.includes(action.path) ? state.tabs : [...state.tabs, action.path],
        active: action.path,
      };
    }
    case 'mkdir':
      if (!isValidPath(action.path) || project.folders.includes(action.path)) return state;
      return { ...state, project: { ...project, folders: [...project.folders, action.path] } };
    case 'delete': {
      const next = deletePath(project, action.path);
      const tabs = state.tabs.filter((t) => t in next.files);
      const active = tabs.includes(state.active) ? state.active : tabs[tabs.length - 1] ?? next.entry ?? '';
      return {
        ...state,
        project: next,
        tabs: tabs.length ? tabs : active ? [active] : [],
        active,
        split: state.split && state.split in next.files ? state.split : null,
      };
    }
    case 'move': {
      const next = movePath(project, action.from, action.to);
      if ('error' in next) return state;
      const rename = (p: string) =>
        p === action.from ? action.to : p.startsWith(`${action.from}/`) ? action.to + p.slice(action.from.length) : p;
      return {
        ...state,
        project: next,
        tabs: state.tabs.map(rename),
        active: rename(state.active),
        split: state.split ? rename(state.split) : null,
      };
    }
    case 'open':
      if (!(action.path in project.files)) return state;
      return {
        ...state,
        tabs: state.tabs.includes(action.path) ? state.tabs : [...state.tabs, action.path],
        active: action.path,
      };
    case 'close': {
      const tabs = state.tabs.filter((t) => t !== action.path);
      const index = state.tabs.indexOf(action.path);
      const active = state.active === action.path ? tabs[Math.max(0, index - 1)] ?? '' : state.active;
      return { ...state, tabs, active };
    }
    case 'setEntry':
      if (!(action.path in project.files) || !isRunnable(action.path)) return state;
      return { ...state, project: { ...project, entry: action.path } };
    case 'rename-project':
      return { ...state, project: { ...project, name: action.name.trim() || project.name } };
    case 'split':
      return { ...state, split: action.path && action.path in project.files ? action.path : null };
    case 'replace': {
      const first = action.project.entry in action.project.files ? action.project.entry : Object.keys(action.project.files)[0] ?? '';
      return {
        project: action.project,
        tabs: first ? [first] : [],
        active: first,
        split: null,
        git: action.git === undefined ? state.git : action.git,
      };
    }
    case 'git':
      return { ...state, git: action.git };
  }
}

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function save(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function isEditorState(value: unknown): value is EditorState {
  const v = value as EditorState | null;
  return !!v && typeof v === 'object' && !!v.project && typeof v.project.files === 'object' && Array.isArray(v.tabs);
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface WorkspaceContextValue extends EditorState {
  dispatch: (action: Action) => void;
  hydrated: boolean;
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  snapshots: Snapshot[];
  saveSnapshot: (label: string) => void;
  restoreSnapshot: (id: string) => void;
  deleteSnapshot: (id: string) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Hydrate from storage once on mount (storage is only readable on the client)
  useEffect(() => {
    const stored = load<EditorState>(STORAGE_KEY);
    if (isEditorState(stored)) {
      dispatch({ type: 'replace', project: { ...stored.project, folders: stored.project.folders ?? [] }, git: stored.git ?? null });
      for (const tab of stored.tabs) dispatch({ type: 'open', path: tab });
      if (stored.active) dispatch({ type: 'open', path: stored.active });
    }
    const storedSettings = load<Partial<Settings>>(SETTINGS_KEY);
    /* eslint-disable react-hooks/set-state-in-effect -- localStorage is only readable after hydration */
    if (storedSettings) {
      setSettings({
        ...DEFAULT_SETTINGS,
        ...storedSettings,
        extensions: { ...DEFAULT_SETTINGS.extensions, ...storedSettings.extensions },
      });
    }
    setSnapshots(load<Snapshot[]>(HISTORY_KEY) ?? []);
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // Persist the workspace (debounced)
  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => save(STORAGE_KEY, state), 400);
    return () => clearTimeout(timer);
  }, [state, hydrated]);

  // Persist and apply settings
  useEffect(() => {
    if (!hydrated) return;
    save(SETTINGS_KEY, settings);
    const root = document.documentElement.classList;
    root.toggle('dark', settings.theme === 'dark');
    root.toggle('light', settings.theme === 'light');
    root.toggle('hc', settings.highContrast);
  }, [settings, hydrated]);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const persistSnapshots = useCallback((next: Snapshot[]) => {
    // Drop the oldest versions until the history fits in storage
    let list = next.slice(0, MAX_SNAPSHOTS);
    while (list.length > 1 && !save(HISTORY_KEY, list)) list = list.slice(0, -1);
    return list;
  }, []);

  const saveSnapshot = useCallback((label: string) => {
    const { project } = stateRef.current;
    setSnapshots((prev) => {
      if (prev[0] && JSON.stringify(prev[0].files) === JSON.stringify(project.files)) return prev;
      return persistSnapshots([
        { id: crypto.randomUUID(), label, createdAt: Date.now(), files: project.files, entry: project.entry },
        ...prev,
      ]);
    });
  }, [persistSnapshots]);

  const restoreSnapshot = useCallback((id: string) => {
    const current = stateRef.current.project;
    setSnapshots((prev) => {
      const target = prev.find((s) => s.id === id);
      if (!target) return prev;
      dispatch({ type: 'replace', project: { ...current, files: target.files, entry: target.entry } });
      return persistSnapshots([
        { id: crypto.randomUUID(), label: 'Before restore', createdAt: Date.now(), files: current.files, entry: current.entry },
        ...prev,
      ]);
    });
  }, [persistSnapshots]);

  const deleteSnapshot = useCallback((id: string) => {
    setSnapshots((prev) => persistSnapshots(prev.filter((s) => s.id !== id)));
  }, [persistSnapshots]);

  const value = useMemo<WorkspaceContextValue>(() => ({
    ...state,
    dispatch,
    hydrated,
    settings,
    updateSettings,
    snapshots,
    saveSnapshot,
    restoreSnapshot,
    deleteSnapshot,
  }), [state, hydrated, settings, updateSettings, snapshots, saveSnapshot, restoreSnapshot, deleteSnapshot]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  return value;
}
