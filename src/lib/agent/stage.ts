/**
 * The agent's proposal: edits layered over the user's files. Nothing the agent
 * writes touches the project until the user accepts it, so discarding a stage
 * is the rollback, and builds can run against what the project *would* be.
 */

import { isValidPath, lineDelta } from '../../workspace/project.ts';

export type StageChange = 'added' | 'modified' | 'deleted';

export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_STAGED_FILES = 200;

export interface SerializedStage {
  edits: [string, string | null][];
  before: Record<string, string | null>;
}

export class Stage {
  private base: Record<string, string>;
  private readonly edits = new Map<string, string | null>(); // null = deleted

  constructor(base: Record<string, string>) {
    this.base = { ...base };
  }

  /** The project as it would be if every staged change were accepted */
  files(): Record<string, string> {
    const merged = { ...this.base };
    for (const [path, content] of this.edits) {
      if (content === null) delete merged[path];
      else merged[path] = content;
    }
    return merged;
  }

  has(path: string): boolean {
    return path in this.files();
  }

  read(path: string): string | undefined {
    const edited = this.edits.get(path);
    if (edited === null) return undefined;
    return edited ?? this.base[path];
  }

  write(path: string, content: string): string | null {
    if (!isValidPath(path)) return `“${path}” is not a valid project path (use relative paths like src/util.ts).`;
    if (new TextEncoder().encode(content).length > MAX_FILE_BYTES) return `The file is larger than ${MAX_FILE_BYTES / 1024} KB.`;
    if (!this.edits.has(path) && !(path in this.base) && this.edits.size >= MAX_STAGED_FILES) return `Too many changed files (limit ${MAX_STAGED_FILES}).`;
    if (this.base[path] === content) this.edits.delete(path);
    else this.edits.set(path, content);
    return null;
  }

  delete(path: string): string | null {
    if (!this.has(path)) return `“${path}” does not exist.`;
    if (path in this.base) this.edits.set(path, null);
    else this.edits.delete(path);
    return null;
  }

  /** Drop the agent's change to one file */
  revert(path: string): void {
    this.edits.delete(path);
  }

  clear(): void {
    this.edits.clear();
  }

  changes(): Record<string, StageChange> {
    const out: Record<string, StageChange> = {};
    for (const [path, content] of this.edits) {
      out[path] = content === null ? 'deleted' : path in this.base ? 'modified' : 'added';
    }
    return out;
  }

  /** What a change looks like for review */
  diff(path: string): { before: string; after: string; added: number; removed: number } {
    const before = this.base[path] ?? '';
    const after = this.read(path) ?? '';
    return { before, after, ...lineDelta(before, after) };
  }

  /** Changed files whose current project content no longer matches what the agent started from */
  conflicts(current: Record<string, string>): string[] {
    return [...this.edits.keys()].filter((path) => (current[path] ?? null) !== (this.base[path] ?? null));
  }

  /** Start from a new project state (after some changes were accepted), keeping only edits that still differ */
  rebase(base: Record<string, string>): void {
    this.base = { ...base };
    for (const [path, content] of [...this.edits]) {
      if ((content ?? null) === (this.base[path] ?? null)) this.edits.delete(path);
    }
  }

  /** A compact form for storage: the edits, and what each edited file looked like before */
  serialize(): SerializedStage {
    return { edits: [...this.edits], before: Object.fromEntries([...this.edits.keys()].map((p) => [p, this.base[p] ?? null])) };
  }

  /**
   * Rebuild a stage saved earlier, on top of the project as it is now. Files the
   * user changed since keep their saved "before" text, so conflicts are still detected.
   */
  static restore(current: Record<string, string>, saved: SerializedStage): Stage {
    const base = { ...current };
    for (const [path, before] of Object.entries(saved.before ?? {})) {
      if (before === null) delete base[path];
      else base[path] = before;
    }
    const stage = new Stage(base);
    for (const [path, content] of saved.edits ?? []) {
      if (content === null) stage.edits.set(path, null);
      else if (typeof content === 'string') stage.edits.set(path, content);
    }
    return stage;
  }

  get size(): number {
    return this.edits.size;
  }

  /** The changes in the shape the workspace's `put` action takes */
  toPut(only?: string[]): { files: Record<string, string>; removed: string[] } {
    const files: Record<string, string> = {};
    const removed: string[] = [];
    for (const [path, content] of this.edits) {
      if (only && !only.includes(path)) continue;
      if (content === null) removed.push(path);
      else files[path] = content;
    }
    return { files, removed };
  }
}
