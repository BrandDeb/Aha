/**
 * What a debug session looks like to the studio, whatever the language underneath: Node speaks the Chrome DevTools
 * Protocol, Python (debugpy) the Debug Adapter Protocol, and both are shown through these shapes.
 */

export type StepKind = 'over' | 'into' | 'out';

export interface DebugFrame {
  id: string;
  name: string;
  /** Project-relative path, or null for code outside the project (Node internals, the standard library) */
  file: string | null;
  line: number;
  column: number;
}

export interface DebugVariable {
  name: string;
  value: string;
  type?: string;
  /** Set when the value has children to expand */
  ref?: string;
}

export interface DebugScope {
  name: string;
  variables: DebugVariable[];
}

export type DebugStatus = 'starting' | 'running' | 'paused' | 'exited' | 'failed';

export interface DebugOutput {
  seq: number;
  stream: 'stdout' | 'stderr' | 'info';
  text: string;
}

export interface DebugState {
  id: string;
  language: 'node' | 'python';
  status: DebugStatus;
  /** Why it paused: a breakpoint, a step, an exception… */
  reason?: string;
  frames: DebugFrame[];
  /** The scopes of the selected frame (the top one unless another was picked) */
  scopes: DebugScope[];
  frameId?: string;
  /** Lines each breakpoint actually landed on, per file */
  breakpoints: Record<string, number[]>;
  exitCode?: number | null;
  error?: string;
  output: DebugOutput[];
}

/** One running program under a debugger, through either protocol */
export interface Debuggee {
  /** Replace the breakpoints of one file; resolves to the lines they landed on */
  setBreakpoints(file: string, lines: number[]): Promise<number[]>;
  /** Once breakpoints are set: let the program run */
  start(): Promise<void>;
  resume(): Promise<void>;
  step(kind: StepKind): Promise<void>;
  pause(): Promise<void>;
  scopes(frameId: string): Promise<DebugScope[]>;
  children(ref: string): Promise<DebugVariable[]>;
  evaluate(expression: string, frameId: string): Promise<DebugVariable>;
  stop(): void;
}

export interface DebuggeeEvents {
  paused(frames: DebugFrame[], reason: string): void;
  resumed(): void;
  output(stream: 'stdout' | 'stderr', text: string): void;
  exited(code: number | null): void;
}

/** Values are shown on one line: long ones are cut */
export const shortValue = (text: string, max = 400) => (text.length > max ? `${text.slice(0, max)}…` : text);
